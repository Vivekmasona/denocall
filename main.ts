// Working lightweight YouTube fetcher for Deno Deploy
// Example: https://yourapp.deno.dev/ytdlp?url=https://youtu.be/FkFvdukWpAI

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);

  if (pathname === "/") {
    return new Response(
      "🦕 Deno YT Extractor Running!\nUse /ytdlp?url=https://youtu.be/xxxx",
      { headers: { "content-type": "text/plain" } }
    );
  }

      if (pathname === "/ytdlp") {
  const ytUrl = searchParams.get("url");
  if (!ytUrl) {
    return new Response(JSON.stringify({ error: "Missing ?url=" }), {
      headers: { "content-type": "application/json" },
      status: 400,
    });
  }

  try {
    const res = await fetch(ytUrl);
    const html = await res.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (!playerMatch) {
      return new Response(JSON.stringify({
        status: "ok",
        title,
        message: "Could not parse player response (no ytInitialPlayerResponse found)",
      }), {
        headers: { "content-type": "application/json" },
      });
    }

    const playerJson = JSON.parse(playerMatch[1]);
    const formats = [
      ...(playerJson?.streamingData?.formats || []),
      ...(playerJson?.streamingData?.adaptiveFormats || []),
    ];

    // Try to decode a playable audio format
    let audioUrl = "N/A";
    for (const f of formats) {
      if (f.mimeType?.includes("audio")) {
        if (f.url) {
          audioUrl = f.url;
          break;
        } else if (f.signatureCipher || f.cipher) {
          // parse cipher URL
          const cipher = f.signatureCipher || f.cipher;
          const params = new URLSearchParams(cipher);
          const baseUrl = params.get("url");
          const sig = params.get("s");
          const sp = params.get("sp") || "sig";
          if (baseUrl) {
            // return without actual decipher (will still work for some videos)
            audioUrl = `${baseUrl}&${sp}=${sig}`;
            break;
          }
        }
      }
    }

    return new Response(JSON.stringify({
      status: "success",
      title,
      videoId: playerJson.videoDetails?.videoId,
      audioUrl,
      formats: formats.length,
    }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "content-type": "application/json" },
      status: 500,
    });
  }
}
