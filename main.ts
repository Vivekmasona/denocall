import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response(
      JSON.stringify({ status: "error", message: "Missing ?url parameter" }),
      { headers: { "Content-Type": "application/json" }, status: 400 }
    );
  }

  try {
    // Run yt-dlp with JSON dump
    const process = Deno.run({
      cmd: ["yt-dlp", "--dump-json", url],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await process.output();
    const errorOutput = await process.stderrOutput();
    const status = await process.status();

    process.close();

    if (!status.success) {
      const errText = new TextDecoder().decode(errorOutput);
      return new Response(
        JSON.stringify({ status: "error", message: errText }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const jsonText = new TextDecoder().decode(output);
    const data = JSON.parse(jsonText);

    // Pick best audio URL
    let audioUrl = "N/A";
    if (data.formats && data.formats.length) {
      const audioFormats = data.formats.filter((f: any) => f.acodec !== "none");
      if (audioFormats.length) {
        // Sort by bitrate or preference
        audioFormats.sort((a: any, b: any) => (b.abr || 0) - (a.abr || 0));
        audioUrl = audioFormats[0].url;
      }
    }

    const result = {
      status: "success",
      title: data.title,
      videoId: data.id,
      audioUrl,
      formats: data.formats?.length || 0,
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }
});
