// Deno YouTube Extractor + Search (v3 style) with Android Client API

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

  // ---------------- VIDEO INFO (ANDROID API ROUTE) ----------------
    // ---------------- VIDEO INFO (WEB EMBEDDED PLAYER ROUTE) ----------------
  if (pathname === "/ytdlp") {
    const ytUrl = searchParams.get("url");
    if (!ytUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url=" }), { headers, status: 400 });
    }

    try {
      // 1. वीडियो ID निकालें
      let videoId = "";
      const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
      const match = ytUrl.match(regExp);
      if (match && match[2].length === 11) {
        videoId = match[2];
      } else {
        videoId = ytUrl;
      }

      // 2. यूट्यूब के वेब एंबेडेड क्लाइंट को रिक्वेस्ट भेजें
      const apiUrl = "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_2v9w3_NExA6w_WwN-t8mN4V4x_g8w";
      const apiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Origin": "https://www.youtube.com"
        },
        body: JSON.stringify({
          videoId: videoId,
          context: {
            client: {
              clientName: "WEB_EMBEDDED_PLAYER",
              clientVersion: "1.20240101.01.00",
              hl: "en",
              gl: "US"
            }
          }
        })
      });

      const playerJson = await apiResponse.json();
      const streamingData = playerJson?.streamingData || {};

      // अगर फिर भी ब्लॉक हो, तो पुराना फॉलबैक चेक
      if (!streamingData.formats && !streamingData.adaptiveFormats) {
        return new Response(JSON.stringify({ 
          error: "Streams hidden by YouTube. Try another video or refresh.", 
          debug: playerJson?.playabilityStatus?.status || "Unknown Status"
        }), { headers, status: 403 });
      }

      const rawFormats = [
        ...(streamingData.formats || []),
        ...(streamingData.adaptiveFormats || [])
      ];

      // 3. फॉर्मेट पार्सर
      const allFormats = rawFormats.map((f: any) => {
        let url = f.url || "";
        
        // अगर सिफर (Cipher) मौजूद है, तो उसे डिकोड करें
        if (!url && (f.signatureCipher || f.cipher)) {
          const cipherText = f.signatureCipher || f.cipher;
          const params = new URLSearchParams(cipherText);
          const baseUrl = params.get("url");
          const sp = params.get("sp") || "sig";
          const sig = params.get("s");
          if (baseUrl) {
            url = sig ? `${baseUrl}&${sp}=${encodeURIComponent(sig)}` : baseUrl;
          }
        }

        return {
          itag: f.itag,
          quality: f.qualityLabel || f.audioQuality || "unknown",
          mimeType: f.mimeType || "",
          bitrate: f.bitrate,
          contentLength: f.contentLength || "unknown",
          fps: f.fps || null,
          url: url || "N/A"
        };
      });

      const audioStreams = allFormats.filter(f => f.mimeType.includes("audio/"));
      const videoStreams = allFormats.filter(f => f.mimeType.includes("video/"));

      const videoDetails = playerJson?.videoDetails || {};
      const microformat = playerJson?.microformat?.playerMicroformatRenderer || {};

      const response = {
        kind: "youtube#videoListResponse",
        items: [
          {
            kind: "youtube#video",
            id: videoDetails.videoId,
            snippet: {
              publishedAt: microformat.publishDate || "",
              channelId: videoDetails.channelId || "",
              channelTitle: videoDetails.author || "Unknown",
              title: videoDetails.title || "Unknown",
              description: videoDetails.shortDescription || "",
              thumbnails: videoDetails.thumbnail?.thumbnails || [],
            },
            contentDetails: {
              duration: `PT${videoDetails.lengthSeconds || 0}S`,
            },
            statistics: {
              viewCount: videoDetails.viewCount || "0",
            },
            streams: {
              total_available: allFormats.length,
              audio: audioStreams,
              video: videoStreams,
              all: allFormats
            },
            comments: []
          },
        ],
      };

      return new Response(JSON.stringify(response, null, 2), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { headers, status: 500 });
    }
  }

  

  // ---------------- SEARCH ----------------
  if (pathname === "/search") {
    const query = searchParams.get("q");
    if (!query) {
      return new Response(JSON.stringify({ error: "Missing ?q=" }), { headers, status: 400 });
    }

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
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
