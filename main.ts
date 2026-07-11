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
      // ---------------- VIDEO INFO (RACOON / COBALT API ROUTE) ----------------
  if (pathname === "/ytdlp") {
    const ytUrl = searchParams.get("url");
    if (!ytUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url=" }), { headers, status: 400 });
    }

    try {
      // कोबाल्ट (रैकून) की ऑफिशियल/पब्लिक API एंडपॉइंट्स की लिस्ट (Fail-safe के लिए)
      const cobaltInstances = [
        "https://api.cobalt.tools",
        "https://cobalt.api.v0.pw",
        "https://api.orion.tools" // बैकअप गेटवे
      ];

      let cobaltData = null;
      let successInstance = "";

      // लूप चलाकर चेक करेंगे कि कौन सा रैकून सर्वर अभी एक्टिव और चालू है
      for (const instance of cobaltInstances) {
        try {
          const res = await fetch(instance, {
            method: "POST",
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: ytUrl,
              videoQuality: "1080", // मैक्सिमम क्वालिटी टार्गेट
              audioFormat: "mp3",    // ऑडियो के लिए बेस्ट कंपैटिबिलिटी
              filenamePattern: "basic",
              isAudioOnly: false     // अगर केवल ऑडियो चाहिए तो इसे true कर सकते हैं
            })
          });

          if (res.ok) {
            cobaltData = await res.json();
            successInstance = instance;
            break; 
          }
        } catch {
          continue; // अगर एक इंस्टेंस डाउन या थ्रॉटल है, तो तुरंत अगले पर जाओ
        }
      }

      // अगर रैकून API से लिंक मिल जाता है
      if (cobaltData && (cobaltData.url || cobaltData.picker)) {
        
        // फॉर्मैट्स को उसी आर्किटेक्चर में ढालना जैसा तुम्हारे फ्रंटएंड को चाहिए
        const allFormats = [];
        
        if (cobaltData.url) {
          allFormats.push({
            itag: 22, // डमी itag फॉर डायरेक्ट वीडियो+ऑडियो स्ट्रीम
            quality: "HD / Best available",
            mimeType: "video/mp4",
            bitrate: 2500000,
            contentLength: "unknown",
            fps: 30,
            url: cobaltData.url // यह बिल्कुल डायरेक्ट और वर्किंग स्ट्रीमिंग/डाउनलोड लिंक है
          });
        } 
        
        // अगर कोबाल्ट अलग-अलग क्वालिटी (Picker) रिटर्न करता है
        else if (cobaltData.picker) {
          cobaltData.picker.forEach((item: any, index: number) => {
            allFormats.push({
              itag: 137 + index,
              quality: item.quality || "unknown",
              mimeType: "video/mp4",
              bitrate: 1500000,
              contentLength: "unknown",
              fps: 30,
              url: item.url
            });
          });
        }

        const response = {
          kind: "youtube#videoListResponse",
          items: [{
            kind: "youtube#video",
            id: "extracted_via_racoon",
            snippet: {
              title: cobaltData.filename || "Extracted Media (Cobalt)",
              description: "Successfully processed via Racoon Bypass Mechanism.",
              channelTitle: "YouTube Stream",
              thumbnails: [{ url: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=500" }]
            },
            contentDetails: { duration: "PT0S" },
            statistics: { viewCount: "0" },
            streams: {
              total_available: allFormats.length,
              audio: allFormats.filter(f => f.mimeType.includes("audio")),
              video: allFormats.filter(f => f.mimeType.includes("video")),
              all: allFormats
            }
          }]
        };

        return new Response(JSON.stringify(response, null, 2), { headers });
      }

      // अगर रैकून के सारे सर्वर्स भी ब्लॉक मिलें
      return new Response(JSON.stringify({ 
        error: "Racoon/Cobalt network is also rejecting this request. YouTube signature block is strictly active." 
      }), { headers, status: 403 });

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
