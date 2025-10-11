// main.ts - Deno compatible Puppeteer + Chromium extractor
// Run with: deno run --allow-all --unstable main.ts

import express from "npm:express";
import puppeteer from "npm:puppeteer-core";
import chromium from "npm:@sparticuz/chromium";

const app = express();
const PORT = Deno.env.get("PORT") || 3000;
let browserPromise: Promise<any> | null = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      userDataDir: "/tmp/chrome-user-data",
    });
  }
  return browserPromise;
}

const PRIORITY_DOMAINS = [
  "youtube.com", "youtu.be",
  "scontent", "cdninstagram",
  "fbcdn.net", "facebook.com",
  "twitter.com", "twimg.com",
  "soundcloud.com",
  "vimeo.com",
  "googlevideo.com",
  "play.google.com",
];

const MEDIA_EXT_RE =
  /\.(mp4|webm|m3u8|mkv|mp3|aac|ogg|opus|wav|flac|m4a|jpg|jpeg|png|gif|bmp|webp)(\?|$)/i;

// ───────────────────────────────────────────────────────────────
// /cdn route — main extractor
// ───────────────────────────────────────────────────────────────
app.get("/cdn", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Valid URL required" });

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    const results: any[] = [];
    const seen = new Set<string>();

    function pushResult(obj: any) {
      if (!obj || !obj.url) return;
      const key = obj.url + "|" + (obj.type || "");
      if (seen.has(key)) return;
      seen.add(key);

      let t = obj.type || "media";
      if (t === "image" || (obj.contentType && obj.contentType.startsWith("image")))
        t = "image";
      else if (t === "audio" || (obj.contentType && obj.contentType.startsWith("audio")))
        t = "audio";
      else if (t === "video" || (obj.contentType && obj.contentType.startsWith("video")))
        t = "video";
      else {
        if (obj.url.match(/\.(mp4|webm|m3u8|mkv)/i)) t = "video";
        else if (obj.url.match(/\.(mp3|aac|ogg|opus|wav|m4a|flac)/i)) t = "audio";
        else if (obj.url.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i)) t = "image";
      }

      results.push({
        url: obj.url,
        type: t,
        source: obj.source || obj.note || "detected",
        contentType: obj.contentType || null,
        title: null,
      });
    }

    // Capture network responses
    page.on("response", async (response) => {
      try {
        const rurl = response.url().replace(/&bytestart=\d+&byteend=\d+/gi, "");
        const headers = response.headers();
        const ct = headers["content-type"] || headers["Content-Type"] || "";
        if (
          ct &&
          (ct.includes("video") || ct.includes("audio") || ct.includes("image") ||
            /m3u8|mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct))
        ) {
          pushResult({ url: rurl, contentType: ct, source: "network-response" });
        } else if (MEDIA_EXT_RE.test(rurl)) {
          pushResult({ url: rurl, source: "network-response-ext" });
        }
      } catch (_) {}
    });

    // Load page
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});

    // Extract DOM <video>, <audio>, <img> sources
    const domMedia = await page.evaluate(() => {
      const out: any[] = [];
      document.querySelectorAll("video, audio, img, source").forEach((el: any) => {
        if (el.src) out.push({ url: el.src, tag: el.tagName.toLowerCase() });
        if (el.currentSrc) out.push({ url: el.currentSrc, tag: el.tagName.toLowerCase() });
      });
      return out;
    });

    domMedia.forEach((d) =>
      pushResult({
        url: d.url,
        type: d.tag === "img" ? "image" : undefined,
        source: "dom-scan",
      })
    );

    await new Promise((r) => setTimeout(r, 1800));
    const title = await page.title().catch(() => "Unknown");
    results.forEach((r) => (r.title = title));

    const priority: any[] = [];
    const normal: any[] = [];
    results.forEach((r) => {
      if (PRIORITY_DOMAINS.some((d) => (r.url || "").includes(d))) priority.push(r);
      else normal.push(r);
    });

    await page.close();
    res.json({ results: [...priority, ...normal] });
  } catch (err) {
    console.error("Error in /cdn:", err);
    res.json({ results: [] });
  }
});

app.listen(PORT, () =>
  console.log(`✅ Deno Server running at http://localhost:${PORT}`)
);
