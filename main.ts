// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const clients = new Map<string, WebSocket>();

serve((req) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response("This is a WebSocket signaling server", {
      headers: { "content-type": "text/plain" },
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => console.log("🔌 Client connected");

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.join) {
        // Save client in map
        clients.set(data.join, socket);
        socket.send(JSON.stringify({ joined: data.join }));
      } else if (data.to && clients.has(data.to)) {
        // Relay signaling data
        clients.get(data.to)!.send(JSON.stringify(data));
      }
    } catch (err) {
      console.error("❌ Invalid message:", err);
    }
  };

  socket.onclose = () => {
    for (const [id, s] of clients.entries()) {
      if (s === socket) clients.delete(id);
    }
  };

  return response;
});
