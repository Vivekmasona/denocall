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
    // RapidAPI / no-key fallback public endpoint (no binary needed)
    const apiUrl = `https://pipedapi.kavin.rocks/streams/${extractVideoId(url)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    const audio = data.audioStreams?.sort((a: any, b: any) => b.bitrate - a.bitrate)[0];

    return new Response(
      JSON.stringify({
        status: "success",
        title: data.title || "Unknown Title",
        videoId: data.id || extractVideoId(url),
        audioUrl: audio?.url || "N/A",
        formats: data.audioStreams?.length || 0,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ status: "error", message: e.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }
});

function extractVideoId(url: string) {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : url;
}
