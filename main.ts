// Multi-Site Extractor using real yt-dlp binary (For Render / Railway)

Deno.serve({ port: 8080 }, async (req) => {
  const { pathname, searchParams } = new URL(req.url);

  const headers = {
    "content-type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  if (pathname === "/") {
    return new Response(JSON.stringify({ status: "running", hook: "/extract?url=..." }), { headers });
  }

  if (pathname === "/extract") {
    const targetUrl = searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url=" }), { headers, status: 400 });
    }

    try {
      // System ke yt-dlp ko call kar rahe hain
      const command = new Deno.Command("yt-dlp", {
        args: [
          "--dump-json",
          "--no-playlist",
          "--break-on-existing", 
          targetUrl
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { success, stdout, stderr } = await command.output();

      if (!success) {
        const errorString = new TextDecoder().decode(stderr);
        throw new Error(`yt-dlp error: ${errorString}`);
      }

      const rawJson = new TextDecoder().decode(stdout);
      const ytData = JSON.parse(rawJson);

      // Sabhi platforms (Insta, FB, YT) ke liye common response structure
      const result = {
        success: true,
        title: ytData.title || "No Title",
        extractor: ytData.extractor, // e.g., "Instagram", "Facebook", "Youtube"
        thumbnail: ytData.thumbnail || "",
        duration: ytData.duration || 0,
        // Best quality mixed video+audio URL (Aksar Insta/FB par direct single link mil jata hai)
        direct_download_url: ytData.url || "", 
        // Saare available formats (Video only, Audio only, Adaptive)
        formats: ytData.formats?.map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || `${f.width}x${f.height}`,
          url: f.url,
          vcodec: f.vcodec,
          acodec: f.acodec,
          filesize: f.filesize || f.filesize_approx || "Unknown"
        })) || []
      };

      return new Response(JSON.stringify(result, null, 2), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { headers, status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "404 Not Found" }), { headers, status: 404 });
});
