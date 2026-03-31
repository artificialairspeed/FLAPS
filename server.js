import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const APP_NAME = "FLAPS | Fibonacci Lean Agile Pointing System";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get(["/room/:roomId", "/"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = new Map();

// Deck configuration:
// - Standard Fibonacci sequence with modifications
// - Coffee cup (☕) replaces 55 and represents value 0 for calculations
// - Question mark (?) replaces 0 for "unknown/can't estimate"
// - Removed 89 card
const COFFEE_CARD = "☕";
const FIBONACCI_DECK = ["?", "1", "2", "3", "5", "8", "13", "21", "34", COFFEE_CARD];
const ROOM_DECK = FIBONACCI_DECK;

function randomId(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeRoomId(roomId) {
  try {
    return decodeURIComponent(String(roomId || "")).trim().toUpperCase();
  } catch {
    return String(roomId || "").trim().toUpperCase();
  }
}

function isFiniteNumberString(v) {
  const n = Number(String(v).trim());
  return Number.isFinite(n);
}

function getOrCreateRoom(roomId) {
  roomId = normalizeRoomId(roomId);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      deck: ROOM_DECK,
      phase: "voting",
      story: { title: "Add a story to estimate", desc: "", link: "", finalPoints: null },
      storyQueue: [],
      activeStoryId: null,
      users: {},
      moderatorKey: randomId(18),
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });
  }

  return rooms.get(roomId);
}

function isModerator(room, modKey) {
  return !!modKey && modKey === room.moderatorKey;
}

function makeRoomState(room, socket) {
  const modKey = socket.data.modKey;
  const youAreModerator = isModerator(room, modKey);

  const users = Object.fromEntries(
    Object.entries(room.users).map(([id, u]) => {
      const vote = room.phase === "revealed" ? u.vote : (u.vote ? "selected" : null);
      return [id, { name: u.name, vote }];
    })
  );

  return {
    roomId: room.roomId,
    deck: room.deck,
    phase: room.phase,
    story: room.story,
    storyQueue: room.storyQueue,
    activeStoryId: room.activeStoryId,
    users,
    youAreModerator,
    mySocketId: socket.id
  };
}

async function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Per-socket state because moderator view differs per user
  const sockets = await io.in(roomId).fetchSockets();
  for (const s of sockets) s.emit("room:state", makeRoomState(room, s));
}

function requireModerator(room, socket) {
  return isModerator(room, socket.data.modKey);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ desiredRoomId, name } = {}) => {
    let roomId = normalizeRoomId(desiredRoomId) || randomId(5);
    while (rooms.has(roomId)) roomId = randomId(5);

    const room = getOrCreateRoom(roomId);

    socket.emit("room:created", { roomId: room.roomId, modKey: room.moderatorKey });

    socket.data.roomId = room.roomId;
    socket.data.modKey = room.moderatorKey;

    socket.join(room.roomId);

    room.users[socket.id] = {
      name: (name || "Facilitator").trim() || "Facilitator",
      vote: null
    };

    room.lastActiveAt = Date.now();
    broadcastRoom(room.roomId);
  });

  socket.on("room:join", ({ roomId, name, modKey } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!roomId) return;

    const room = getOrCreateRoom(roomId);

    socket.data.roomId = roomId;
    socket.data.modKey = modKey || null;

    socket.join(roomId);

    room.users[socket.id] = {
      name: (name || "Anonymous").trim() || "Anonymous",
      vote: null
    };

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("vote:set", ({ roomId, vote } = {}) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.phase !== "voting") return;
    if (!room.users[socket.id]) return;

    const v = String(vote ?? "").trim();
    if (!v) return;
    if (!room.deck.includes(v)) return;

    room.users[socket.id].vote = v;
    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("vote:clear", ({ roomId } = {}) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!requireModerator(room, socket)) return;

    room.phase = "voting";
    for (const id of Object.keys(room.users)) room.users[id].vote = null;

    if (room.activeStoryId && room.story.finalPoints !== null) {
      room.story.finalPoints = null;
      const queueEntry = room.storyQueue.find((s) => s.id === room.activeStoryId);
      if (queueEntry) queueEntry.finalPoints = null;
    }

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("vote:reveal", ({ roomId } = {}) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!requireModerator(room, socket)) return;

    room.phase = "revealed";
    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("storyQueue:add", ({ roomId, story } = {}) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!requireModerator(room, socket)) return;

    const title = String(story?.title || "").trim();
    if (!title) return;

    room.storyQueue.push({
      id: randomId(8),
      title,
      desc: String(story?.desc || "").trim(),
      link: String(story?.link || "").trim(),
      finalPoints: null
    });

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("storyQueue:remove", ({ roomId, storyId } = {}) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!requireModerator(room, socket)) return;

    const id = String(storyId || "");
    room.storyQueue = room.storyQueue.filter((s) => s.id !== id);
    if (room.activeStoryId === id) {
      room.activeStoryId = null;
      room.phase = "voting";
      room.story = { title: "Add a story to estimate", desc: "", link: "", finalPoints: null };
      for (const uid of Object.keys(room.users)) room.users[uid].vote = null;
    }

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  // ✅ ADD ACK + REASONS HERE
  socket.on("storyQueue:setActive", ({ roomId, storyId } = {}, ack) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room) {
      if (typeof ack === "function") ack({ ok: false, reason: "Room not found" });
      return;
    }
    if (!requireModerator(room, socket)) {
      if (typeof ack === "function") ack({ ok: false, reason: "Not facilitator / moderator" });
      return;
    }

    const id = String(storyId || "");
    const found = room.storyQueue.find((s) => s.id === id);

    if (!found) {
      if (typeof ack === "function") ack({ ok: false, reason: "Story not found in queue" });
      return;
    }

    room.activeStoryId = id;
    room.story = {
      title: found.title,
      desc: found.desc,
      link: found.link,
      finalPoints: found.finalPoints || null
    };

    room.phase = "voting";
    for (const uid of Object.keys(room.users)) room.users[uid].vote = null;

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);

    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("storyQueue:finalize", ({ roomId, storyId, finalPoints } = {}) => {
    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!requireModerator(room, socket)) return;

    const id = String(storyId || "");
    const points = String(finalPoints || "").trim();
    if (!id || !points) return;

    // Allow numeric values, coffee cup (as 0), and question mark for finalization
    if (points !== '☕' && points !== '?' && !isFiniteNumberString(points)) return;
    if (!room.deck.includes(points)) return;

    const item = room.storyQueue.find((s) => s.id === id);
    if (!item) return;

    item.finalPoints = points;
    if (room.activeStoryId === id) room.story.finalPoints = points;

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    delete room.users[socket.id];
    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });
});

// Room cleanup
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const empty = Object.keys(room.users).length === 0;
    const idle = now - room.lastActiveAt > 60 * 60 * 1000;
    if (empty && idle) rooms.delete(roomId);
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`${APP_NAME} running at http://localhost:${PORT}`));
