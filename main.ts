// biharfm_deno_server.js
// Deno YouTube Extractor + Search + BiharFM Signaling Server (4-listener rooms)

// Configuration (Max listeners per room)
const MAX_PER_ROOM = 4; 

// Memory state (Deno isolates memory across sessions)
// clientId -> { ws, role, customId, roomId }
const clients = new Map();
// roomId -> Set(clientId)
const rooms = new Map();

function genRoomId() {
  const n = Math.floor(1000 + Math.random() * 90000);
  return `fm${n}`;
}

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return; // 1 means OPEN in WebSockets
  try { 
    ws.send(JSON.stringify(obj)); 
  } catch (_) {}
}

function findRoomWithSpace() {
  for (const [rid, set] of rooms.entries()) {
    if (set.size < MAX_PER_ROOM) return rid;
  }
  return null;
}

function addToRoom(clientId, roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(clientId);
  const c = clients.get(clientId);
  if (c) c.roomId = roomId;
}

function removeFromRoom(clientId) {
  const c = clients.get(clientId);
  if (!c || !c.roomId) return;
  const r = c.roomId;
  const set = rooms.get(r);
  if (set) {
    set.delete(clientId);
    if (set.size === 0) rooms.delete(r);
  }
  delete c.roomId;
}

// ---------------- HELPER: YouTube Fetcher & Scraper ----------------
async function fetchYouTubeSearchResults(searchQuery) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
    const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    const html = await res.text();

    const dataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
    if (!dataMatch) return [];

    const initialData = JSON.parse(dataMatch[1]);
    const contents =
      initialData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
        ?.flatMap((c) => c.itemSectionRenderer?.contents || []) || [];

    const items = [];
    for (const item of contents) {
      const video = item.videoRenderer;
      if (video) {
        const videoId = video.videoId;
        const title = video.title?.runs?.map((r) => r.text).join("") || "Unknown";
        const channelTitle = video.ownerText?.runs?.map((r) => r.text).join("") || "Unknown";
        const thumbnails = video.thumbnail?.thumbnails || [];
        const description = video.descriptionSnippet?.runs?.map((r) => r.text).join("") || "";

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
    return items;
  } catch (_) {
    return [];
  }
}

// ---------------- HELPER: Festival & Language Aware Query Builder ----------------
function buildSmartQuery(userQuery) {
  const now = new Date();
  const month = now.getMonth() + 1; // 1 to 12
  const currentYear = now.getFullYear();

  let festivalKeyword = "";
  if (month === 3) festivalKeyword = "Holi special song";
  else if (month === 8) festivalKeyword = "Independence Day Rakhi song";
  else if (month === 10 || month === 11) festivalKeyword = "Diwali Navratri Garba song";
  else if (month === 12 || month === 1) festivalKeyword = "New Year DJ party song";
  else festivalKeyword = "hit trending song";

  const lowerQuery = userQuery.toLowerCase().trim();
  const genericTerms = ["hindi", "bhojpuri", "punjabi", "haryanvi", "song", "gaana", "songs"];

  // अगर यूजर सिर्फ जेनेरिक शब्द (जैसे "hindi" या "bhojpuri") टाइप करता है
  if (genericTerms.includes(lowerQuery)) {
    return `${userQuery} ${festivalKeyword} ${currentYear} latest`;
  }

  return userQuery;
}

// Handle BiharFM WebSocket Connections
function handleWebSocket(req) {
  const { socket: ws, response } = Deno.upgradeWebSocket(req);
  const id = crypto.randomUUID();

  ws.onopen = () => {
    clients.set(id, { ws, role: null, customId: id, roomId: null });
    console.log("→ connected:", id);
  };

  ws.onmessage = (event) => {
    let msg;
    try { 
      msg = JSON.parse(event.data.toString()); 
    } catch { 
      return; 
    }
    
    const { type, role, customId, target, payload } = msg;
    const entry = clients.get(id);
    if (!entry) return;

    // --- Registration ---
    if (type === "register") {
      entry.role = role || "listener";
      if (customId) entry.customId = customId;

      // --- Listener logic ---
      if (entry.role === "listener") {
        let roomId = findRoomWithSpace();
        if (!roomId) roomId = genRoomId();
        addToRoom(id, roomId);
        safeSend(ws, { type: "room-assigned", roomId });
        console.log(`listener ${entry.customId} -> ${roomId} (${rooms.get(roomId).size}/${MAX_PER_ROOM})`);

        // Notify broadcaster(s)
        for (const [, c] of clients) {
          if (c.role === "broadcaster") {
            safeSend(c.ws, { type: "listener-joined", id, roomId });
          }
        }
      }

      // --- Broadcaster logic ---
      if (entry.role === "broadcaster") {
        console.log("▶ broadcaster registered");
        const list = Array.from(rooms.entries()).map(([r, s]) => ({ roomId: r, count: s.size }));
        safeSend(ws, { type: "rooms-info", rooms: list });
      }
      return;
    }

    // --- WebRTC signaling relay ---
    if (["offer", "answer", "candidate"].includes(type) && target) {
      const t = clients.get(target);
      if (t) safeSend(t.ws, { type, from: id, payload });
      return;
    }

    // --- Metadata broadcast ---
    if (type === "metadata" && clients.get(id)?.role === "broadcaster") {
      for (const [_, c] of clients.entries()) {
        if (c.role === "listener") safeSend(c.ws, { type: "metadata", ...payload });
      }
      return;
    }

    // --- Room message broadcast ---
    if (type === "room-message") {
      const c = clients.get(id);
      if (!c || !c.roomId) return;
      const set = rooms.get(c.roomId) || new Set();
      for (const cid of set) {
        if (cid === id) continue;
        const peer = clients.get(cid);
        if (peer) safeSend(peer.ws, { type: "room-message", from: id, payload });
      }
      return;
    }
  };

  const handleDisconnect = () => {
    console.log("← disconnected:", id);
    const entry = clients.get(id);
    const roomId = entry?.roomId;
    removeFromRoom(id);
    clients.delete(id);
    for (const [, c] of clients) {
      if (c.role === "broadcaster") safeSend(c.ws, { type: "peer-left", id, roomId });
    }
    if (roomId) console.log(`room ${roomId} now ${(rooms.get(roomId)?.size || 0)}/${MAX_PER_ROOM}`);
  };

  ws.onclose = handleDisconnect;
  ws.onerror = handleDisconnect;

  return response;
}

// --- MAIN DENO HTTP & WS ROUTER ---
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

  // Upgrade HTTP to WebSocket for signaling if client requests it
  if (req.headers.get("upgrade") === "websocket") {
    return handleWebSocket(req);
  }

  // Home Route
  if (pathname === "/") {
    return new Response(
      JSON.stringify({ 
        status: "running", 
        message: "🎧 BiharFM ready. Connect via WebSocket for Signaling, or use /ytdlp and /search endpoints." 
      }, null, 2),
      { headers }
    );
  }

  // ---------------- VIDEO INFO (/ytdlp) ----------------
  if (pathname === "/ytdlp") {
    const ytUrl = searchParams.get("url");
    if (!ytUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url=" }), { headers, status: 400 });
    }

    try {
      const res = await fetch(ytUrl);
      const html = await res.text();

      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown";

      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      const playerJson = playerMatch ? JSON.parse(playerMatch[1]) : null;

      const formats = playerJson?.streamingData?.formats || [];
      const adaptive = playerJson?.streamingData?.adaptiveFormats || [];
      const audio =
        adaptive.find((f) => f.mimeType.includes("audio")) ||
        formats.find((f) => f.mimeType.includes("audio"));

      const videoDetails = playerJson?.videoDetails || {};
      const microformat = playerJson?.microformat?.playerMicroformatRenderer || {};

      const channelName = videoDetails.author || "Unknown";
      const channelId = videoDetails.channelId || "";

      const thumbnails = videoDetails.thumbnail?.thumbnails || [];
      const publishDate = microformat.publishDate || "";
      const viewCount = videoDetails.viewCount || "0";
      const durationSeconds = parseInt(videoDetails.lengthSeconds || "0", 10);

      const dataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
      let comments = [];

      if (dataMatch) {
        const initialData = JSON.parse(dataMatch[1]);
        const contents =
          initialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];

        for (const c of contents) {
          const itemSection = c.itemSectionRenderer?.contents || [];
          for (const item of itemSection) {
            const commentThread = item.commentThreadRenderer?.comment?.commentRenderer;
            if (commentThread) {
              const author = commentThread.authorText?.simpleText || "Unknown";
              const text =
                commentThread.contentText?.runs?.map((r) => r.text).join("") || "";
              const likes = commentThread.voteCount?.simpleText
                ? parseInt(commentThread.voteCount.simpleText.replace(/[^0-9]/g, ""), 10)
                : 0;
              comments.push({ author, text, likes });
            }
          }
        }
      }

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
            audioUrl: audio?.url || "N/A",
            comments: comments.slice(0, 10),
          },
        ],
      };

      return new Response(JSON.stringify(response, null, 2), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { headers, status: 500 });
    }
  }

  // ---------------- SEARCH (/search) ----------------
  if (pathname === "/search") {
    const rawQuery = searchParams.get("q");
    if (!rawQuery) {
      return new Response(JSON.stringify({ error: "Missing ?q=" }), { headers, status: 400 });
    }

    try {
      const smartQuery = buildSmartQuery(rawQuery);

      // 1. भाषा / शैली (Language/Genre) पहचानें
      let languageOrGenre = "hindi";
      if (/bhojpuri|भोजपुरी/i.test(rawQuery)) languageOrGenre = "bhojpuri";
      else if (/punjabi|पंजाबी/i.test(rawQuery)) languageOrGenre = "punjabi";
      else if (/haryanvi|हरयाणवी/i.test(rawQuery)) languageOrGenre = "haryanvi";

      const currentYear = new Date().getFullYear();

      // 2. एक साथ (Parallel) दो YouTube Requests भेजें:
      // A: यूजर का मुख्य गाना
      // B: उसी भाषा के उसी समय के अन्य सुपरहिट गाने
      const [exactResults, trendingResults] = await Promise.all([
        fetchYouTubeSearchResults(`${smartQuery} official video`),
        fetchYouTubeSearchResults(`${languageOrGenre} new hit song ${currentYear} trending`)
      ]);

      const items = [];
      const seenVideoIds = new Set();
      const seenTitles = new Set();

      // 3. फ़िल्टरिंग और डुप्लीकेट हटाने का स्मार्ट लॉजिक
      const addValidItem = (item) => {
        const vId = item.id?.videoId;
        if (!vId || seenVideoIds.has(vId)) return;

        const titleLower = item.snippet.title.toLowerCase();

        // 3a. रीमिक्स / लो-फि / स्टेटस वाले फालतू डुप्लीकेट्स को फ़िल्टर करें
        const isJunkDuplicate = /remix|lofi|slowed|reverb|status|8d audio|30 sec|full screen status/i.test(titleLower);
        
        // 3b. मुख्य टाइटल के आधार पर समान गाने को रिजेक्ट करें
        const baseTitle = titleLower.split("|")[0].split("-")[0].trim();

        if (!seenTitles.has(baseTitle) && (!isJunkDuplicate || items.length === 0)) {
          seenVideoIds.add(vId);
          seenTitles.add(baseTitle);
          items.push(item);
        }
      };

      // पहले मुख्य गाने के 1-2 बेस्ट रिजल्ट्स डालें
      exactResults.slice(0, 3).forEach(addValidItem);

      // फिर उसी भाषा/समय के सुपरहिट गाने लिस्ट में नीचे जोड़ें
      trendingResults.forEach(addValidItem);

      // अगर फ़िल्टरिंग के कारण बहुत कम गाने बचे तो बैकअप में ओरिजिनल सर्च रिजल्ट्स भी जोड़ लें
      if (items.length < 5) {
        exactResults.forEach(addValidItem);
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
