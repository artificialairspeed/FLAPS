import express from "express";
import compression from "compression";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const APP_NAME = "FLAPS | Fibonacci Lean Agile Pointing System";

// Configuration constants
const ROOM_IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const MODERATOR_KEY_LENGTH = 18;
const MAX_ROOM_ID_LENGTH = 50;
const MAX_NAME_LENGTH = 50;
const MAX_STORY_NUMBER_LENGTH = 50;
const MAX_STORY_TITLE_LENGTH = 200;
const MAX_STORY_DESC_LENGTH = 2000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || false,
    credentials: true
  }
});

// Enable gzip/brotli compression
app.use(compression());

// Trust Railway's reverse proxy so req.ip, req.protocol, and req.secure are accurate
app.set("trust proxy", 1);

// Redirect HTTP → HTTPS in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && req.protocol === "http") {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Security headers
app.use((req, res, next) => {
  // Tell browsers to always use HTTPS for this domain for 1 year
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Disallow embedding in iframes (clickjacking protection)
  res.setHeader("X-Frame-Options", "DENY");
  // Legacy XSS filter for older browsers
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Cache control for static assets
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
  etag: true,
  lastModified: true
}));

app.get(["/room/:roomId", "/"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = new Map();

// Deck configuration:
// - Extended Fibonacci sequence with modifications
// - 0.5 for very small tasks
// - Question mark (?) for "unknown/can't estimate"
// - Coffee cup (☕) represents value 0 for calculations (break/pause)
// - Extended to include 55, 89, 144 for larger epics
const COFFEE_CARD = "☕";
const FIBONACCI_DECK = ["?", "0.5", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "144", COFFEE_CARD];
const ROOM_DECK = FIBONACCI_DECK;

function randomId(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeRoomId(roomId) {
  try {
    const decoded = decodeURIComponent(String(roomId || "")).trim().toUpperCase();
    // Limit length to prevent abuse
    return decoded.slice(0, MAX_ROOM_ID_LENGTH);
  } catch {
    return String(roomId || "").trim().toUpperCase().slice(0, MAX_ROOM_ID_LENGTH);
  }
}

function isFiniteNumberString(v) {
  const n = Number(String(v).trim());
  return Number.isFinite(n);
}

function sanitizeString(str, maxLength) {
  return String(str || "").trim().slice(0, maxLength);
}

function isValidUrl(str) {
  if (!str) return true; // Empty is valid (optional field)
  try {
    const url = new URL(str.match(/^https?:\/\//i) ? str : `https://${str}`);
    // Block javascript: and data: URLs
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getOrCreateRoom(roomId) {
  roomId = normalizeRoomId(roomId);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      deck: ROOM_DECK,
      phase: "voting",
      story: { number: "", title: "Add Story to Queue", desc: "", finalPoints: null },
      storyQueue: [],
      activeStoryId: null,
      users: {},
      moderatorKey: randomId(MODERATOR_KEY_LENGTH),
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
      const isMod = u.isModerator || false;
      return [id, { name: u.name, vote, isModerator: isMod }];
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

  try {
    // Efficient broadcast using Socket.IO's room broadcast
    const sockets = await io.in(roomId).fetchSockets();
    for (const s of sockets) {
      s.emit("room:state", makeRoomState(room, s));
    }
  } catch (err) {
    console.error(`[broadcastRoom] Error broadcasting to room ${roomId}:`, err);
  }
}

function requireModerator(room, socket) {
  return isModerator(room, socket.data.modKey);
}

// Rate limiting: track event counts per socket
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 50; // max events per window

function checkRateLimit(socketId) {
  const now = Date.now();
  const record = rateLimits.get(socketId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  } else {
    record.count++;
  }
  
  rateLimits.set(socketId, record);
  return record.count <= RATE_LIMIT_MAX;
}

io.on("connection", (socket) => {
  // Clean up rate limit on disconnect
  socket.on("disconnect", () => {
    rateLimits.delete(socket.id);
  });
  socket.on("room:create", ({ desiredRoomId, name } = {}) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit("error", { message: "Rate limit exceeded. Please slow down." });
      return;
    }

    let roomId = normalizeRoomId(desiredRoomId) || randomId(5);
    while (rooms.has(roomId)) roomId = randomId(5);

    const room = getOrCreateRoom(roomId);

    socket.emit("room:created", { roomId: room.roomId, modKey: room.moderatorKey });

    socket.data.roomId = room.roomId;
    socket.data.modKey = room.moderatorKey;

    socket.join(room.roomId);

    const sanitizedName = sanitizeString(name || "Facilitator", MAX_NAME_LENGTH) || "Facilitator";
    room.users[socket.id] = {
      name: sanitizedName,
      vote: null,
      isModerator: true
    };

    room.lastActiveAt = Date.now();
    broadcastRoom(room.roomId);
  });

  socket.on("room:join", ({ roomId, name, modKey } = {}) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit("error", { message: "Rate limit exceeded. Please slow down." });
      return;
    }

    roomId = normalizeRoomId(roomId);
    if (!roomId) return;

    const room = getOrCreateRoom(roomId);

    socket.data.roomId = roomId;
    socket.data.modKey = modKey || null;

    socket.join(roomId);

    const sanitizedName = sanitizeString(name || "Anonymous", MAX_NAME_LENGTH) || "Anonymous";
    room.users[socket.id] = {
      name: sanitizedName,
      vote: null,
      isModerator: isModerator(room, modKey)
    };

    room.lastActiveAt = Date.now();
    broadcastRoom(roomId);
  });

  socket.on("vote:set", ({ roomId, vote } = {}) => {
    if (!checkRateLimit(socket.id)) return;

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
    if (!checkRateLimit(socket.id)) return;

    roomId = normalizeRoomId(roomId) || socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!requireModerator(room, socket)) return;

    const title = sanitizeString(story?.title, MAX_STORY_TITLE_LENGTH);
    if (!title) return;

    const number = sanitizeString(story?.number, MAX_STORY_NUMBER_LENGTH);
    const desc = sanitizeString(story?.desc, MAX_STORY_DESC_LENGTH);

    room.storyQueue.push({
      id: randomId(8),
      number,
      title,
      desc,
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
      room.story = { number: "", title: "Add Story to Queue", desc: "", finalPoints: null };
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
      number: found.number,
      title: found.title,
      desc: found.desc,
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

// Room cleanup with proper interval management
let cleanupIntervalId = null;

function startRoomCleanup() {
  if (cleanupIntervalId) return; // Already running
  
  cleanupIntervalId = setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      const empty = Object.keys(room.users).length === 0;
      const idle = now - room.lastActiveAt > ROOM_IDLE_TIMEOUT;
      if (empty && idle) {
        rooms.delete(roomId);
        console.log(`[cleanup] Removed idle room: ${roomId}`);
      }
    }
  }, CLEANUP_INTERVAL);
}

function stopRoomCleanup() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// Start cleanup
startRoomCleanup();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received, closing server gracefully...');
  stopRoomCleanup();
  server.close(() => {
    console.log('[shutdown] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received, closing server gracefully...');
  stopRoomCleanup();
  server.close(() => {
    console.log('[shutdown] Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`${APP_NAME} running at http://localhost:${PORT}`));
