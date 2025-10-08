import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const clients = new Set<WebSocket>();

serve((req) => {
  const { pathname } = new URL(req.url);
  
  if (pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onopen = () => {
      clients.add(socket);
      console.log("Client connected:", clients.size);
    };
    socket.onmessage = (e) => {
      for (const client of clients) {
        if (client !== socket && client.readyState === WebSocket.OPEN) {
          client.send(e.data);
        }
      }
    };
    socket.onclose = () => clients.delete(socket);
    return response;
  }

  // Serve frontend
  if (pathname === "/" || pathname === "/index.html") {
    const html = await Deno.readTextFile("./public/index.html");
    return new Response(html, {
      headers: { "content-type": "text/html" },
    });
  }

  return new Response("404 Not Found", { status: 404 });
});
