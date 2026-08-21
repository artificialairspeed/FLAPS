// @vitest-environment jsdom
/**
 * Integration Tests — Create/Join Flow Overhaul (Task 8.1)
 * Spec: create-join-flow-overhaul
 *
 * These tests exercise the end-to-end create/join/session flows rather than
 * individual functions. They combine two harnesses, following the established
 * patterns in this repo:
 *
 *   - The real client wiring (Session_State_Machine + the single render() +
 *     the socket event handlers) is loaded under jsdom by dynamically importing
 *     public/app.js AFTER seeding the DOM, URL, storage, and a controllable fake
 *     io() socket — exactly as public/app.unit.test.js and
 *     public/app.exploration.test.js do. `vi.resetModules()` lets each flow boot
 *     a fresh client (a "page load") with its own URL/storage.
 *   - The real server handlers (server.js) drive the resume role/vote
 *     preservation assertions with a fake-socket harness and fake timers, as in
 *     session-persistence.integration.test.js. Feeding `makeRoomState(...)`
 *     output back into the client's `room:state` handler keeps the client
 *     transitions exercised against realistic server state.
 *
 * Covered flows (design.md -> Testing Strategy -> Integration tests):
 *   1. Facilitator create -> auto-join -> refresh restores JOINED with moderator
 *      controls.
 *   2. Participant join gated on name -> JOINED -> disconnect -> quiet reconnect
 *      -> JOINED with vote/role intact.
 *   3. Load with a stored joined session enters RESUMING (resumes without a
 *      manual join); load without it enters INITIAL with remembered defaults
 *      pre-filled.
 *
 * Validates: Requirements 2.4, 3.4, 7.1, 7.4, 8.5, 10.3
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  rooms,
  makeRoomState,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleDisconnect,
  DISCONNECT_GRACE_MS,
} from '../../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

// The <body> of the real app, injected so app.js can wire up its handlers.
let bodyInner;

beforeAll(() => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf-8');
  bodyInner = html
    .replace(/[\s\S]*<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*/i, '');
});

/** A minimal, controllable stand-in for the Socket.IO *client* socket. */
function createFakeClientSocket() {
  const handlers = {};
  return {
    connected: false,
    sent: [],
    on(event, cb) {
      (handlers[event] ||= []).push(cb);
    },
    off(event) {
      delete handlers[event];
    },
    emit(event, payload) {
      this.sent.push({ event, payload });
    },
    connect() {
      this.connected = true;
    },
    // test-only: simulate an incoming (server/transport) event
    __trigger(event, ...args) {
      (handlers[event] || []).forEach((cb) => cb(...args));
    },
  };
}

/** A minimal fake Socket.IO *server* socket (server-handler harness). */
function makeServerSocket(id, data = {}) {
  const emitted = [];
  return {
    id,
    data: { ...data },
    joinedRooms: new Set(),
    join(roomId) {
      this.joinedRooms.add(roomId);
    },
    leave(roomId) {
      this.joinedRooms.delete(roomId);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    emitted,
  };
}

let fakeSocket;

/**
 * This jsdom build provides `sessionStorage` but not `localStorage`. The client
 * is designed to persist durable identity and remembered defaults in
 * `localStorage`, so install a small in-memory polyfill to exercise that real
 * path end-to-end (app.js reads the bare global `localStorage`).
 */
function installLocalStorage() {
  if (globalThis.localStorage && typeof globalThis.localStorage.clear === 'function') return;
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  try {
    Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  } catch {
    // window may proxy to globalThis; the global definition above is sufficient.
  }
}

/**
 * Boot a fresh client instance: reset the module registry, rebuild the DOM,
 * point the URL and storage at the desired scenario, mock io(), then import the
 * real public/app.js (its top-level wiring runs on import).
 */
async function bootClient({ url, local = {}, session = {} }) {
  vi.resetModules();
  installLocalStorage();

  // Fresh DOM for this "page load".
  document.body.innerHTML = bodyInner;

  // URL (create vs participant vs facilitator deep-link).
  window.history.replaceState({}, '', url);

  // Fresh storage seeded for the scenario.
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  for (const [k, v] of Object.entries(local)) globalThis.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(session)) globalThis.sessionStorage.setItem(k, v);

  // Controllable fake socket in place of the real Socket.IO client.
  fakeSocket = createFakeClientSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  await import('../../public/app.js');
  return fakeSocket;
}

const $ = (id) => document.getElementById(id);
const isHidden = (id) => $(id).classList.contains('hidden');
const toastCount = () => document.querySelectorAll('.toast').length;

/** Type into the Name field and fire the live `input` gate. */
function typeName(value) {
  const nameField = $('name');
  nameField.value = value;
  nameField.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Build a realistic room:state payload from the real server for a socket. */
function serverStateFor(roomId, socket) {
  const room = rooms.get(roomId);
  return makeRoomState(room, socket);
}

// ===========================================================================
// Flow 1 — Facilitator create -> auto-join -> refresh restores JOINED
// ===========================================================================

describe('Flow 1: facilitator create -> auto-join -> refresh restores JOINED with moderator controls (2.4, 10.3)', () => {
  const ROOM = 'FLOW1';
  const MODKEY = 'flow1-modkey';

  afterEach(() => {
    rooms.clear();
  });

  it('create transitions to JOINED as facilitator: Create shows "Room Created", name/join hidden, moderator controls shown', async () => {
    rooms.clear();
    await bootClient({ url: '/' });

    // INITIAL (fresh, no room in URL): Create is the visible pre-join control,
    // but it is gated on a non-empty name — disabled until the facilitator
    // enters a name, then enabled.
    expect(isHidden('createRoomBtn')).toBe(false);
    expect($('createRoomBtn').disabled).toBe(true);
    typeName('Mod');
    expect($('createRoomBtn').disabled).toBe(false);

    // Facilitator activates Create -> CREATING -> emits room:create.
    $('createRoomBtn').click();
    expect(fakeSocket.sent.some((m) => m.event === 'room:create')).toBe(true);

    // Server confirms creation -> ROOM_CREATED -> JOINED as facilitator.
    fakeSocket.__trigger('room:created', { roomId: ROOM, modKey: MODKEY });
    expect($('createRoomBtn').textContent).toBe('Room Created');
    // The facilitator is auto-joined (room:join emitted with the clientId).
    const autoJoin = fakeSocket.sent.filter((m) => m.event === 'room:join');
    expect(autoJoin.length).toBeGreaterThanOrEqual(1);
    expect(typeof autoJoin.at(-1).payload.clientId).toBe('string');

    // Server acknowledges membership with a realistic room:state (moderator).
    const facSock = makeServerSocket('flow1-s1', { clientId: 'flow1-c1', modKey: MODKEY });
    handleRoomCreate(facSock, { desiredRoomId: ROOM, name: 'Mod', clientId: 'flow1-c1' });
    facSock.data.modKey = rooms.get(ROOM).moderatorKey;
    fakeSocket.__trigger('room:state', serverStateFor(ROOM, facSock));

    // JOINED (facilitator): in-session config — name/join hidden, Create shown
    // in its created configuration, and moderator controls exposed (Req 2.4).
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(true);
    expect(isHidden('createRoomBtn')).toBe(false);
    expect($('modePill').textContent).toBe('Facilitator');
    // Moderator controls (reveal/clear) are visible for the facilitator (Req 10.3).
    expect(isHidden('revealBtn')).toBe(false);
    expect(isHidden('clearBtn')).toBe(false);
  });

  it('refresh with a stored joined facilitator session restores JOINED with moderator controls (7.1, 2.4, 10.3)', async () => {
    rooms.clear();
    // A refresh: same facilitator deep-link URL, with the joined session still
    // recorded from the prior load.
    await bootClient({
      url: `/room/${ROOM}?mod=${MODKEY}`,
      session: {
        [`flaps_joined_${ROOM}`]: 'true',
        flaps_room_id: ROOM,
        flaps_user_name: 'Mod',
      },
    });

    // Even before the server round-trip, the restored view is in-session:
    // Create shows "Room Created", name/join hidden (never the pre-join view).
    expect($('createRoomBtn').textContent).toBe('Room Created');
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(true);

    // On connect the facilitator auto-rejoins using the stored clientId.
    fakeSocket.__trigger('connect');
    const rejoin = fakeSocket.sent.filter((m) => m.event === 'room:join');
    expect(rejoin.length).toBeGreaterThanOrEqual(1);
    expect(typeof rejoin.at(-1).payload.clientId).toBe('string');

    // Server confirms the resumed session as moderator -> JOINED with controls.
    const facSock = makeServerSocket('flow1r-s1', { clientId: 'flow1r-c1', modKey: MODKEY });
    handleRoomCreate(facSock, { desiredRoomId: ROOM, name: 'Mod', clientId: 'flow1r-c1' });
    facSock.data.modKey = rooms.get(ROOM).moderatorKey;
    fakeSocket.__trigger('room:state', serverStateFor(ROOM, facSock));

    expect($('modePill').textContent).toBe('Facilitator');
    expect(isHidden('revealBtn')).toBe(false);
    expect(isHidden('clearBtn')).toBe(false);
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(true);
  });
});

// ===========================================================================
// Flow 2 — Participant join gated on name -> JOINED -> disconnect ->
//          quiet reconnect -> JOINED with vote/role intact
// ===========================================================================

describe('Flow 2: participant join gated on name -> JOINED -> disconnect -> quiet reconnect (3.4, 8.5)', () => {
  const ROOM = 'FLOW2';

  afterEach(() => {
    rooms.clear();
  });

  it('Join is gated on a non-empty name, then join/disconnect/quiet-reconnect keep the in-session config', async () => {
    rooms.clear();
    await bootClient({ url: `/room/${ROOM}` });

    // INITIAL participant entry: Name/Join visible, Join disabled until a name.
    expect(isHidden('name')).toBe(false);
    expect(isHidden('joinBtn')).toBe(false);
    expect($('joinBtn').disabled).toBe(true);

    // Whitespace-only name keeps Join disabled (Req 4.1).
    typeName('   ');
    expect($('joinBtn').disabled).toBe(true);

    // A real name enables Join (Req 4.2).
    typeName('Bob');
    expect($('joinBtn').disabled).toBe(false);

    // Join -> JOINING -> emit room:join carrying the clientId.
    $('joinBtn').click();
    const joinEmit = fakeSocket.sent.find((m) => m.event === 'room:join');
    expect(joinEmit).toBeTruthy();
    expect(typeof joinEmit.payload.clientId).toBe('string');

    // Server confirms membership (participant) -> JOINED.
    const partSock = makeServerSocket('flow2-s1', { clientId: 'flow2-c1' });
    handleRoomJoin(partSock, { roomId: ROOM, name: 'Bob', clientId: 'flow2-c1' });
    fakeSocket.__trigger('room:state', serverStateFor(ROOM, partSock));

    // JOINED (participant): name hidden, Create hidden, no moderator controls.
    // Join stays visible, relabelled "Joined" and styled green (disabled).
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(false);
    expect($('joinBtn').textContent).toBe('Joined');
    expect($('joinBtn').classList.contains('roomCreated')).toBe(true);
    expect($('joinBtn').disabled).toBe(true);
    expect(isHidden('createRoomBtn')).toBe(true);
    expect($('modePill').textContent).toBe('Participant');
    expect(isHidden('revealBtn')).toBe(true);

    // --- Disconnect: JOINED -> DISCONNECTED, quiet single pill, no toast. ---
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    fakeSocket.connected = false;
    fakeSocket.__trigger('disconnect', 'transport close');
    expect($('modePill').textContent).toBe('Disconnected');
    expect(toastCount()).toBe(0);
    // In-session config is retained across the lapse — never reverts (Req 8.5).
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(false);
    expect($('joinBtn').textContent).toBe('Joined');

    // --- Quiet reconnect: repeated connect_error surface no toasts. ---
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    expect(toastCount()).toBe(0);

    // Recovery: DISCONNECTED -> RESUMING re-emits a complete room:join payload,
    // and the pill quietly flips Disconnected -> Reconnected (still no toast).
    fakeSocket.sent = [];
    fakeSocket.connected = true;
    fakeSocket.__trigger('connect');
    const reJoin = fakeSocket.sent.find((m) => m.event === 'room:join');
    expect(reJoin).toBeTruthy();
    expect(reJoin.payload).toHaveProperty('clientId');
    expect(reJoin.payload).toHaveProperty('roomId', ROOM);
    expect(reJoin.payload).toHaveProperty('name', 'Bob');
    expect(reJoin.payload).toHaveProperty('emoji');
    expect(reJoin.payload).toHaveProperty('modKey');
    expect($('modePill').textContent).toBe('Reconnected');
    expect(toastCount()).toBe(0);

    // Server confirms the resume -> JOINED: role pill restored to Participant,
    // in-session config still intact, and no error toast surfaced.
    fakeSocket.__trigger('room:state', serverStateFor(ROOM, partSock));
    expect($('modePill').textContent).toBe('Participant');
    expect(toastCount()).toBe(0);
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(false);
    expect($('joinBtn').textContent).toBe('Joined');
  });

  it('server-side: a participant who votes, disconnects, and returns within grace resumes with vote + role intact (10.3)', () => {
    vi.useFakeTimers();
    try {
      rooms.clear();
      const clientId = 'flow2-resume-c1';

      // Join and vote.
      const sockA = makeServerSocket('flow2-resume-a', { clientId });
      handleRoomJoin(sockA, { roomId: ROOM, name: 'Bob', clientId });
      handleVoteSet(sockA, { roomId: ROOM, vote: '5' });

      const room = rooms.get(ROOM);
      expect(room.users[clientId].vote).toBe('5');
      expect(room.users[clientId].isModerator).toBe(false);

      // Background lapse -> disconnect, then return within the grace window.
      handleDisconnect(sockA);
      expect(room.users[clientId].connected).toBe(false);
      vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 5000);

      const sockB = makeServerSocket('flow2-resume-b', { clientId });
      handleRoomJoin(sockB, { roomId: ROOM, name: 'Bob', clientId });

      // Resumed: one user, participant role + prior vote intact, connected.
      expect(Object.keys(room.users).length).toBe(1);
      const resumed = room.users[clientId];
      expect(resumed.vote).toBe('5');
      expect(resumed.isModerator).toBe(false);
      expect(resumed.connected).toBe(true);

      const state = makeRoomState(room, sockB);
      expect(state.myId).toBe(clientId);
      expect(state.youAreModerator).toBe(false);
      expect(sockB.emitted.some((m) => m.event === 'error')).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      rooms.clear();
    }
  });
});

// ===========================================================================
// Flow 3 — Bootstrap: stored joined session enters RESUMING; a fresh load
//          enters INITIAL with remembered defaults pre-filled
// ===========================================================================

describe('Flow 3: bootstrap RESUMING vs INITIAL with remembered defaults (7.1, 7.4)', () => {
  afterEach(() => {
    rooms.clear();
  });

  it('a stored joined session enters RESUMING and resumes without a manual join (7.1)', async () => {
    const ROOM = 'FLOW3';
    await bootClient({
      url: `/room/${ROOM}`,
      session: {
        [`flaps_joined_${ROOM}`]: 'true',
        flaps_room_id: ROOM,
        flaps_user_name: 'Ada',
      },
    });

    // RESUMING keeps the in-session config (name hidden, Join shown as the
    // green "Joined" button) rather than the pre-join participant entry — the
    // observable signature of RESUMING.
    expect(isHidden('name')).toBe(true);
    expect(isHidden('joinBtn')).toBe(false);
    expect($('joinBtn').textContent).toBe('Joined');

    // On connect the client resumes automatically (no manual Join click) by
    // re-emitting room:join with the stored clientId.
    fakeSocket.__trigger('connect');
    const resumeJoin = fakeSocket.sent.filter((m) => m.event === 'room:join');
    expect(resumeJoin.length).toBeGreaterThanOrEqual(1);
    expect(resumeJoin.at(-1).payload.roomId).toBe(ROOM);
    expect(typeof resumeJoin.at(-1).payload.clientId).toBe('string');
    expect(resumeJoin.at(-1).payload.name).toBe('Ada');
  });

  it('a fresh load with no stored session enters INITIAL with remembered name/emoji pre-filled (7.4)', async () => {
    await bootClient({
      url: '/',
      local: { flaps_name: 'Alice', flaps_emoji: '😀' },
    });

    // INITIAL (fresh): Create is the visible pre-join control, no room joined.
    expect(isHidden('createRoomBtn')).toBe(false);
    expect($('createRoomBtn').disabled).toBe(false);
    expect($('createRoomBtn').textContent).toBe('Create Room');

    // Remembered defaults are pre-filled into the Name and emoji controls.
    expect($('name').value).toBe('Alice');
    expect($('emoji').value).toBe('😀');

    // A fresh load performs no automatic resume (no room:join on connect).
    fakeSocket.__trigger('connect');
    expect(fakeSocket.sent.some((m) => m.event === 'room:join')).toBe(false);
  });
});
