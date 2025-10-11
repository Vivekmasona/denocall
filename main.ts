// Deno YouTube Extractor - Full Version
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
      // Fetch video page HTML
      const res = await fetch(ytUrl);
      const html = await res.text();

      // Extract video title from <title> tag
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

      // Extract ytInitialPlayerResponse JSON
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (!playerMatch) {
        return new Response(JSON.stringify({
          status: "ok",
          title,
          message: "Could not parse player response (ytInitialPlayerResponse not found)",
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      const playerJson = JSON.parse(playerMatch[1]);
      const formats = playerJson?.streamingData?.formats || [];
      const adaptive = playerJson?.streamingData?.adaptiveFormats || [];

      // Pick one playable audio URL
      const audio =
        adaptive.find((f: any) => f.mimeType.includes("audio")) ||
        formats.find((f: any) => f.mimeType.includes("audio"));

      // Extract additional info
      const videoDetails = playerJson.videoDetails || {};
      const microformat = playerJson.microformat?.playerMicroformatRenderer || {};

      const channelName = videoDetails.author || "Unknown";
      const channelId = videoDetails.channelId || "Unknown";
      const durationSeconds = parseInt(videoDetails.lengthSeconds || "0", 10);
      const description = videoDetails.shortDescription || "";
      const thumbnails = videoDetails.thumbnail?.thumbnails || [];
      const publishDate = microformat.publishDate || "";
      const viewCount = videoDetails.viewCount || "0";

      return new Response(JSON.stringify({
        status: "success",
        title,
        videoId: videoDetails.videoId,
        channelName,
        channelId,
        description,
        publishDate,
        viewCount,
        durationSeconds,
        thumbnails,
        audioUrl: audio?.url || "N/A",
        formatsCount: formats.length + adaptive.length,
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
