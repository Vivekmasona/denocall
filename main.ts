// Deno Deploy Compatible Multi-Site Video Extractor (Instagram, Facebook, YouTube, etc.)

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
      // Hum open-source Cobalt API ka use kar rahe hain jo piche backend me yt-dlp hi chalata hai
      const cobaltApi = "https://api.cobalt.tools/api/json";
      
      const response = await fetch(cobaltApi, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: targetUrl,
          videoQuality: "720", // Options: 144, 240, 360, 480, 720, 1080, max
          audioFormat: "mp3",
          downloadMode: "auto", // Automatically detects video or audio
        }),
      });

      if (!response.ok) {
        const errData = await response.text();
        throw new Error(`Extraction failed: ${errData}`);
      }

      const data = await response.json();

      // Response wrapper ko aapke according clean structure me convert kar rahe hain
      const finalResult = {
        success: true,
        source_url: targetUrl,
        status: data.status, // "stream", "redirect", "picker"
        download_url: data.url || "N/A", // Direct downloadable video/audio link
        picker_items: data.picker || [], // Agar multiple qualities/photos hain (like Insta Carousel)
        text: data.text || ""
      };

      return new Response(JSON.stringify(finalResult, null, 2), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { headers, status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "404 Not Found" }), { headers, status: 404 });
});
