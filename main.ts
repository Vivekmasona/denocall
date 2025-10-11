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

      // Extract video title
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

      // Extract basic player config
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
      const formats = playerJson?.streamingData?.formats || [];
      const adaptive = playerJson?.streamingData?.adaptiveFormats || [];

      // Try to pick one playable audio URL
      const audio =
        adaptive.find((f: any) => f.mimeType.includes("audio")) ||
        formats.find((f: any) => f.mimeType.includes("audio"));

      return new Response(JSON.stringify({
        status: "success",
        title,
        videoId: playerJson.videoDetails?.videoId,
        audioUrl: audio?.url || "N/A",
        formats: (formats.length + adaptive.length),
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

  return new Response("404 Not Found", { status: 404 });
});
