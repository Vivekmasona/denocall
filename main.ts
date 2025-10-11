/**
 * ytdeno.ts — Minimal Deno prototype to extract direct format URLs from a YouTube page.
 *
 * Usage:
 *   deno run --allow-net --allow-write ytdeno.ts "https://www.youtube.com/watch?v=..."
 *
 * What it does:
 *  - fetches the YouTube page HTML
 *  - extracts ytInitialPlayerResponse JSON if present
 *  - lists formats and their direct URLs (when available)
 *  - attempts to download the first direct url if --download flag provided
 *
 * Limitations:
 *  - Does NOT attempt to solve YouTube signatureCipher/cipher (protected formats).
 *  - For protected formats, recommends using yt-dlp binary or adding a JS cipher solver.
 */

if (import.meta.main) {
  main().catch((e) => {
    console.error("Fatal:", e);
    Deno.exit(1);
  });
}

function usage() {
  console.log(`Usage:
  deno run --allow-net --allow-write ytdeno.ts <YouTube URL> [--download] [--out filename]

Examples:
  deno run --allow-net --allow-write ytdeno.ts "https://youtu.be/FkFvdukWpAI"
  deno run --allow-net --allow-write ytdeno.ts "https://youtu.be/FkFvdukWpAI" --download --out out.mp4

Notes:
  - This tool will NOT bypass signatureCipher-protected formats.
  - For protected formats, install and use yt-dlp (recommended).
`);
}

/** Simple fetch wrapper with user-agent to look like a browser */
async function fetchHtml(url: string): Promise<string> {
  const headers = {
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Fetch failed: ${r.status} ${r.statusText}`);
  return await r.text();
}

/** Attempt to extract ytInitialPlayerResponse JSON from page HTML */
function extractPlayerResponse(html: string): any | null {
  // Common patterns:
  // 1) "ytInitialPlayerResponse = { ... };" or "var ytInitialPlayerResponse = { ... }"
  // 2) "window["ytInitialPlayerResponse"] = {...};"
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
    /window\["ytInitialPlayerResponse"\]\s*=\s*(\{.+?\})\s*;/s,
    /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) {
      try {
        return JSON.parse(m[1]);
      } catch (e) {
        // Sometimes JSON is not strictly JSON (single quotes etc). Try a safer attempt.
        try {
          // Attempt to locate start/end braces and parse via eval-like cleanup (very defensive)
          const jsonLike = m[1]
            .replace(/\b([A-Za-z0-9_]+)\s*:/g, (s) => s) // leave as-is (can't safely convert)
            ;
          return JSON.parse(jsonLike);
        } catch (_e) {
          // Give up for this pattern
          return null;
        }
      }
    }
  }
  // Some pages embed a big JSON inside <script> as "ytInitialPlayerResponse": {...}
  const alt = html.match(/"ytInitialPlayerResponse"\s*:\s*(\{.+?\})\s*,\s*"ytd/si);
  if (alt && alt[1]) {
    try {
      return JSON.parse(alt[1]);
    } catch {
      return null;
    }
  }
  return null;
}

/** Flatten formats and adaptiveFormats arrays */
function collectFormats(playerResp: any) {
  const out: any[] = [];
  try {
    const sd = playerResp?.streamingData;
    if (!sd) return out;
    const push = (f: any, kind: string) => {
      out.push({ kind, ...f });
    };
    if (Array.isArray(sd.formats)) sd.formats.forEach((f: any) => push(f, "format"));
    if (Array.isArray(sd.adaptiveFormats)) sd.adaptiveFormats.forEach((f: any) => push(f, "adaptive"));
  } catch {
    // ignore
  }
  return out;
}

/** Check if format has a direct url or a signatureCipher/cipher key */
function formatInfoEntry(fmt: any) {
  // In older/modern pages:
  // - formats[].url -> direct
  // - formats[].signatureCipher OR formats[].cipher -> "s=...&url=...&sp=..." (URL encoded)
  const entry: any = {
    mimeType: fmt.mimeType || fmt.mime_type || null,
    bitrate: fmt.bitrate || null,
    width: fmt.width || null,
    height: fmt.height || null,
    codec: null,
    directUrl: null,
    needsCipher: false,
    raw: fmt,
  };
  if (fmt.mimeType) {
    // mimeType may include codecs
    const m = fmt.mimeType.match(/^\s*([^;]+)(?:;\s*codecs="?(.*?)"?)?$/i);
    if (m) {
      entry.codec = m[2] || null;
    }
  }
  if (fmt.url && typeof fmt.url === "string") {
    entry.directUrl = fmt.url;
  } else if (fmt.signatureCipher || fmt.cipher) {
    entry.needsCipher = true;
    // parse the query-like cipher to at least show url param (may be encoded)
    const cipher = fmt.signatureCipher || fmt.cipher;
    try {
      const params = Object.fromEntries(cipher.split("&").map((kv: string) => {
        const [k, v] = kv.split("=");
        return [decodeURIComponent(k), decodeURIComponent(v || "")];
      }));
      entry.directUrl = params.url || null; // may exist
      entry.cipher = params;
    } catch {
      entry.cipher = { raw: cipher };
    }
  }
  return entry;
}

/** Simple downloader for a single URL */
async function downloadToFile(url: string, outPath: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const file = await Deno.open(outPath, { create: true, write: true, truncate: true });
  const body = resp.body;
  if (!body) {
    file.close();
    throw new Error("No response body");
  }
  const writer = file;
  const reader = body.getReader();
  // Stream copy (modern Deno supports readableStreamToFile but we implement manual)
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writer.write(value);
    total += value.length;
    // small progress
    if (total % (1024 * 1024) < 65536) {
      console.log(`Downloaded ${(total / (1024 * 1024)).toFixed(2)} MB...`);
    }
  }
  writer.close();
  return total;
}

/** Try to run local yt-dlp if available as a fallback for ciphered formats */
async function tryRunYtDlp(url: string, out: string | null) {
  // Check if `yt-dlp` is available in PATH
  try {
    const p = Deno.run({
      cmd: ["yt-dlp", "--version"],
      stdout: "null",
      stderr: "null",
    });
    const status = await p.status();
    p.close();
    if (!status.success) return null;
  } catch {
    return null;
  }

  // Run yt-dlp to download best format (or to print direct URL)
  const args: string[] = ["yt-dlp", url, "--no-progress"];
  if (out) {
    args.push("-o", out);
  } else {
    // print best direct URL (simulate)
    args.push("-f", "best", "--no-playlist");
  }
  console.log("Running yt-dlp as fallback:", args.join(" "));
  const proc = Deno.run({
    cmd: args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const st = await proc.status();
  proc.close();
  return st.success;
}

/** Main CLI */
async function main() {
  const argv = [...Deno.args];
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }
  const url = argv[0];
  const downloadFlag = argv.includes("--download");
  const outIndex = argv.indexOf("--out");
  const outFile = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : null;

  console.log("Fetching page:", url);
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    console.error("Failed to fetch page:", err.message);
    return;
  }

  console.log("Extracting player response...");
  const player = extractPlayerResponse(html);
  if (!player) {
    console.error("Could not extract ytInitialPlayerResponse from page.");
    console.error("This page might be dynamically generated or protected. Use yt-dlp for robust support.");
    return;
  }

  const title = player?.videoDetails?.title || "Unknown Title";
  console.log(`Video title: ${title}`);

  const formats = collectFormats(player);
  if (!formats || formats.length === 0) {
    console.error("No streaming formats found in player response.");
    return;
  }

  // Map formats to infos
  const infos = formats.map(formatInfoEntry);

  // Print summary
  console.log("\nFound formats:");
  infos.forEach((info, idx) => {
    console.log(`\n[${idx}] kind=${info.kind} mime=${info.mimeType || "?"} ${info.width ? info.width + "x" + info.height : ""}`);
    console.log("   directUrl:", info.directUrl ? "[DIRECT]" : info.needsCipher ? "[CIPHERED]" : "[NONE]");
    if (info.needsCipher) {
      console.log("   cipher params:", info.cipher ? JSON.stringify(info.cipher) : "(unknown)");
    }
  });

  // Prefer a direct MP4/WEBM video if available
  const direct = infos.find(i => i.directUrl && /mime|mp4|webm|video/i.test(i.mimeType || i.directUrl || ""));
  if (direct && direct.directUrl) {
    console.log("\nUsing direct url from format (no cipher):", direct.directUrl);
    if (downloadFlag) {
      const out = outFile || "out.media";
      console.log(`Downloading to ${out} ...`);
      try {
        const bytes = await downloadToFile(direct.directUrl, out);
        console.log(`Downloaded ${bytes} bytes to ${out}`);
      } catch (err) {
        console.error("Download failed:", err.message);
      }
    }
    return;
  }

  // If no direct format found, check if any format provides `url` inside cipher params
  const cipherWithUrl = infos.find(i => i.needsCipher && i.cipher && i.cipher.url);
  if (cipherWithUrl && cipherWithUrl.cipher.url) {
    console.log("\nNOTE: Found a cipher entry that includes a URL parameter. This URL may still require signature.");
    console.log("URL (from cipher.url):", cipherWithUrl.cipher.url);
    if (downloadFlag) {
      console.log("Attempting to download that URL directly...");
      try {
        const out = outFile || "out.media";
        const bytes = await downloadToFile(cipherWithUrl.cipher.url, out);
        console.log(`Downloaded ${bytes} bytes to ${out}`);
      } catch (err) {
        console.error("Direct download failed (likely requires signature). Error:", err.message);
      }
    }
    return;
  }

  // Otherwise, formats are ciphered — offer fallback to local yt-dlp if installed
  console.log("\nAll available formats appear to be ciphered (require signature deciphering).");
  console.log("This prototype does NOT implement signature deciphering (intentional).");
  console.log("Options:");
  console.log("  1) Install & run yt-dlp locally (recommended) — this prototype can call it if available.");
  console.log("  2) Implement a JS-based cipher solver (complex, brittle).");

  if (downloadFlag) {
    console.log("\nAttempting to run local yt-dlp as a fallback (if installed)...");
    const ok = await tryRunYtDlp(url, outFile);
    if (ok === null) {
      console.log("yt-dlp not found on PATH. Install yt-dlp and try again, or use a machine with yt-dlp.");
    } else if (ok) {
      console.log("yt-dlp finished successfully (check output).");
    } else {
      console.log("yt-dlp ran but failed. Check yt-dlp output for details.");
    }
  } else {
    console.log("\nTo download protected formats automatically, run with --download (and have yt-dlp installed), e.g.:");
    console.log(`  deno run --allow-net --allow-write ytdeno.ts "${url}" --download --out "video.mp4"`);
  }
      }
