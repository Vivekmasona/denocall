// Deno natively supports npm packages via 'npm:' prefix
import express from "npm:express";
import chromium from "npm:@sparticuz/chromium";
import puppeteer from "npm:puppeteer-core";

const app = express();
const PORT = Deno.env.get("PORT") || 3000; // Deno-style environment variable

let browserPromise;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      userDataDir: "/tmp/chrome-user-data",
    });
  }
  return browserPromise;
}

const MEDIA_EXT_RE = /\.(mp4|webm|m3u8|mkv|mp3|aac|ogg|opus|wav|flac|m4a|jpg|jpeg|png|gif|bmp|webp)(\?|$)/i;
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

app.get("/extract", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Valid URL required" });

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Inject script to capture dynamic media URLs
    await page.evaluateOnNewDocument(() => {
      const send = (obj) => console.log("CAPTURE_MEDIA::" + JSON.stringify(obj));
      
      // Patch fetch
      const origFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const p = origFetch(...args);
        p.then(async (resp) => {
          try {
            const ct = resp.headers.get("content-type") || "";
            const u = resp.url || args[0];
            if (ct.includes("video") || ct.includes("audio") || ct.includes("image") || u.match(/\.(mp4|mp3|m3u8|jpg|jpeg|png|gif)/i)) {
              send({ url: u, type: ct.split("/")[0] || "other", note: "fetch" });
            }
          } catch (e) {}
        }).catch(()=>{});
        return p;
      };

      // Patch XMLHttpRequest
      const origOpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function(method, url) {
        this._captureUrl = url;
        return origOpen.apply(this, arguments);
      };
      const origSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.send = function() {
        this.addEventListener("load", function() {
          try {
            const ct = this.getResponseHeader("content-type") || "";
            const u = this._captureUrl;
            if (ct.includes("video") || ct.includes("audio") || ct.includes("image") || u.match(/\.(mp4|mp3|m3u8|jpg|jpeg|png|gif)/i)) {
              send({ url: u, type: ct.split("/")[0] || "other", note: "xhr" });
            }
          } catch(e){}
        });
        return origSend.apply(this, arguments);
      };

      // Observe <video>, <audio>, <img>
      const collectDOM = () => {
        const out = [];
        document.querySelectorAll("video, audio").forEach(el => {
          if (el.src) out.push({ url: el.src, type: el.tagName.toLowerCase(), note: "dom" });
          if (el.currentSrc) out.push({ url: el.currentSrc, type: el.tagName.toLowerCase(), note: "dom" });
          el.querySelectorAll("source").forEach(s => s.src && out.push({ url: s.src, type: el.tagName.toLowerCase(), note: "dom-source" }));
        });
        document.querySelectorAll("img").forEach(img => img.src && out.push({ url: img.src, type: "image", note: "dom-img" }));
        return out;
      };

      const initial = collectDOM();
      initial.forEach(obj => send(obj));

      const mo = new MutationObserver(() => collectDOM().forEach(obj => send(obj)));
      mo.observe(document, { childList: true, subtree: true });
    });

    const results = [];
    const seen = new Set();
    function pushResult(obj) {
      if (!obj?.url) return;
      const key = obj.url + "|" + (obj.type || "");
      if (seen.has(key)) return;
      seen.add(key);

      let type = obj.type || "other";
      if (/video/i.test(type) || obj.url.match(/\.(mp4|webm|m3u8|mkv)/i)) type = "video";
      else if (/audio/i.test(type) || obj.url.match(/\.(mp3|aac|ogg|wav|m4a|flac)/i)) type = "audio";
      else if (/image/i.test(type) || obj.url.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i)) type = "image";
      else type = "other";

      results.push({ url: obj.url, type, source: obj.note || "detected" });
    }

    // Capture console messages
    page.on("console", msg => {
      try {
        const txt = msg.text();
        if (!txt.startsWith("CAPTURE_MEDIA::")) return;
        const payload = JSON.parse(txt.replace(/^CAPTURE_MEDIA::/, ""));
        pushResult(payload);
      } catch(e){}
    });

    // Capture network responses
    page.on("response", response => {
      try {
        const rurl = response.url().replace(/&bytestart=\d+&byteend=\d+/gi, "");
        const ct = response.headers()["content-type"] || "";
        if (ct.includes("video") || ct.includes("audio") || ct.includes("image") || MEDIA_EXT_RE.test(rurl)) {
          pushResult({ url: rurl, type: ct.split("/")[0] || "other", note: "network" });
        }
      } catch(e){}
    });

    // Navigate to page
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(()=>{});
    await new Promise(r => setTimeout(r, 1500));

    // Grab DOM media
    const domMedia = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("video, audio, img, source").forEach(el => {
        if (el.src) out.push({ url: el.src, type: el.tagName.toLowerCase(), note: "dom-final" });
      });
      return out;
    });
    domMedia.forEach(pushResult);

    await page.close();

    // Priority sort
    const priority = [], normal = [];
    results.forEach(r => {
      if (PRIORITY_DOMAINS.some(d => r.url.includes(d))) priority.push(r);
      else normal.push(r);
    });

    res.json({ results: [...priority, ...normal] });

  } catch (err) {
    console.error("Error /extract:", err.stack || err);
    res.json({ results: [] });
  }
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));

