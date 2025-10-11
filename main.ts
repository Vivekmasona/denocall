// Deno YouTube Extractor + Search
// Example fetch video: /ytdlp?url=https://youtu.be/FkFvdukWpAI
// Example search: /search?q=hindi song

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);

  if (pathname === "/") {
    return new Response(
      "🦕 Deno YT Extractor Running!\nUse /ytdlp?url=... or /search?q=...",
      { headers: { "content-type": "text/plain" } }
    );
  }

  // ---------------- VIDEO INFO ----------------
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

      // Video title
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

      // Player response
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      const playerJson = playerMatch ? JSON.parse(playerMatch[1]) : null;

      const formats = playerJson?.streamingData?.formats || [];
      const adaptive = playerJson?.streamingData?.adaptiveFormats || [];
      const audio =
        adaptive.find((f: any) => f.mimeType.includes("audio")) ||
        formats.find((f: any) => f.mimeType.includes("audio"));

      const videoDetails = playerJson?.videoDetails || {};
      const microformat = playerJson?.microformat?.playerMicroformatRenderer || {};

      // Channel info
      const channelName = videoDetails.author || "Unknown";
      const channelId = videoDetails.channelId || "Unknown";

      // Thumbnails
      const thumbnails = videoDetails.thumbnail?.thumbnails || [];

      // Publish date & views
      const publishDate = microformat.publishDate || "";
      const viewCount = videoDetails.viewCount || "0";
      const durationSeconds = parseInt(videoDetails.lengthSeconds || "0", 10);

      // Extract initial comments from ytInitialData
      const dataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
      let comments: Array<{ author: string; text: string; likes: number }> = [];

      if (dataMatch) {
        const initialData = JSON.parse(dataMatch[1]);
        const contents =
          initialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];

        for (const c of contents) {
          const itemSection = c.itemSectionRenderer?.contents || [];
          for (const item of itemSection) {
            const commentThread = item.commentThreadRenderer?.comment?.commentRenderer;
            if (commentThread) {
              const author = commentThread.authorText?.simpleText || "Unknown";
              const text =
                commentThread.contentText?.runs?.map((r: any) => r.text).join("") || "";
              const likes = commentThread.voteCount?.simpleText
                ? parseInt(commentThread.voteCount.simpleText.replace(/[^0-9]/g, ""), 10)
                : 0;
              comments.push({ author, text, likes });
            }
          }
        }
      }

      return new Response(JSON.stringify({
        status: "success",
        title,
        videoId: videoDetails.videoId,
        channelName,
        channelId,
        publishDate,
        viewCount,
        durationSeconds,
        thumbnails,
        audioUrl: audio?.url || "N/A",
        formatsCount: formats.length + adaptive.length,
        comments: comments.slice(0, 10),
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

  // ---------------- SEARCH ----------------
  if (pathname === "/search") {
    const query = searchParams.get("q");
    if (!query) {
      return new Response(JSON.stringify({ error: "Missing ?q=" }), {
        headers: { "content-type": "application/json" },
        status: 400,
      });
    }

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await res.text();

      const dataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
      if (!dataMatch) {
        return new Response(JSON.stringify({ error: "Could not parse search results" }), {
          headers: { "content-type": "application/json" },
        });
      }

      const initialData = JSON.parse(dataMatch[1]);
      const contents =
        initialData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
          ?.flatMap((c: any) => c.itemSectionRenderer?.contents || []) || [];

      const results: Array<any> = [];

      for (const item of contents) {
        const video = item.videoRenderer;
        if (video) {
          const videoId = video.videoId;
          const title = video.title?.runs?.map((r: any) => r.text).join("") || "Unknown";
          const channelName = video.ownerText?.runs?.map((r: any) => r.text).join("") || "Unknown";
          const thumbnails = video.thumbnail?.thumbnails || [];
          const duration = video.lengthText?.simpleText || "N/A";
          results.push({ videoId, title, channelName, thumbnails, duration });
        }
      }

      return new Response(JSON.stringify({
        status: "success",
        query,
        results: results.slice(0, 20) // top 20 results
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
