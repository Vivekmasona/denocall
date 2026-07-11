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
      // ---------------- VIDEO INFO (NO-COOKIE SECURE ROUTE) ----------------
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

      // 2. यूट्यूब की नो-कुकी वॉच एम्बेड सर्विस से डेटा उठाएं
      const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
      const embedResponse = await fetch(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      
      const html = await embedResponse.text();
      
      // 3. कॉन्फ़िगरेशन डेटा को एक्सट्रैक्ट करें
      const configMatch = html.match(/ytvfg\.set\(\{([^}]+)\}\)/) || html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      
      let playerJson: any = null;
      if (configMatch) {
        let jsonStr = configMatch[1].trim();
        if (!jsonStr.startsWith("{")) jsonStr = "{" + jsonStr + "}";
        try {
          playerJson = JSON.parse(jsonStr);
        } catch {
          // अगर पहला मैच फेल हो तो बैकअप पार्सर
          const backupMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\}\s*);\s*(?:var|const|let|window)/s) || html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
          if (backupMatch) playerJson = JSON.parse(backupMatch[1]);
        }
      }

      // अगर फिर भी डेटा न मिले, तो इसका मतलब यूट्यूब री-डाइरेक्ट कर रहा है (थर्ड पार्टी API फॉलबैक)
      if (!playerJson || !playerJson.streamingData) {
        // यह एक पब्लिक बाईपास गेटवे है जो बिना ब्लॉक हुए डेटा निकाल देता है
        const fallbackRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
        if (fallbackRes.ok) {
          const pipedData = await fallbackRes.json();
          
          const allFormats = [
            ...(pipedData.videoStreams || []),
            ...(pipedData.audioStreams || [])
          ].map((f: any) => ({
            itag: f.videoCodec ? 137 : 140, // एप्रोक्सिमेट itag टार्गेटिंग
            quality: f.quality || "medium",
            mimeType: f.mimeType || "audio/mp4",
            bitrate: f.bitrate || 128000,
            contentLength: "unknown",
            fps: f.fps || null,
            url: f.url
          }));

          return new Response(JSON.stringify({
            kind: "youtube#videoListResponse",
            items: [{
              kind: "youtube#video",
              id: videoId,
              snippet: { title: pipedData.title || "YouTube Video", description: pipedData.description || "", channelTitle: pipedData.uploader || "Unknown", thumbnails: [{ url: pipedData.thumbnailUrl }] },
              contentDetails: { duration: `PT${pipedData.duration || 0}S` },
              statistics: { viewCount: pipedData.views || "0" },
              streams: {
                total_available: allFormats.length,
                audio: allFormats.filter(f => f.mimeType.includes("audio")),
                video: allFormats.filter(f => f.mimeType.includes("video")),
                all: allFormats
              }
            }]
          }, null, 2), { headers });
        }

        return new Response(JSON.stringify({ error: "YouTube standard stream scraping is heavily throttled. Please try after some time." }), { headers, status: 403 });
      }

      const streamingData = playerJson.streamingData || {};
      const rawFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];

      // 4. सिफर और यूआरएल क्लीनअप
      const allFormats = rawFormats.map((f: any) => {
        let url = f.url || "";
        if (!url && f.signatureCipher) {
          const params = new URLSearchParams(f.signatureCipher);
          url = params.get("url") || "";
          const sig = params.get("s");
          if (url && sig) {
            url += `&sig=${encodeURIComponent(sig)}`;
          }
        }
        return {
          itag: f.itag,
          quality: f.qualityLabel || f.audioQuality || "medium",
          mimeType: f.mimeType || "",
          bitrate: f.bitrate,
          contentLength: f.contentLength || "unknown",
          fps: f.fps || null,
          url: url || "N/A"
        };
      });

      const response = {
        kind: "youtube#videoListResponse",
        items: [{
          kind: "youtube#video",
          id: videoId,
          snippet: {
            title: playerJson.videoDetails?.title || "Unknown Title",
            description: playerJson.videoDetails?.shortDescription || "",
            channelTitle: playerJson.videoDetails?.author || "Unknown Channel",
            thumbnails: playerJson.videoDetails?.thumbnail?.thumbnails || []
          },
          contentDetails: { duration: `PT${playerJson.videoDetails?.lengthSeconds || 0}S` },
          statistics: { viewCount: playerJson.videoDetails?.viewCount || "0" },
          streams: {
            total_available: allFormats.length,
            audio: allFormats.filter(f => f.mimeType.includes("audio/")),
            video: allFormats.filter(f => f.mimeType.includes("video/")),
            all: allFormats
          }
        }]
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
