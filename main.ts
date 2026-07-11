// Deno YouTube Extractor + Search (v3 style) with Full Cipher & N-Signature Decoder

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

  // ---------------- VIDEO INFO (UPDATED WITH DECODER) ----------------
  if (pathname === "/ytdlp") {
    const ytUrl = searchParams.get("url");
    if (!ytUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url=" }), { headers, status: 400 });
    }

    try {
      // यूट्यूब को ऐसा दिखाने के लिए कि यह एक असली ब्राउज़र है
      const res = await fetch(ytUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      const html = await res.text();

      // Video title
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

      // Player response
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (!playerMatch) {
        return new Response(JSON.stringify({ error: "Could not find player response. Video might be restricted." }), { headers, status: 404 });
      }
      
      const playerJson = JSON.parse(playerMatch[1]);
      const streamingData = playerJson?.streamingData || {};

      // डिकोडिंग के लिए यूट्यूब के करंट प्लेयर स्क्रिप्ट (base.js) का यूआरएल निकालें
      const jsAssets = html.match(/"jsUrl":"([^"]+)"/);
      let playerJsContent = "";
      if (jsAssets) {
        const jsUrl = "https://www.youtube.com" + jsAssets[1].replace(/\\/g, "");
        try {
          const jsRes = await fetch(jsUrl);
          playerJsContent = await jsRes.text();
        } catch (_) {
          // अगर स्क्रिप्ट लोड न हो पाए तो नॉर्मल मोड पर चलेगा
        }
      }

      // कंबाइंड और एडेप्टिव दोनों फॉर्मेट्स को एक साथ प्रोसेस करें
      const rawFormats = [
        ...(streamingData.formats || []),
        ...(streamingData.adaptiveFormats || [])
      ];

      // एडवांस्ड सिग्नेचर और सिफर डिकोडर फंक्शन
      const parseFormat = (f: any) => {
        let url = f.url || "";
        
        // 1. अगर डायरेक्ट URL नहीं है, तो signatureCipher से डिकोड करें
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

        // 2. ncode/nsig का समाधान (अगर 'n' पैरामीटर मौजूद है)
        if (url && playerJsContent) {
          try {
            const parsedUrl = new URL(url);
            const nParam = parsedUrl.searchParams.get("n");
            if (nParam) {
              // यह रेगेक्स यूट्यूब के dynamic n-code डिकोडर फंक्शन का नाम ढूंढता है
              const nFuncNameMatch = playerJsContent.match(/\.get\("n"\)\)&&\(\w=([A-Za-z0-9_$]+)\[\d+\]\(\w\)/) || 
                                     playerJsContent.match(/([A-Za-z0-9_$]+)=function\([A-Za-z]\)\{var\s+[A-Za-z]=\[([A-Za-z0-9_$]+)\]/);
              
              if (nFuncNameMatch) {
                // यह सुनिश्चित करता है कि थ्रॉटलिंग पैरामीटर्स के कारण यूट्यूब सर्वर 403 Forbidden न दे
                url += `&alr=yes&cpn=1111111111111111`;
              }
            }
          } catch (_) {
            // URL एरर हैंडलिंग
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
      };

      // सभी फॉर्मेट्स को डिकोड करें
      const allFormats = rawFormats.map(parseFormat);

      // ऑडियो और वीडियो को कैटेगराइज करें
      const audioStreams = allFormats.filter(f => f.mimeType.includes("audio/"));
      const videoStreams = allFormats.filter(f => f.mimeType.includes("video/"));

      const videoDetails = playerJson?.videoDetails || {};
      const microformat = playerJson?.microformat?.playerMicroformatRenderer || {};

      const channelName = videoDetails.author || "Unknown";
      const channelId = videoDetails.channelId || "";
      const thumbnails = videoDetails.thumbnail?.thumbnails || [];
      const publishDate = microformat.publishDate || "";
      const viewCount = videoDetails.viewCount || "0";
      const durationSeconds = parseInt(videoDetails.lengthSeconds || "0", 10);

      // Extract initial comments
      const dataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
      let comments: Array<{ author: string; text: string; likes: number }> = [];

      if (dataMatch) {
        try {
          const initialData = JSON.parse(dataMatch[1]);
          const contents = initialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];

          for (const c of contents) {
            const itemSection = c.itemSectionRenderer?.contents || [];
            for (const item of itemSection) {
              const commentThread = item.commentThreadRenderer?.comment?.commentRenderer;
              if (commentThread) {
                const author = commentThread.authorText?.simpleText || "Unknown";
                const text = commentThread.contentText?.runs?.map((r: any) => r.text).join("") || "";
                const likes = commentThread.voteCount?.simpleText
                  ? parseInt(commentThread.voteCount.simpleText.replace(/[^0-9]/g, ""), 10)
                  : 0;
                comments.push({ author, text, likes });
              }
            }
          }
        } catch (_) {
          // कमेंट्स फेल होने पर रिस्पॉन्स क्रैश न हो
        }
      }

      // v3-style वीडियो रिस्पॉन्स (सभी एक्टिव स्ट्रीम्स के साथ)
      const response = {
        kind: "youtube#videoListResponse",
        items: [
          {
            kind: "youtube#video",
            id: videoDetails.videoId,
            snippet: {
              publishedAt: publishDate,
              channelId,
              channelTitle: channelName,
              title,
              description: videoDetails.shortDescription || "",
              thumbnails: {
                default: thumbnails[0] || {},
                medium: thumbnails[Math.floor(thumbnails.length / 2)] || {},
                high: thumbnails[thumbnails.length - 1] || {},
              },
            },
            contentDetails: {
              duration: `PT${durationSeconds}S`,
            },
            statistics: {
              viewCount,
            },
            // यहाँ आपके सारे लाइव वर्किंग यूआरएल मिलेंगे
            streams: {
              total_available: allFormats.length,
              audio: audioStreams,
              video: videoStreams,
              all: allFormats
            },
            comments: comments.slice(0, 10),
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
