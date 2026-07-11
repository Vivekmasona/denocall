// Deno Deploy Multi-Extractor: Direct Facebook & Instagram Parser with CORS

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
      JSON.stringify({ status: "running", message: "Use /extract?url=..." }, null, 2),
      { headers }
    );
  }

  if (pathname === "/extract") {
    const targetUrl = searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), { headers, status: 400 });
    }

    try {
      // Kisi bhi bot blocker ko bypass karne ke liye generic User-Agent
      const fetchHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      };

      const res = await fetch(targetUrl, { headers: fetchHeaders });
      const html = await res.text();

      let videoUrlHD = "";
      let videoUrlSD = "";
      let title = "Social Media Video";
      let thumbnail = "";

      // ---------------- FACEBOOK PARSING ENGINE ----------------
      if (targetUrl.includes("facebook.com") || targetUrl.includes("fb.watch") || targetUrl.includes("share/r")) {
        // Facebook ke graph/source se HD aur SD video links extract karna
        const hdMatch = html.match(/"browser_native_hd_url":"([^"]+)"/) || html.match(/hd_src:"([^"]+)"/);
        const sdMatch = html.match(/"browser_native_sd_url":"([^"]+)"/) || html.match(/sd_src:"([^"]+)"/);
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        const thumbMatch = html.match(/"preferred_thumbnail":{"image":{"uri":"([^"]+)"/);

        if (hdMatch) videoUrlHD = JSON.parse(`"${hdMatch[1]}"`); // Clean unicode escapes
        if (sdMatch) videoUrlSD = JSON.parse(`"${sdMatch[1]}"`);
        if (titleMatch) title = titleMatch[1];
        if (thumbMatch) thumbnail = JSON.parse(`"${thumbMatch[1]}"`);
      } 
      
      // ---------------- INSTAGRAM PARSING ENGINE ----------------
      else if (targetUrl.includes("instagram.com")) {
        // Instagram og:video tags ya meta data formats check karta hai
        const instaMatch = html.match(/<meta property="og:video" content="([^"]+)"/) || html.match(/"video_url":"([^"]+)"/);
        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
        const thumbMatch = html.match(/<meta property="og:image" content="([^"]+)"/);

        if (instaMatch) videoUrlHD = instaMatch[1].replace(/&amp;/g, "&");
        if (titleMatch) title = titleMatch[1];
        if (thumbMatch) thumbnail = thumbMatch[1].replace(/&amp;/g, "&");
      }

      // Agar koi direct link nahi mila toh check generic video tags
      if (!videoUrlHD && !videoUrlSD) {
        const genericMatch = html.match(/<meta property="og:video:url" content="([^"]+)"/);
        if (genericMatch) videoUrlHD = genericMatch[1];
      }

      // Final response build jo aapke format list se match karega
      const formats = [];
      if (videoUrlHD) {
        formats.push({
          format_id: "HD / Best",
          url: videoUrlHD,
          ext: "mp4",
          resolution: "High Quality"
        });
      }
      if (videoUrlSD) {
        formats.push({
          format_id: "SD / Standard",
          url: videoUrlSD,
          ext: "mp4",
          resolution: "Standard Quality"
        });
      }

      if (formats.length === 0) {
        throw new Error("Could not find any downloadable video stream in page source.");
      }

      const response = {
        success: true,
        title: title,
        thumbnail: thumbnail,
        direct_url: videoUrlHD || videoUrlSD,
        formats: formats
      };

      return new Response(JSON.stringify(response, null, 2), { headers });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Extraction failed: " + err.message, note: "Deno Deploy Native Engine" }), 
        { headers, status: 500 }
      );
    }
  }

  return new Response(JSON.stringify({ error: "404 Not Found" }), { headers, status: 404 });
});
