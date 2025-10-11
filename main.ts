// main.ts - 100% Deno Deploy compatible version
import puppeteer from "npm:puppeteer-core";
import chromium from "npm:@sparticuz/chromium";

const PRIORITY_DOMAINS = [
  "youtube.com", "youtu.be",
  "scontent", "cdninstagram",
  "fbcdn.net", "facebook.com",
  "twitter.com", "twimg.com",
  "soundcloud.com", "vimeo.com",
  "googlevideo.com", "play.google.com",
];

const MEDIA_EXT_RE =
  /\.(mp4|webm|m3u8|mkv|mp3|aac|ogg|opus|wav|flac|m4a|jpg|jpeg|png|gif|bmp|webp)(\?|$)/i;

async function extractMedia(url: string) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  const results: any[] = [];
  const seen = new Set<string>();

  function push(obj: any) {
    if (!obj?.url || seen.has(obj.url)) return;
    seen.add(obj.url);
    results.push(obj);
  }

  page.on("response", async (res) => {
    const rurl = res.url();
    const headers = res.headers();
    const ct = headers["content-type"] || "";
    if (
      ct.includes("video") || ct.includes("audio") || ct.includes("image") ||
      MEDIA_EXT_RE.test(rurl)
    ) {
      push({ url: rurl, contentType: ct, source: "network" });
    }
  });

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  const dom = await page.evaluate(() => {
    const arr: any[] = [];
    document.querySelectorAll("video, audio, img, source").forEach((el: any) => {
      if (el.src) arr.push({ url: el.src, tag: el.tagName.toLowerCase() });
    });
    return arr;
  });
  dom.forEach((d) => push({ url: d.url, type: d.tag }));

  await new Promise((r) => setTimeout(r, 1500));
  const title = await page.title().catch(() => "Untitled");
  await page.close();
  await browser.close();

  const priority: any[] = [];
  const normal: any[] = [];
  results.forEach((r) => {
    if (PRIORITY_DOMAINS.some((d) => (r.url || "").includes(d))) priority.push(r);
    else normal.push(r);
  });

  return { title, results: [...priority, ...normal] };
}

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);
  if (pathname === "/cdn") {
    const url = searchParams.get("url");
    if (!url) return new Response(JSON.stringify({ error: "URL required" }), {
      headers: { "Content-Type": "application/json" },
    });
    try {
      const data = await extractMedia(url);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response("🦕 Deno Media Extractor\nUse /cdn?url=...", {
    headers: { "Content-Type": "text/plain" },
  });
});
