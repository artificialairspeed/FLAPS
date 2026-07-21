// @vitest-environment jsdom
/**
 * Integration Tests — Session Persistence on Tab Inactive
 * Spec: session-persistence-on-tab-inactive (Task 6)
 *
 * These tests exercise the full session-persistence flows end-to-end rather
 * than individual functions. They drive the exported server handlers with a
 * fake-socket harness (the established pattern in server.exploration.test.js)
 * to simulate join -> vote -> background disconnect -> (cross the grace
 * boundary with fake timers) -> return, and they drive the real client code
 * (public/app.js) under jsdom to assert the connection pill / toast visual
 * feedback across a transient lapse.
 *
 * Covered scenarios (from design.md -> Testing Strategy -> Integration Tests):
 *  1. Participant: joins, votes, backgrounds past the heartbeat, returns within
 *     grace, resumes with vote + role intact and no error toasts.
 *  2. Facilitator: backgrounds and returns, retaining moderator controls and
 *     active-story state.
 *  3. Context/timing: user backgrounds past the grace window without returning
 *     and is removed; a later reconnect is treated as a fresh join.
 *  4. Visual feedback: the connection pill reflects Disconnected -> Reconnected
 *     without spamming toasts, and the main UI stays intact across the lapse.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.2
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
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
  handleStoryQueueSetActive,
  handleDisconnect,
  DISCONNECT_GRACE_MS,
} from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal fake Socket.IO server socket, matching the harness used across the
 * server test suite. Enough to drive the exported handlers: it records the
 * rooms it joined and any events emitted directly to it.
 */
function makeSocket(id, data = {}) {
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

// ---------------------------------------------------------------------------
// Server-driven end-to-end flows (fake timers to cross the grace boundary)
// ---------------------------------------------------------------------------

describe('Integration (server): full disconnect/reconnect session flows', () => {
  beforeEach(() => {
    rooms.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    rooms.clear();
  });

  it('participant joins, votes, backgrounds past the heartbeat, returns within grace, and resumes with vote + role intact and no error toasts (2.1, 2.3, 2.4, 2.5, 2.2)', () => {
    const ROOM = 'INTEG1';
    const clientId = 'participant-client-1';

    // 1) Participant joins and casts a vote (active session).
    const sockA = makeSocket('sockA-1', { clientId });
    handleRoomJoin(sockA, { roomId: ROOM, name: 'Ada', clientId });
    handleVoteSet(sockA, { roomId: ROOM, vote: '5' });

    const room = rooms.get(ROOM);
    expect(room).toBeDefined();
    expect(room.users[clientId]).toBeDefined();
    expect(room.users[clientId].vote).toBe('5');
    expect(room.users[clientId].isModerator).toBe(false);

    // 2) Backgrounds the tab past the heartbeat -> disconnect fires.
    handleDisconnect(sockA);

    // Session is preserved through the lapse (not deleted immediately).
    expect(room.users[clientId]).toBeDefined();
    expect(room.users[clientId].connected).toBe(false);
    expect(room.users[clientId].vote).toBe('5');

    // 3) Time passes but stays WITHIN the grace window, then the user returns.
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 5000); // e.g. 40s < 45s
    const sockB = makeSocket('sockB-1', { clientId });
    handleRoomJoin(sockB, { roomId: ROOM, name: 'Ada', clientId });

    // 4) Resumed: same single user, vote + participant role intact, connected.
    expect(Object.keys(room.users).length).toBe(1);
    const resumed = room.users[clientId];
    expect(resumed).toBeDefined();
    expect(resumed.vote).toBe('5');
    expect(resumed.isModerator).toBe(false);
    expect(resumed.connected).toBe(true);

    // Stable identity is reported back to the returning client.
    const state = makeRoomState(room, sockB);
    expect(state.myId).toBe(clientId);
    expect(state.youAreModerator).toBe(false);

    // No error toasts: the returning socket never received an 'error' event.
    expect(sockB.emitted.some((m) => m.event === 'error')).toBe(false);

    // The grace timer must have been cancelled by the resume: advancing well
    // past the original grace window must NOT delete the resumed user.
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 5000);
    expect(room.users[clientId]).toBeDefined();
    expect(room.users[clientId].vote).toBe('5');
  });

  it('facilitator backgrounds and returns, retaining moderator controls and active-story state (2.3, 2.4, 2.5)', () => {
    const ROOM = 'INTEG2';
    const clientId = 'facilitator-client-1';

    // 1) Facilitator creates the room (becomes moderator).
    const creator = makeSocket('creator-1', { clientId });
    handleRoomCreate(creator, { desiredRoomId: ROOM, name: 'Mod', clientId });

    const room = rooms.get(ROOM);
    expect(room).toBeDefined();
    const modKey = room.moderatorKey;
    expect(room.users[clientId].isModerator).toBe(true);

    // 2) Facilitator sets an active story.
    const storyId = 'story-abc';
    room.storyQueue.push({
      id: storyId,
      number: 'JIRA-1',
      title: 'Login flow',
      finalPoints: null,
    });
    handleStoryQueueSetActive(creator, { roomId: ROOM, storyId });
    expect(room.activeStoryId).toBe(storyId);

    // 3) Backgrounds -> disconnect, then returns within grace.
    handleDisconnect(creator);
    expect(room.users[clientId].connected).toBe(false);

    vi.advanceTimersByTime(30000); // 30s < 45s grace
    const back = makeSocket('creator-2', { clientId, modKey });
    handleRoomJoin(back, { roomId: ROOM, name: 'Mod', modKey, clientId });

    // 4) Moderator controls + active-story state retained.
    expect(Object.keys(room.users).length).toBe(1);
    expect(room.users[clientId].isModerator).toBe(true);
    expect(room.users[clientId].connected).toBe(true);
    expect(room.activeStoryId).toBe(storyId);
    expect(room.story.title).toBe('Login flow');

    const state = makeRoomState(room, back);
    expect(state.youAreModerator).toBe(true);
    expect(state.activeStoryId).toBe(storyId);
    expect(state.myId).toBe(clientId);
    expect(back.emitted.some((m) => m.event === 'error')).toBe(false);
  });

  it('user backgrounds past the grace window without returning and is removed; a later reconnect is treated as a fresh join (3.2)', () => {
    const ROOM = 'INTEG3';
    const clientId = 'lapsed-client-1';

    // 1) Participant joins and votes.
    const sockA = makeSocket('lapse-a', { clientId });
    handleRoomJoin(sockA, { roomId: ROOM, name: 'Grace', clientId });
    handleVoteSet(sockA, { roomId: ROOM, vote: '8' });

    const room = rooms.get(ROOM);
    expect(room.users[clientId].vote).toBe('8');

    // 2) Backgrounds -> disconnect, and never returns within the grace window.
    handleDisconnect(sockA);
    expect(room.users[clientId]).toBeDefined();

    // 3) Cross the full grace boundary: the grace timer fires and removes them.
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 15000); // 60s > 45s
    expect(room.users[clientId]).toBeUndefined();
    expect(Object.keys(room.users).length).toBe(0);

    // 4) A later reconnect under the same clientId is a fresh join: no prior
    //    vote, connected, and exactly one user.
    const sockB = makeSocket('lapse-b', { clientId });
    handleRoomJoin(sockB, { roomId: ROOM, name: 'Grace', clientId });

    expect(Object.keys(room.users).length).toBe(1);
    const fresh = room.users[clientId];
    expect(fresh).toBeDefined();
    expect(fresh.vote).toBeNull();
    expect(fresh.connected).toBe(true);
    expect(fresh.isModerator).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client-driven visual feedback under jsdom (real client code from app.js)
// ---------------------------------------------------------------------------

const CLIENT_ROOM = 'INTEGUI';

/** A minimal, controllable stand-in for the Socket.IO client socket. */
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
    // test-only: simulate an incoming (server/transport) event
    __trigger(event, ...args) {
      (handlers[event] || []).forEach((cb) => cb(...args));
    },
  };
}

function toastCount() {
  return document.querySelectorAll('.toast').length;
}

describe('Integration (client): connection pill visual feedback across a transient lapse', () => {
  let fakeSocket;

  beforeAll(async () => {
    // Inject the real application DOM so app.js can wire up its handlers.
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    const bodyInner = html
      .replace(/[\s\S]*<body[^>]*>/i, '')
      .replace(/<\/body>[\s\S]*/i, '');
    document.body.innerHTML = bodyInner;

    // Land on a participant room URL (no ?mod=) so the client treats us as a
    // returning participant on connect.
    window.history.replaceState({}, '', `/room/${CLIENT_ROOM}`);

    // Seed a prior joined session so the reconnection path engages on connect.
    sessionStorage.setItem('flaps_room_id', CLIENT_ROOM);
    sessionStorage.setItem(`flaps_joined_${CLIENT_ROOM}`, 'true');
    sessionStorage.setItem('flaps_user_name', 'Ada');

    // Mock the Socket.IO factory to return our controllable fake socket.
    fakeSocket = createFakeClientSocket();
    globalThis.io = () => fakeSocket;
    window.io = globalThis.io;

    // Load the real client code. app.js is now an ES module (it imports the
    // session state machine), so load it via dynamic import AFTER the DOM,
    // URL, storage, and io globals above are in place. Its top-level wiring
    // runs on import, just as the previous eval did.
    await import('./public/app.js');
  });

  beforeEach(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
  });

  it('pill reflects Disconnected -> Reconnected without spamming toasts, and the main UI stays intact (2.2)', () => {
    const modePill = document.getElementById('modePill');
    const main = document.querySelector('main');
    expect(modePill).toBeTruthy();
    expect(main).toBeTruthy();

    // 1) A backgrounding-induced lapse: a single disconnect followed by several
    //    retry (connect_error) events. The pill should quietly report status
    //    and NO toasts should be spammed.
    fakeSocket.connected = false;
    fakeSocket.__trigger('disconnect', 'transport close');
    expect(modePill.textContent).toBe('Disconnected');
    expect(toastCount()).toBe(0);

    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    expect(toastCount()).toBe(0);

    // 2) Recovery: the transport reconnects. updateReconnectionStatus flips the
    //    pill Disconnected -> Reconnected, and still no toast is surfaced.
    fakeSocket.connected = true;
    fakeSocket.__trigger('connect');
    expect(modePill.textContent).toBe('Reconnected');
    expect(toastCount()).toBe(0);

    // 3) The main UI stays intact across the lapse (not torn down).
    expect(document.querySelector('main')).toBeTruthy();
    expect(document.getElementById('modePill')).toBeTruthy();
  });
});
