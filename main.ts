// main.ts — YouTube Audio Extractor for Deno Deploy (2025 working version)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  if (pathname === "/") {
    return new Response(
      `
      <html>
      <head><title>YouTube Extractor</title></head>
      <body style="font-family: sans-serif; text-align:center; margin-top:40px;">
        <h1>🎵 YouTube Audio Extractor (Deno Deploy)</h1>
        <form action="/ytdlp">
          <input type="text" name="url" placeholder="Enter YouTube URL" size="50" required />
          <button type="submit">Extract</button>
        </form>
      </body>
      </html>
      `,
      { headers: { "content-type": "text/html; charset=utf-8" } },
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

      // Extract video title
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

      // Extract player response JSON
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (!playerMatch) {
        return new Response(JSON.stringify({
          status: "error",
          title,
          message: "Could not parse player response",
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      const playerJson = JSON.parse(playerMatch[1]);
      const formats = [
        ...(playerJson?.streamingData?.formats || []),
        ...(playerJson?.streamingData?.adaptiveFormats || []),
      ];

      // Try to decode a playable audio URL
      let audioUrl = "N/A";
      for (const f of formats) {
        if (f.mimeType?.includes("audio")) {
          if (f.url) {
            audioUrl = f.url;
            break;
          } else if (f.signatureCipher || f.cipher) {
            // Extract from cipher
            const cipher = f.signatureCipher || f.cipher;
            const params = new URLSearchParams(cipher);
            const baseUrl = params.get("url");
            const sig = params.get("s");
            const sp = params.get("sp") || "sig";
            if (baseUrl) {
              audioUrl = `${baseUrl}&${sp}=${sig}`;
              break;
            }
          }
        }
      }

      const videoId = playerJson.videoDetails?.videoId || null;

      return new Response(
        JSON.stringify(
          {
            status: "success",
            title,
            videoId,
            audioUrl,
            formats: formats.length,
          },
          null,
          2,
        ),
        {
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        headers: { "content-type": "application/json" },
        status: 500,
      });
    }
  }

  return new Response("404 Not Found", { status: 404 });
});
