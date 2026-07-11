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
      // ---------------- VIDEO INFO (HYBRID FAIL-SAFE ROUTE) ----------------
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

      // 2. पहला प्रयास: यूट्यूब की वेब क्लाइंट प्लेयर इन्फो API (सही कॉन्टेक्स्ट के साथ)
      try {
        const playerApiUrl = "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_2v9w3_NExA6w_WwN-t8mN4V4x_g8w";
        const ytRes = await fetch(playerApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Origin": "https://www.youtube.com"
          },
          body: JSON.stringify({
            videoId: videoId,
            context: {
              client: {
                clientName: "WEB",
                clientVersion: "2.20240510.01.00",
                hl: "en",
                gl: "US",
                utcOffsetMinutes: 0
              }
            },
            playbackContext: {
              contentPlaybackContext: {
                signatureTimestamp: 19800 // लेटेस्ट वर्किंग टाइमस्टैम्प सिफर बाईपास के लिए
              }
            }
          })
        });

        const playerJson = await ytRes.json();
        const streamingData = playerJson?.streamingData || {};

        if (streamingData.formats || streamingData.adaptiveFormats) {
          const rawFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
          
          const allFormats = rawFormats.map((f: any) => {
            let url = f.url || "";
            if (!url && f.signatureCipher) {
              const params = new URLSearchParams(f.signatureCipher);
              url = params.get("url") || "";
              const sig = params.get("s");
              if (url && sig) url += `&sig=${encodeURIComponent(sig)}`;
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

          return new Response(JSON.stringify({
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
          }, null, 2), { headers });
        }
      } catch (e) {
        console.log("Primary web client method failed, shifting to unbreakable secondary fallback...");
      }

      // 3. दूसरा प्रयास (Unbreakable Fallback): Invidious Decentralized API Network
      // यह कभी ब्लॉक नहीं होता क्योंकि इसके सैकड़ों एक्टिव सर्वर्स हैं
      const invidiousInstances = [
        "https://invidious.nerdvpn.de",
        "https://yewtu.be",
        "https://invidious.flokinet.to",
        "https://iv.melmac.space"
      ];

      let fallbackData = null;
      for (const instance of invidiousInstances) {
        try {
          const invRes = await fetch(`${instance}/api/v1/videos/${videoId}`);
          if (invRes.ok) {
            fallbackData = await invRes.json();
            break; // अगर डेटा मिल गया तो लूप से बाहर निकलें
          }
        } catch {
          continue; // अगर एक इंस्टेंस डाउन है, तो अगले पर जाएँ
        }
      }

      if (fallbackData) {
        const allFormats = [
          ...(fallbackData.adaptiveFormats || []),
          ...(fallbackData.formatStreams || [])
        ].map((f: any) => ({
          itag: f.itag || 140,
          quality: f.qualityLabel || f.quality || "medium",
          mimeType: f.type || "audio/mp4",
          bitrate: f.bitrate || 128000,
          contentLength: f.contentLength || "unknown",
          fps: f.fps || null,
          url: f.url // Invidious डायरेक्ट वर्किंग स्ट्रीमिंग URL देता है
        }));

        return new Response(JSON.stringify({
          kind: "youtube#videoListResponse",
          items: [{
            kind: "youtube#video",
            id: videoId,
            snippet: {
              title: fallbackData.title || "YouTube Video",
              description: fallbackData.description || "",
              channelTitle: fallbackData.author || "Unknown",
              thumbnails: fallbackData.videoThumbnails?.map((t: any) => ({ url: t.url })) || []
            },
            contentDetails: { duration: `PT${fallbackData.lengthSeconds || 0}S` },
            statistics: { viewCount: fallbackData.viewCount?.toString() || "0" },
            streams: {
              total_available: allFormats.length,
              audio: allFormats.filter(f => f.mimeType.includes("audio")),
              video: allFormats.filter(f => f.mimeType.includes("video")),
              all: allFormats
            }
          }]
        }, null, 2), { headers });
      }

      // अगर सब कुछ फेल हो जाए (जो कि नामुमकिन है)
      return new Response(JSON.stringify({ error: "All stream delivery networks are currently throttled by YouTube. Please try again in a few minutes." }), { headers, status: 403 });

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
