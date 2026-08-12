import express from "express";
import compression from "compression";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
// Pure re-vote core, shared verbatim with the browser (served from public/), so
// client and server hold one definition of "finalized" and one transition.
import { applyRevote } from "./public/story-revote.js";


// Configuration constants
const ROOM_IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
// Grace period during which a disconnected user's session is retained (marked
// disconnected / "away") rather than deleted, so a reconnect within this window
// resumes it and the participant does not disappear from the roster on a
// transient lapse, sleep, or short absence. Bounded (minutes, not seconds) so
// ghosts who never return are still swept automatically instead of lingering
// forever, and still far shorter than ROOM_IDLE_TIMEOUT so grace-held sessions
// never affect idle-room cleanup.
const DISCONNECT_GRACE_MS = 10 * 60 * 1000; // 10 minutes
const MODERATOR_KEY_LENGTH = 18;
const MAX_ROOM_ID_LENGTH = 50;
const MAX_NAME_LENGTH = 20;
const MAX_STORY_NUMBER_LENGTH = 12;
const MAX_STORY_TITLE_LENGTH = 100;

// Whitelist of emojis a user may pick when joining. Must match the options
// offered in public/index.html. Anything else is rejected (empty string = none).
const ALLOWED_EMOJIS = new Set([
  "🙂",
  "😀", "😎", "🤓", "🤩", "🥳", "🚀", "🔥", "⭐", "🌈", "🦄",
  "🐱", "🐶", "🦊", "🐼", "🐸", "🦁", "🐧", "🦉", "🐢", "🍕",
  "🎸", "🎉", "🏆"
]);

// Return the emoji only if it is in the allowed set, otherwise empty string.
function sanitizeEmoji(emoji) {
  const value = String(emoji || "").trim();
  return ALLOWED_EMOJIS.has(value) ? value : "";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || false,
    credentials: true
  },
  // Give briefly-backgrounded or laggy clients more room to answer the
  // heartbeat before the server declares them dead. The default pingTimeout
  // (20s) drops clients too eagerly on transient lapses, contributing to users
  // flapping in and out; 30s tolerates short hiccups without meaningfully
  // delaying detection of genuinely dead connections. pingInterval is left at
  // its 25s default so it stays comfortably under typical proxy idle timeouts.
  pingTimeout: 30000
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
// - Question mark (?) for "unknown/can't estimate" - excluded from calculations
// - Coffee cup (☕) for "break/pause" - excluded from calculations
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

function sanitizeString(str, maxLength, allowDashes = false, allowNumbers = false) {
  const cleaned = String(str || "").trim();
  // Remove special characters based on allowed character types
  let pattern;
  if (allowDashes && allowNumbers) {
    pattern = /[^A-Za-z0-9\s\-]/g; // Jira # field: letters, numbers, spaces, dashes
  } else if (allowNumbers) {
    pattern = /[^A-Za-z0-9\s]/g; // Title: letters, numbers, spaces
  } else {
    pattern = /[^A-Za-z\s]/g; // Only letters and spaces
  }
  return cleaned.replace(pattern, '').slice(0, maxLength);
}

// Free-text sanitizer: allows any characters (including special characters).
// Only trims surrounding whitespace and enforces a max length. Values are
// always rendered client-side via textContent, so this is XSS-safe.
function sanitizeFreeText(str, maxLength) {
  return String(str || "").trim().slice(0, maxLength);
}

function getOrCreateRoom(roomId) {
  roomId = normalizeRoomId(roomId);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      deck: ROOM_DECK,
      phase: "voting",
      story: { number: "", title: "Add Story to Queue", finalPoints: null },
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

// ---------------------------------------------------------------------------
// Room state persistence (survives server restarts)
//
// In-memory rooms are otherwise lost on restart. That silently demotes a
// reconnecting facilitator to a voter: their browser presents the modKey it
// still holds, but the freshly recreated room has a brand-new moderatorKey, so
// isModerator() never matches. Persisting room state — most importantly each
// room's moderatorKey — lets a facilitator resume as moderator after a restart.
//
// Runtime-only fields (live socket handles, grace timers) are never persisted.
// On load every restored user is treated as disconnected and placed into the
// normal disconnect grace window, so records for users who never reconnect are
// cleaned up automatically instead of lingering as ghosts.
//
// Persistence is a no-op unless explicitly enabled by the live server entry
// point (see the isMainModule block below), so importing this module in tests
// never touches the filesystem.
// ---------------------------------------------------------------------------
const PERSIST_FILE = process.env.ROOMS_STATE_FILE || path.join(__dirname, ".rooms-state.json");
const PERSIST_DEBOUNCE_MS = 1000;
let persistenceEnabled = false;
let persistTimer = null;

function serializeRoomsForPersist() {
  const out = [];
  for (const room of rooms.values()) {
    const users = {};
    for (const [key, u] of Object.entries(room.users)) {
      users[key] = {
        name: u.name,
        emoji: u.emoji || "",
        vote: u.vote ?? null,
        isModerator: !!u.isModerator
      };
    }
    out.push({
      roomId: room.roomId,
      deck: room.deck,
      phase: room.phase,
      story: room.story,
      storyQueue: room.storyQueue,
      activeStoryId: room.activeStoryId,
      users,
      moderatorKey: room.moderatorKey,
      createdAt: room.createdAt,
      lastActiveAt: room.lastActiveAt
    });
  }
  return out;
}

// Synchronous write, used on graceful shutdown so the latest state is flushed
// before the process exits.
function persistRoomsSync() {
  if (!persistenceEnabled) return;
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(serializeRoomsForPersist()), { mode: 0o600 });
  } catch (err) {
    console.error("[persist] Failed to write room state:", err);
  }
}

// Debounced async write, called after every room mutation (via broadcastRoom
// and the cleanup paths). Coalesces bursts of changes into a single write.
function schedulePersist() {
  if (!persistenceEnabled) return;
  if (persistTimer) return; // A write is already scheduled within this window.
  persistTimer = setTimeout(() => {
    persistTimer = null;
    fs.writeFile(PERSIST_FILE, JSON.stringify(serializeRoomsForPersist()), { mode: 0o600 }, (err) => {
      if (err) console.error("[persist] Failed to write room state:", err);
    });
  }, PERSIST_DEBOUNCE_MS);
  if (persistTimer && typeof persistTimer.unref === "function") persistTimer.unref();
}

function loadPersistedRooms() {
  let raw;
  try {
    raw = fs.readFileSync(PERSIST_FILE, "utf-8");
  } catch {
    return; // No persisted state (fresh start) — nothing to restore.
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[persist] Corrupt room state file; starting fresh:", err);
    return;
  }
  if (!Array.isArray(parsed)) return;

  const now = Date.now();
  for (const saved of parsed) {
    if (!saved || typeof saved.roomId !== "string") continue;
    const roomId = normalizeRoomId(saved.roomId);
    if (!roomId) continue;

    const users = {};
    if (saved.users && typeof saved.users === "object") {
      for (const [key, u] of Object.entries(saved.users)) {
        if (!u || typeof u !== "object") continue;
        users[key] = {
          name: typeof u.name === "string" ? u.name : "",
          emoji: sanitizeEmoji(u.emoji),
          vote: u.vote ?? null,
          isModerator: !!u.isModerator,
          // Runtime state: there is no live socket after a restart.
          socketId: null,
          connected: false,
          disconnectedAt: now,
          graceTimer: null
        };
      }
    }

    const room = {
      roomId,
      deck: Array.isArray(saved.deck) ? saved.deck : ROOM_DECK,
      phase: saved.phase === "revealed" ? "revealed" : "voting",
      story:
        saved.story && typeof saved.story === "object"
          ? saved.story
          : { number: "", title: "Add Story to Queue", finalPoints: null },
      storyQueue: Array.isArray(saved.storyQueue) ? saved.storyQueue : [],
      activeStoryId: saved.activeStoryId ?? null,
      users,
      moderatorKey:
        typeof saved.moderatorKey === "string" && saved.moderatorKey
          ? saved.moderatorKey
          : randomId(MODERATOR_KEY_LENGTH),
      createdAt: typeof saved.createdAt === "number" ? saved.createdAt : now,
      // Refresh activity so a restored room is not immediately reaped by idle
      // cleanup before its users have a chance to reconnect.
      lastActiveAt: now
    };

    rooms.set(roomId, room);

    // Put every restored user into the normal disconnect grace window so a
    // record for someone who never reconnects is cleaned up automatically.
    for (const userKey of Object.keys(room.users)) {
      armDisconnectGrace(room, roomId, userKey);
    }
  }
}

// Resolve the stable identity key for a socket. Prefer the durable clientId
// (persisted across reconnects); fall back to the transient socket.id only when
// no clientId is present, to remain backward compatible with older clients.
function getUserKey(socket) {
  return socket.data.clientId || socket.id;
}

function makeRoomState(room, socket) {
  const modKey = socket.data.modKey;
  const youAreModerator = isModerator(room, modKey);

  const users = Object.fromEntries(
    Object.entries(room.users).map(([id, u]) => {
      const vote = room.phase === "revealed" ? u.vote : (u.vote ? "selected" : null);
      const isMod = u.isModerator || false;
      // `connected` drives the client's "away" indicator and the connected-only
      // vote tally. A record is considered present unless explicitly marked
      // disconnected during its grace window.
      const connected = u.connected !== false;
      return [id, { name: u.name, emoji: u.emoji || "", vote, isModerator: isMod, connected }];
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
    // Stable identity marker for the requesting user. Clients should key their
    // own presence off `myId` (the durable clientId). `mySocketId` is retained
    // for backward compatibility until the client migrates.
    myId: getUserKey(socket),
    mySocketId: socket.id
  };
}

async function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Every mutation funnels through broadcastRoom, so this is the single point
  // at which room state is checkpointed to disk (debounced).
  schedulePersist();

  try {
    // Efficient broadcast using Socket.IO's room broadcast
    const sockets = await io.in(roomId).fetchSockets();
    for (const s of sockets) {
      // Isolate each delivery: a throw from one socket must not starve the rest
      // of the room, and applied state is never rolled back on a failed emit.
      try {
        s.emit("room:state", makeRoomState(room, s));
      } catch (err) {
        console.error(`[broadcastRoom] emit failed for ${s.id}:`, err);
      }
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

// Socket event handler functions
function handleRoomCreate(socket, { desiredRoomId, name, emoji, clientId } = {}) {
  if (!checkRateLimit(socket.id)) {
    socket.emit("error", { message: "Rate limit exceeded. Please slow down." });
    return;
  }

  // Use the desired room ID if provided and available, otherwise generate random
  let roomId = normalizeRoomId(desiredRoomId);
  
  // If no room ID provided or it's empty after normalization, generate random
  if (!roomId) {
    roomId = randomId(5);
  }
  
  // If the desired room ID is already taken, generate a random one
  while (rooms.has(roomId)) {
    roomId = randomId(5);
  }

  const room = getOrCreateRoom(roomId);

  socket.emit("room:created", { roomId: room.roomId, modKey: room.moderatorKey });

  socket.data.roomId = room.roomId;
  socket.data.modKey = room.moderatorKey;
  socket.data.clientId = clientId || socket.id;

  socket.join(room.roomId);

  const sanitizedName = sanitizeFreeText(name || "Facilitator", MAX_NAME_LENGTH) || "Facilitator";
  room.users[getUserKey(socket)] = {
    name: sanitizedName,
    emoji: sanitizeEmoji(emoji),
    vote: null,
    isModerator: true,
    socketId: socket.id,
    // Mark the facilitator connected on creation so the record shape matches a
    // joined user immediately (before the auto room:join), keeping disconnect
    // grace handling and the live-collision guard consistent.
    connected: true
  };

  room.lastActiveAt = Date.now();
  broadcastRoom(room.roomId);
}

function handleRoomJoin(socket, { roomId, name, emoji, modKey, clientId } = {}) {
  if (!checkRateLimit(socket.id)) {
    socket.emit("error", { message: "Rate limit exceeded. Please slow down." });
    return;
  }

  roomId = normalizeRoomId(roomId);
  if (!roomId) return;

  const room = getOrCreateRoom(roomId);

  socket.data.roomId = roomId;
  socket.data.modKey = modKey || null;
  socket.data.clientId = clientId || socket.id;

  socket.join(roomId);

  const userKey = getUserKey(socket);
  const existing = room.users[userKey];

  // Defense-in-depth against identity collision / privilege escalation.
  // A genuine resume happens after a lapse, so the existing record is
  // DISCONNECTED (in its grace window). If instead the record is a
  // currently-CONNECTED moderator held by a DIFFERENT live socket, and this
  // join presents no valid modKey, it is not the facilitator resuming — it is a
  // separate session that happens to share the clientId (e.g. a participant who
  // ended up with the same id). Refuse to take over the facilitator's record or
  // inherit the moderator role; require a distinct identity instead. Genuine
  // resumes (record disconnected) and facilitator reconnects (valid modKey) are
  // unaffected, so this preserves the grace-period/resume behavior (Req 10.1).
  if (
    existing &&
    existing.isModerator &&
    existing.connected &&
    existing.socketId !== socket.id &&
    !isModerator(room, modKey)
  ) {
    socket.emit("error", {
      message:
        "This room already has an active facilitator in this browser. Open the participant link in a separate browser or window to join as a participant."
    });
    return;
  }

  if (existing) {
    // Resume path: an incoming clientId matches an existing (possibly
    // disconnected) user record. Cancel any pending grace timer, re-attach the
    // new socket.id, mark connected, and PRESERVE the existing role and vote so
    // a returning user resumes the same session (Requirements 2.3, 2.4, 2.5).
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
    }
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.socketId = socket.id;

    // Role is resolved through isModerator(room, modKey) so a facilitator who
    // returns with their modKey retains moderator status. Never downgrade an
    // already-moderator record on a transient reconnect that omits the modKey.
    existing.isModerator = existing.isModerator || isModerator(room, modKey);

    // Preserve existing name/emoji unless the payload supplies new values.
    const resumedName = sanitizeFreeText(name || "", MAX_NAME_LENGTH);
    if (resumedName) existing.name = resumedName;
    if (emoji !== undefined && emoji !== null && emoji !== "") {
      existing.emoji = sanitizeEmoji(emoji);
    }
  } else {
    // First-time join: behave exactly as before, only carrying the clientId.
    const sanitizedName = sanitizeFreeText(name || "Anonymous", MAX_NAME_LENGTH) || "Anonymous";
    room.users[userKey] = {
      name: sanitizedName,
      emoji: sanitizeEmoji(emoji),
      vote: null,
      isModerator: isModerator(room, modKey),
      socketId: socket.id,
      connected: true
    };
  }

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleVoteSet(socket, { roomId, vote } = {}) {
  if (!checkRateLimit(socket.id)) return;

  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room || room.phase !== "voting") return;
  const userKey = getUserKey(socket);
  if (!room.users[userKey]) return;

  const v = String(vote ?? "").trim();
  if (!v) return;
  if (!room.deck.includes(v)) return;

  room.users[userKey].vote = v;
  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleVoteClear(socket, { roomId } = {}) {
  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room) return;
  if (!requireModerator(room, socket)) return;

  room.phase = "voting";
  for (const uid of Object.keys(room.users)) room.users[uid].vote = null;

  if (room.activeStoryId && room.story.finalPoints !== null) {
    room.story.finalPoints = null;
    const queueEntry = room.storyQueue.find((s) => s.id === room.activeStoryId);
    if (queueEntry) queueEntry.finalPoints = null;
  }

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleVoteReveal(socket, { roomId } = {}) {
  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room) return;
  if (!requireModerator(room, socket)) return;

  room.phase = "revealed";
  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleStoryQueueAdd(socket, { roomId, story } = {}) {
  if (!checkRateLimit(socket.id)) return;

  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room) return;
  if (!requireModerator(room, socket)) return;

  const title = sanitizeFreeText(story?.title, MAX_STORY_TITLE_LENGTH); // Allow all characters
  if (!title) return;

  const number = sanitizeString(story?.number, MAX_STORY_NUMBER_LENGTH, true, true); // Allow dashes and numbers for Jira #

  room.storyQueue.push({
    id: randomId(8),
    number,
    title,
    finalPoints: null
  });

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleStoryQueueEdit(socket, { roomId, storyId, story } = {}) {
  if (!checkRateLimit(socket.id)) return;

  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room) return;
  if (!requireModerator(room, socket)) return;

  const id = String(storyId || "");
  const item = room.storyQueue.find((s) => s.id === id);
  if (!item) return;

  const title = sanitizeFreeText(story?.title, MAX_STORY_TITLE_LENGTH); // Allow all characters
  if (!title) return;

  const number = sanitizeString(story?.number, MAX_STORY_NUMBER_LENGTH, true, true); // Allow dashes and numbers for Jira #

  item.number = number;
  item.title = title;

  // Keep the mirrored active story in sync if this is the active story
  if (room.activeStoryId === id) {
    room.story.number = number;
    room.story.title = title;
  }

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleStoryQueueRemove(socket, { roomId, storyId } = {}) {
  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room) return;
  if (!requireModerator(room, socket)) return;

  const id = String(storyId || "");
  room.storyQueue = room.storyQueue.filter((s) => s.id !== id);
  if (room.activeStoryId === id) {
    room.activeStoryId = null;
    room.phase = "voting";
    room.story = { number: "", title: "Add Story to Queue", finalPoints: null };
    for (const uid of Object.keys(room.users)) room.users[uid].vote = null;
  }

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

function handleStoryQueueSetActive(socket, { roomId, storyId } = {}, ack) {
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
    finalPoints: found.finalPoints || null
  };

  room.phase = "voting";
  for (const uid of Object.keys(room.users)) room.users[uid].vote = null;

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);

  if (typeof ack === "function") ack({ ok: true });
}

// Re-vote a finalized story: clear its stored estimate, make it the active
// story, return the room to "voting", and discard every cast vote. The whole
// transition (and its ordered validation) lives in applyRevote, so this handler
// owns only I/O: room lookup, moderator resolution, one broadcast, one ack. No
// checkRateLimit, matching every sibling story-queue handler.
function handleStoryQueueRevote(socket, { roomId, storyId } = {}, ack) {
  roomId = normalizeRoomId(roomId) || socket.data.roomId;
  // rooms.get, never getOrCreateRoom: an unknown room id must not create a room.
  const room = rooms.get(roomId);

  const result = applyRevote(room, storyId, {
    isFacilitator: !!room && requireModerator(room, socket),
    now: Date.now()
  });

  if (!result.ok) {
    // Rejection is reported to the requesting socket only: no broadcast, and
    // lastActiveAt is left as applyRevote found it.
    if (typeof ack === "function") ack({ ok: false, reason: result.reason });
    return;
  }

  // Exactly one broadcast, after every state change has been applied.
  broadcastRoom(roomId);

  if (typeof ack === "function") ack({ ok: true });
}

function handleStoryQueueFinalize(socket, { roomId, storyId, finalPoints } = {}) {
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
}

// Arm (or re-arm) the disconnect grace timer for a user record. A reconnect
// within the grace window cancels this timer and resumes the session; if it
// elapses without a reconnect, the still-disconnected record is removed. Shared
// by handleDisconnect and loadPersistedRooms so restored records follow the
// exact same cleanup policy.
function armDisconnectGrace(room, roomId, userKey) {
  const user = room.users[userKey];
  if (!user) return;

  // Clear any pre-existing grace timer so we don't leak/duplicate timers.
  if (user.graceTimer) {
    clearTimeout(user.graceTimer);
    user.graceTimer = null;
  }

  const timer = setTimeout(() => {
    const current = room.users[userKey];
    // Only remove if this record is still present and still disconnected
    // (i.e., no reconnect re-attached it in the meantime).
    if (current && current.connected === false) {
      console.info(
        `[armDisconnectGrace] Grace elapsed; removing user room=${roomId} ` +
        `user=${userKey} (last socket=${current.socketId}). This is when the ` +
        `user disappears from the roster.`
      );
      delete room.users[userKey];
      room.lastActiveAt = Date.now();
      broadcastRoom(roomId);
    }
  }, DISCONNECT_GRACE_MS);

  // Avoid keeping the Node process alive in production. In test environments
  // with fake timers the handle may not expose unref, so guard the call.
  if (timer && typeof timer.unref === "function") timer.unref();

  user.graceTimer = timer;
}

function handleDisconnect(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  const userKey = getUserKey(socket);
  const user = room.users[userKey];
  if (!user) return;

  // Ignore stale disconnects from a socket that has already been superseded.
  // User records are keyed by the durable clientId, so on a reconnect the new
  // socket (S2) resumes the record (connected=true, socketId=S2) BEFORE the old
  // socket's (S1) delayed 'disconnect' arrives. Both sockets share the same
  // clientId, so without this guard S1's disconnect would re-mark the LIVE
  // record disconnected and arm a grace timer that deletes an online user ~45s
  // later — the root cause of users flapping in and out. Only the socket
  // currently bound to the record may transition it to disconnected.
  if (user.socketId !== socket.id) {
    console.warn(
      `[handleDisconnect] Ignoring stale disconnect for room=${roomId} user=${userKey}: ` +
      `disconnecting socket=${socket.id} but record is bound to socket=${user.socketId} ` +
      `(a newer connection already took over).`
    );
    return;
  }

  // Do NOT delete the user immediately. A disconnect may just be a transient
  // background-induced heartbeat lapse. Mark the user disconnected and arm a
  // grace timer; a reconnect within the grace window (Task 3.3) will cancel
  // this timer and resume the session. If the timer elapses without a
  // reconnect, the user is removed (covers intentional leaves too).
  console.info(
    `[handleDisconnect] room=${roomId} user=${userKey} socket=${socket.id} ` +
    `marked disconnected; arming ${DISCONNECT_GRACE_MS}ms grace timer.`
  );
  user.connected = false;
  user.disconnectedAt = Date.now();

  armDisconnectGrace(room, roomId, userKey);

  room.lastActiveAt = Date.now();
  broadcastRoom(roomId);
}

// Socket.IO connection handler
io.on("connection", (socket) => {
  // Clean up rate limit on disconnect
  socket.on("disconnect", () => {
    rateLimits.delete(socket.id);
  });
  
  socket.on("room:create", (data) => handleRoomCreate(socket, data));
  socket.on("room:join", (data) => handleRoomJoin(socket, data));
  socket.on("vote:set", (data) => handleVoteSet(socket, data));
  socket.on("vote:clear", (data) => handleVoteClear(socket, data));
  socket.on("vote:reveal", (data) => handleVoteReveal(socket, data));
  socket.on("storyQueue:add", (data) => handleStoryQueueAdd(socket, data));
  socket.on("storyQueue:edit", (data) => handleStoryQueueEdit(socket, data));
  socket.on("storyQueue:remove", (data) => handleStoryQueueRemove(socket, data));
  socket.on("storyQueue:setActive", (data, ack) => handleStoryQueueSetActive(socket, data, ack));
  socket.on("storyQueue:revote", (data, ack) => handleStoryQueueRevote(socket, data, ack));
  socket.on("storyQueue:finalize", (data) => handleStoryQueueFinalize(socket, data));
  socket.on("disconnect", () => handleDisconnect(socket));
});

// Room cleanup with proper interval management
let cleanupIntervalId = null;

function startRoomCleanup() {
  if (cleanupIntervalId) return; // Already running
  
  cleanupIntervalId = setInterval(() => {
    const now = Date.now();
    let removed = false;
    for (const [roomId, room] of rooms.entries()) {
      const empty = Object.keys(room.users).length === 0;
      const idle = now - room.lastActiveAt > ROOM_IDLE_TIMEOUT;
      if (empty && idle) {
        rooms.delete(roomId);
        removed = true;
      }
    }
    // Checkpoint so reaped rooms don't reappear from a stale snapshot on the
    // next restart.
    if (removed) schedulePersist();
  }, CLEANUP_INTERVAL);
}

function stopRoomCleanup() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// Graceful shutdown
function gracefulShutdown() {
  stopRoomCleanup();
  // Flush the latest room state synchronously so an in-flight debounced write
  // is never lost on exit.
  persistRoomsSync();
  server.close(() => {
    process.exit(0);
  });
}

// Only start the HTTP server, cleanup interval, and process signal handlers when
// this module is executed directly (e.g. `node server.js`). When the module is
// imported (e.g. by tests) we expose the internals via exports without binding a
// port or leaving a timer running. This is a testability-only guard and does not
// change any runtime behavior of the server itself.
const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  // Enable persistence for the live server only, then restore any room state
  // saved before the last restart so reconnecting facilitators keep their role.
  persistenceEnabled = true;
  loadPersistedRooms();

  startRoomCleanup();

  process.on('SIGTERM', () => gracefulShutdown());
  process.on('SIGINT', () => gracefulShutdown());

  const PORT = process.env.PORT || 3000;
  server.listen(PORT);
}

// Exported for testing. These are the exact same functions/objects used by the
// live server; exporting them does not alter their behavior.
export {
  io,
  rooms,
  ROOM_IDLE_TIMEOUT,
  CLEANUP_INTERVAL,
  DISCONNECT_GRACE_MS,
  getOrCreateRoom,
  isModerator,
  getUserKey,
  makeRoomState,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleVoteClear,
  handleVoteReveal,
  handleStoryQueueRemove,
  handleStoryQueueSetActive,
  handleStoryQueueRevote,
  handleStoryQueueFinalize,
  handleDisconnect,
  startRoomCleanup,
  stopRoomCleanup
};
