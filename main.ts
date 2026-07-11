// Deno YouTube Extractor using real yt-dlp binary + Search with CORS

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);

  const headers = {
    "content-type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (pathname === "/") {
    return new Response(
      JSON.stringify({ status: "running", message: "Use /ytdlp?url=... or /search?q=..." }, null, 2),
      { headers }
    );
  }

  // ---------------- REAL YT-DLP INTEGRATION ----------------
  if (pathname === "/ytdlp") {
    const ytUrl = searchParams.get("url");
    if (!ytUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url=" }), { headers, status: 400 });
    }

    try {
      // Deno.Command se yt-dlp run kar rahe hain aur dump-json le rahe hain
      // Isse saare adaptive formats (video only, audio only, mixed) mil jaate hain
      const command = new Deno.Command("yt-dlp", {
        args: [
          "--dump-json",
          "--no-playlist",
          ytUrl
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { success, stdout, stderr } = await command.output();

      if (!success) {
        const errorString = new TextDecoder().decode(stderr);
        throw new Error(`yt-dlp failed: ${errorString}`);
      }

      const rawJson = new TextDecoder().decode(stdout);
      const ytData = JSON.parse(rawJson);

      // Aapka v3-style custom response formats list ke sath
      const response = {
        kind: "youtube#videoListResponse",
        items: [
          {
            kind: "youtube#video",
            id: ytData.id,
            snippet: {
              publishedAt: ytData.upload_date ? `${ytData.upload_date.slice(0,4)}-${ytData.upload_date.slice(4,6)}-${ytData.upload_date.slice(6,8)}T00:00:00Z` : "",
              channelId: ytData.channel_id,
              channelTitle: ytData.channel,
              title: ytData.title,
              description: ytData.description || "",
              thumbnails: {
                default: { url: ytData.thumbnail },
                high: { url: ytData.thumbnails?.[ytData.thumbnails.length - 1]?.url || ytData.thumbnail }
              },
            },
            contentDetails: {
              duration: `PT${ytData.duration || 0}S`,
            },
            statistics: {
              viewCount: ytData.view_count?.toString() || "0",
              likeCount: ytData.like_count?.toString() || "0",
            },
            // Yahan par saare adaptive aur normal formats milenge
            formats: ytData.formats?.map((f: any) => ({
              format_id: f.format_id,
              url: f.url,
              ext: f.ext,
              resolution: f.resolution,
              fps: f.fps,
              vcodec: f.vcodec,
              acodec: f.acodec,
              filesize: f.filesize || f.filesize_approx || "Unknown",
              container: f.container,
              protocol: f.protocol,
              quality: f.quality
            })) || []
          },
        ],
      };

      return new Response(JSON.stringify(response, null, 2), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { headers, status: 500 });
    }
  }

  // ---------------- SEARCH (Bina kisi change ke) ----------------
  if (pathname === "/search") {
    const query = searchParams.get("q");
    if (!query) {
      return new Response(JSON.stringify({ error: "Missing ?q=" }), { headers, status: 400 });
    }

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await res.text();

      const dataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
      if (!dataMatch) {
        return new Response(JSON.stringify({ error: "Could not parse search results" }), { headers });
      }

      const initialData = JSON.parse(dataMatch[1]);
      const contents =
        initialData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
          ?.flatMap((c: any) => c.itemSectionRenderer?.contents || []) || [];

      const items: any[] = [];

      for (const item of contents) {
        const video = item.videoRenderer;
        if (video) {
          const videoId = video.videoId;
          const title = video.title?.runs?.map((r: any) => r.text).join("") || "Unknown";
          const channelTitle = video.ownerText?.runs?.map((r: any) => r.text).join("") || "Unknown";
          const thumbnails = video.thumbnail?.thumbnails || [];
          const description = video.descriptionSnippet?.runs?.map((r: any) => r.text).join("") || "";

          items.push({
            kind: "youtube#searchResult",
            id: { kind: "youtube#video", videoId },
            snippet: {
              title,
              description,
              channelTitle,
              thumbnails: {
                default: thumbnails[0] || {},
                medium: thumbnails[Math.floor(thumbnails.length / 2)] || {},
                high: thumbnails[thumbnails.length - 1] || {},
              },
            },
          });
        }
      }

      const response = {
        kind: "youtube#searchListResponse",
        pageInfo: { totalResults: items.length, resultsPerPage: 20 },
        items: items.slice(0, 20),
      };

      return new Response(JSON.stringify(response, null, 2), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { headers, status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "404 Not Found" }), { headers, status: 404 });
});

