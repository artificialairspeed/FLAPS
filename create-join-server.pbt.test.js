/**
 * Property-Based Tests — Create/Join Flow Overhaul (server side)
 * Spec: create-join-flow-overhaul  (Task 7.2)
 *
 * Property 13: The server keys users by clientId with socket.id fallback.
 *
 *   getUserKey(socket) returns:
 *     - the clientId when a non-empty clientId is present on socket.data
 *     - socket.id otherwise (clientId absent / empty / null / undefined)
 *
 * This mirrors the durable-identity keying used throughout the server so that a
 * user record survives reconnects (new socket.id, same clientId) while still
 * working for older clients that never send a clientId.
 *
 * Feature: create-join-flow-overhaul, Property 13
 * Validates: Requirements 9.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  getUserKey,
  makeRoomState,
  isModerator,
  rooms,
  getOrCreateRoom,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleDisconnect,
  DISCONNECT_GRACE_MS
} from './server.js';
import { deriveControls, STATES } from './public/session-machine.js';

const NUM_RUNS = 100;

/** Build a minimal fake socket good enough to drive getUserKey. */
function makeFakeSocket(id, clientId) {
  return { id, data: { clientId } };
}

describe('Property 13 (PBT): server keys users by clientId with socket.id fallback', () => {
  // Feature: create-join-flow-overhaul, Property 13
  // Validates: Requirements 9.1
  it('returns the clientId when a non-empty clientId is present', () => {
    fc.assert(
      fc.property(
        // socket.id: a non-empty string identifier.
        fc.string({ minLength: 1 }),
        // clientId: guaranteed to contain a non-empty character (truthy string).
        fc.string({ minLength: 1 }).filter((s) => s.length > 0),
        (socketId, clientId) => {
          const socket = makeFakeSocket(socketId, clientId);
          expect(getUserKey(socket)).toBe(clientId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: create-join-flow-overhaul, Property 13
  // Validates: Requirements 9.1
  it('falls back to socket.id when clientId is absent/empty/null/undefined', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        // Absent-ish clientId values: empty string, null, undefined.
        fc.constantFrom('', null, undefined),
        (socketId, clientId) => {
          const socket = makeFakeSocket(socketId, clientId);
          expect(getUserKey(socket)).toBe(socketId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: create-join-flow-overhaul, Property 13
  // Validates: Requirements 9.1
  it('resolves correctly across arbitrary presence/absence of clientId', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        // Either a non-empty clientId or an absent-ish value.
        fc.oneof(
          fc.string({ minLength: 1 }).map((s) => ({ clientId: s, present: true })),
          fc.constantFrom('', null, undefined).map((v) => ({ clientId: v, present: false }))
        ),
        (socketId, { clientId, present }) => {
          const socket = makeFakeSocket(socketId, clientId);
          expect(getUserKey(socket)).toBe(present ? clientId : socketId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/**
 * Property 17: Room state exposes stable identity and role, and the client
 * renders by role.
 *
 *   Server side — makeRoomState(room, socket):
 *     - exposes `myId` equal to the requesting user's durable clientId
 *       (socket.data.clientId), falling back to socket.id when absent, i.e.
 *       `myId === getUserKey(socket)`.
 *     - exposes each user's `isModerator` flag in the users map.
 *     - exposes `youAreModerator === isModerator(room, modKey)`.
 *
 *   Client side — deriveControls(state, ctx):
 *     - in the in-session states (JOINED / DISCONNECTED / RESUMING), renders
 *       moderator controls (`moderatorControls === true`) iff the resolved role
 *       is 'facilitator', otherwise participant controls
 *       (`moderatorControls === false`).
 *
 * Feature: create-join-flow-overhaul, Property 17
 * Validates: Requirements 9.6, 10.3
 */

/** A small pool of emoji-ish strings for user records. */
const EMOJIS = ['😀', '🎉', '🚀', '🐙', '🦊', ''];

/** Deck used when constructing in-memory rooms (mirrors server defaults). */
const ROOM_DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];

/** Arbitrary for a single in-memory user record keyed by clientId. */
function userRecordArb() {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 12 }),
    emoji: fc.constantFrom(...EMOJIS),
    // vote may be absent (null) or a deck value; makeRoomState only reads truthiness/phase.
    vote: fc.option(fc.constantFrom(...ROOM_DECK), { nil: null }),
    isModerator: fc.boolean(),
    socketId: fc.string({ minLength: 1, maxLength: 10 }),
    connected: fc.boolean()
  });
}

/**
 * Arbitrary in-memory room with a mix of moderator/participant users keyed by
 * distinct clientIds, plus a stable `moderatorKey`.
 */
function roomArb() {
  return fc
    .record({
      roomId: fc.string({ minLength: 4, maxLength: 8 }),
      moderatorKey: fc.string({ minLength: 6, maxLength: 12 }),
      phase: fc.constantFrom('voting', 'revealed'),
      // 0..5 users keyed by unique clientIds.
      users: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        userRecordArb(),
        { maxKeys: 5 }
      )
    })
    .map((r) => ({
      roomId: r.roomId,
      moderatorKey: r.moderatorKey,
      deck: ROOM_DECK,
      phase: r.phase,
      story: null,
      storyQueue: [],
      activeStoryId: null,
      users: r.users
    }));
}

/**
 * Arbitrary fake socket for the requesting user. clientId may be present or
 * absent; modKey may be the room's real moderatorKey, a wrong key, or absent.
 */
function requestingSocketArb(room) {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }),
    // clientId absent (null/undefined/'') or a non-empty durable id.
    clientId: fc.oneof(
      fc.constantFrom(null, undefined, ''),
      fc.string({ minLength: 1, maxLength: 10 })
    ),
    // modKey: the correct room key, a wrong key, or absent.
    modKey: fc.oneof(
      fc.constant(room.moderatorKey),
      fc.constantFrom(null, undefined, ''),
      fc.string({ minLength: 1, maxLength: 12 })
    )
  }).map((s) => ({ id: s.id, data: { clientId: s.clientId, modKey: s.modKey } }));
}

describe('Property 17 (PBT): room state exposes identity/role and client renders by role', () => {
  // Feature: create-join-flow-overhaul, Property 17
  // Validates: Requirements 9.6
  it('makeRoomState exposes myId equal to the requesting user clientId (getUserKey)', () => {
    fc.assert(
      fc.property(
        roomArb().chain((room) => requestingSocketArb(room).map((socket) => ({ room, socket }))),
        ({ room, socket }) => {
          const state = makeRoomState(room, socket);
          const expected = socket.data.clientId || socket.id;
          expect(state.myId).toBe(expected);
          expect(state.myId).toBe(getUserKey(socket));
          expect(typeof state.myId).toBe('string');
          expect(state.myId.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: create-join-flow-overhaul, Property 17
  // Validates: Requirements 9.6, 10.3
  it('makeRoomState exposes per-user isModerator and youAreModerator === isModerator(room, modKey)', () => {
    fc.assert(
      fc.property(
        roomArb().chain((room) => requestingSocketArb(room).map((socket) => ({ room, socket }))),
        ({ room, socket }) => {
          const state = makeRoomState(room, socket);

          // youAreModerator reflects the pure server predicate over (room, modKey).
          expect(state.youAreModerator).toBe(isModerator(room, socket.data.modKey));

          // Every user's role is exposed in the users map.
          for (const [id, record] of Object.entries(room.users)) {
            expect(state.users).toHaveProperty(id);
            expect(state.users[id].isModerator).toBe(record.isModerator || false);
          }
          // The users map does not invent members that were not in the room.
          expect(Object.keys(state.users).sort()).toEqual(Object.keys(room.users).sort());
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: create-join-flow-overhaul, Property 17
  // Validates: Requirements 10.3
  it('client renders moderator controls iff the resolved role is facilitator (in-session states)', () => {
    const IN_SESSION = [STATES.JOINED, STATES.DISCONNECTED, STATES.RESUMING];
    fc.assert(
      fc.property(
        fc.constantFrom(...IN_SESSION),
        fc.constantFrom('facilitator', 'participant'),
        fc.boolean(),
        fc.boolean(),
        (state, role, hasRoomInUrl, hasModKey) => {
          const controls = deriveControls(state, { role, hasRoomInUrl, hasModKey });
          // moderatorControls is true exactly when the role is facilitator.
          expect(controls.moderatorControls).toBe(role === 'facilitator');
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/**
 * Property 14: Resume preserves identity, role, and vote.
 *
 *   For any existing user record, a `room:join` with a matching `clientId`:
 *     - re-attaches the current `socketId` (the new socket.id),
 *     - marks the record connected (connected === true),
 *     - preserves the existing role and vote.
 *   A facilitator retains moderator status even when the reconnect omits the
 *   `modKey`; a participant retains participant status and prior vote while the
 *   voting phase still applies.
 *
 * This drives the real server handlers (handleRoomCreate / handleRoomJoin /
 * handleVoteSet / handleDisconnect) against the in-memory `rooms` map, seeding a
 * user record with a first join, casting an optional vote, simulating a
 * disconnect, then reconnecting under a NEW socket.id with the SAME clientId
 * (omitting modKey for facilitators) — following the server.pbt.test.js harness.
 *
 * Feature: create-join-flow-overhaul, Property 14
 * Validates: Requirements 9.2, 10.1, 10.2
 */

/** Deck values usable for vote:set (excludes '?' and '☕' which are not numeric). */
const RESUME_DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21'];

/**
 * Minimal fake Socket.IO socket good enough to drive the server handlers,
 * matching the harness used by server.pbt.test.js.
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
    emitted
  };
}

describe('Property 14 (PBT): resume preserves identity, role, and vote', () => {
  // Reset the shared rooms map between cases for isolation.
  beforeEach(() => {
    rooms.clear();
  });

  // Feature: create-join-flow-overhaul, Property 14
  // Validates: Requirements 9.2, 10.1, 10.2
  it('matching-clientId resume re-attaches socket, stays connected, keeps role + vote (mod retained without modKey)', () => {
    fc.assert(
      fc.property(
        fc.record({
          isFacilitator: fc.boolean(),
          // vote may be absent (null) or a valid deck value.
          vote: fc.option(fc.constantFrom(...RESUME_DECK), { nil: null }),
          clientId: fc.uuid(),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
          firstSocketId: fc.uuid(),
          secondSocketId: fc.uuid()
        }),
        ({ isFacilitator, vote, clientId, roomSuffix, firstSocketId, secondSocketId }) => {
          rooms.clear();
          const roomId = 'RESUME' + roomSuffix;
          const name = isFacilitator ? 'F' : 'P';

          // --- Seed an existing user record via a first join. ---
          const first = makeSocket('a-' + firstSocketId, { clientId });
          let modKey = null;
          if (isFacilitator) {
            handleRoomCreate(first, { desiredRoomId: roomId, name, clientId });
            modKey = rooms.get(roomId).moderatorKey;
            first.data.modKey = modKey;
          } else {
            handleRoomJoin(first, { roomId, name, clientId });
          }

          // Optionally cast a vote while the phase is 'voting' (the default).
          if (vote !== null) {
            handleVoteSet(first, { roomId, vote });
          }

          const room = rooms.get(roomId);
          const seeded = room.users[clientId];
          expect(seeded).toBeDefined();
          const seededRole = !!seeded.isModerator;
          expect(seededRole).toBe(isFacilitator);
          const seededVote = seeded.vote ?? null;
          // The seeded vote matches what we attempted to set (facilitator can vote too).
          expect(seededVote).toBe(vote);

          // --- Simulate a disconnect (session held, not deleted). ---
          handleDisconnect(first);
          expect(room.users[clientId]).toBeDefined();
          expect(room.users[clientId].connected).toBe(false);

          // --- Reconnect: NEW socket.id, SAME clientId. Facilitators OMIT modKey. ---
          const second = makeSocket('b-' + secondSocketId, { clientId });
          handleRoomJoin(second, {
            roomId,
            name,
            clientId
            // NOTE: modKey intentionally omitted (undefined) for BOTH roles.
          });

          const resumed = room.users[clientId];

          // Identity preserved: exactly one record, keyed by the stable clientId.
          expect(resumed).toBeDefined();
          expect(Object.keys(room.users).length).toBe(1);

          // socketId re-attached to the NEW live socket; marked connected.
          expect(resumed.socketId).toBe(second.id);
          expect(resumed.connected).toBe(true);
          expect(resumed.disconnectedAt).toBeNull();

          // Role preserved: a facilitator retains moderator status even though
          // the reconnect omitted the modKey (never downgraded). A participant
          // stays a participant.
          expect(!!resumed.isModerator).toBe(seededRole);
          if (isFacilitator) {
            expect(resumed.isModerator).toBe(true);
          }

          // Vote preserved while the voting phase still applies.
          expect(room.phase).toBe('voting');
          expect(resumed.vote ?? null).toBe(seededVote);

          // The broadcast room state reflects the preserved identity + role.
          // Note: `youAreModerator` is derived from the socket's modKey, which
          // the resume intentionally omits; the PRESERVED role lives on the user
          // record, exposed per-user in the state's users map.
          const state = makeRoomState(room, second);
          expect(state.myId).toBe(clientId);
          expect(state.users[clientId].isModerator).toBe(seededRole);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/**
 * Property 15: First-time join creates a record with role resolved via isModerator.
 *
 *   For any `room:join` whose clientId matches no existing record, the server
 *   creates a NEW connected user record keyed by clientId whose:
 *     - connected === true,
 *     - socketId === socket.id,
 *     - isModerator === isModerator(room, modKey).
 *
 * This drives the real server handler (handleRoomJoin) against a freshly seeded,
 * empty in-memory room (via getOrCreateRoom, which mints a random moderatorKey).
 * A fresh clientId guarantees the first-join branch; the modKey is either the
 * room's real moderatorKey (→ moderator) or a wrong/absent key (→ participant),
 * so both role branches are exercised. Reuses the makeSocket harness defined
 * above for Property 14.
 *
 * Feature: create-join-flow-overhaul, Property 15
 * Validates: Requirements 9.3
 */
describe('Property 15 (PBT): first-time join creates a record with role via isModerator', () => {
  // Reset the shared rooms map between cases for isolation.
  beforeEach(() => {
    rooms.clear();
  });

  // Feature: create-join-flow-overhaul, Property 15
  // Validates: Requirements 9.3
  it('unmatched clientId creates a connected record whose role equals isModerator(room, modKey)', () => {
    fc.assert(
      fc.property(
        fc.record({
          clientId: fc.uuid(),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
          socketId: fc.uuid(),
          name: fc.string({ minLength: 0, maxLength: 12 }),
          // Which modKey the joiner presents:
          //   'correct' → the room's real moderatorKey (→ moderator)
          //   'wrong'   → an arbitrary (likely non-matching) key (→ participant)
          //   'absent'  → null/undefined/'' (→ participant)
          keyChoice: fc.constantFrom('correct', 'wrong', 'absent'),
          wrongKey: fc.string({ minLength: 1, maxLength: 12 }),
          absentKey: fc.constantFrom(null, undefined, '')
        }),
        ({ clientId, roomSuffix, socketId, name, keyChoice, wrongKey, absentKey }) => {
          rooms.clear();
          const roomId = 'FIRST' + roomSuffix;

          // Seed an empty room with a random moderatorKey (no users yet).
          const room = getOrCreateRoom(roomId);
          expect(Object.keys(room.users).length).toBe(0);

          // Resolve the modKey the joiner will present for this case.
          let modKey;
          if (keyChoice === 'correct') modKey = room.moderatorKey;
          else if (keyChoice === 'wrong') modKey = wrongKey;
          else modKey = absentKey;

          // The pure role predicate is the source of truth for the expected role.
          const expectedRole = isModerator(room, modKey);

          // A fresh clientId that is guaranteed NOT to be an existing record.
          const socket = makeSocket('s-' + socketId, { clientId });
          handleRoomJoin(socket, { roomId, name, clientId, modKey });

          // Exactly one record was created, keyed by the durable clientId.
          const record = room.users[clientId];
          expect(record).toBeDefined();
          expect(Object.keys(room.users).length).toBe(1);

          // The new record is connected and attached to the live socket.
          expect(record.connected).toBe(true);
          expect(record.socketId).toBe(socket.id);

          // Role equals the pure predicate over (room, modKey).
          expect(record.isModerator).toBe(expectedRole);
          if (keyChoice === 'correct') {
            expect(record.isModerator).toBe(true);
          } else {
            expect(record.isModerator).toBe(false);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/**
 * Property 16: Disconnect retains the record for the grace period, then removes it.
 *
 *   For any joined user, a socket disconnect:
 *     - leaves the user record present in room.users,
 *     - marks it disconnected (connected === false) with a grace timer armed;
 *   and while the grace period has NOT yet elapsed the record remains present.
 *   If the Grace_Period (DISCONNECT_GRACE_MS) elapses WITHOUT a reconnect, the
 *   record is removed from room.users and the updated room state is broadcast.
 *
 * This drives the real server handlers (handleRoomCreate / handleRoomJoin /
 * handleDisconnect) against the in-memory `rooms` map using fake timers,
 * mirroring the grace-timer harness in server.pbt.test.js. To observe the
 * broadcast on expiry we spy on the socket's emit; at minimum removal from
 * room.users is asserted (the room object stays live — the grace timer only
 * deletes the user record, idle cleanup is a separate concern).
 *
 * Feature: create-join-flow-overhaul, Property 16
 * Validates: Requirements 9.4, 9.5
 */
describe('Property 16 (PBT): disconnect retains the record for the grace period, then removes it', () => {
  // Ensure no timer state leaks between cases.
  beforeEach(() => {
    rooms.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    rooms.clear();
  });

  // Feature: create-join-flow-overhaul, Property 16
  // Validates: Requirements 9.4, 9.5
  it('retains a disconnected record through the grace window, then removes it + broadcasts on expiry', () => {
    fc.assert(
      fc.property(
        fc.record({
          isFacilitator: fc.boolean(),
          clientId: fc.uuid(),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
          socketId: fc.uuid(),
          // A second joined user so removing the disconnecting user does not
          // empty the room; keeps the assertion focused on record removal.
          otherClientId: fc.uuid(),
          otherSocketId: fc.uuid(),
          // How far (short of the full window) we advance before the final tick.
          preExpiryDelay: fc.integer({ min: 0, max: DISCONNECT_GRACE_MS - 1 })
        }).filter((r) => r.clientId !== r.otherClientId),
        ({ isFacilitator, clientId, roomSuffix, socketId, otherClientId, otherSocketId, preExpiryDelay }) => {
          vi.useFakeTimers();
          rooms.clear();
          const roomId = 'GRACE16-' + roomSuffix;

          // --- Seed a joined user (facilitator via create, else participant). ---
          const socket = makeSocket('s-' + socketId, { clientId });
          if (isFacilitator) {
            handleRoomCreate(socket, { desiredRoomId: roomId, name: 'F', clientId });
            socket.data.modKey = rooms.get(roomId).moderatorKey;
          } else {
            handleRoomJoin(socket, { roomId, name: 'P', clientId });
          }

          // A second, independent joined user so the room is never emptied by
          // the removal of the disconnecting user.
          const other = makeSocket('o-' + otherSocketId, { clientId: otherClientId });
          handleRoomJoin(other, { roomId, name: 'O', clientId: otherClientId });

          const room = rooms.get(roomId);
          expect(room.users[clientId]).toBeDefined();

          // --- Disconnect: record retained, marked disconnected, timer armed. ---
          handleDisconnect(socket);

          const held = room.users[clientId];
          expect(held).toBeDefined();
          expect(held.connected).toBe(false);
          expect(held.disconnectedAt).not.toBeNull();
          expect(held.graceTimer).toBeTruthy();

          // --- Still present strictly before the grace window elapses. ---
          vi.advanceTimersByTime(preExpiryDelay);
          expect(room.users[clientId]).toBeDefined();
          expect(room.users[clientId].connected).toBe(false);

          // Advance right up to (but not past) the full grace window: the timer
          // fires exactly at DISCONNECT_GRACE_MS from the disconnect.
          vi.advanceTimersByTime((DISCONNECT_GRACE_MS - 1) - preExpiryDelay);
          expect(room.users[clientId]).toBeDefined();

          // Snapshot lastActiveAt right before expiry. The grace-timer removal
          // branch updates room.lastActiveAt AND calls broadcastRoom together,
          // so an increase here is the observable proxy that the removal +
          // room-state broadcast ran (broadcastRoom emits via the real io
          // server, which these in-memory fake sockets are not attached to).
          const lastActiveBefore = room.lastActiveAt;

          // --- Cross the grace boundary without a reconnect → record removed. ---
          vi.advanceTimersByTime(2);

          // Record removed from room.users (Req 9.5).
          expect(room.users[clientId]).toBeUndefined();
          // Room state re-broadcast on removal (observed via lastActiveAt bump).
          expect(room.lastActiveAt).toBeGreaterThan(lastActiveBefore);

          // The other (still-connected) user is untouched, and the broadcast
          // room state no longer contains the removed user.
          expect(room.users[otherClientId]).toBeDefined();
          expect(makeRoomState(room, other).users).not.toHaveProperty(clientId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});


/**
 * Defense-in-depth: live moderator-collision guard.
 * Spec: create-join-flow-overhaul (server hardening for the per-tab identity fix)
 *
 * A genuine resume happens after a lapse (the existing record is DISCONNECTED).
 * If instead a `room:join` arrives for a clientId whose record is a
 * currently-CONNECTED moderator held by a DIFFERENT live socket, and the join
 * presents no valid modKey, the server MUST refuse: it must not take over the
 * facilitator's socket/record and must not let the joiner inherit the moderator
 * role. Genuine resumes (record disconnected) and facilitator reconnects (valid
 * modKey) are unaffected — preserving Req 10.1 / grace-period behavior.
 *
 * Feature: create-join-flow-overhaul, Property 18
 * Validates: Requirements 9.1, 10.1 (privilege-escalation hardening)
 */
describe('Property 18 (PBT): live moderator-collision without a valid modKey is rejected', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('rejects a same-clientId live join with no valid modKey and leaves the moderator record intact', () => {
    fc.assert(
      fc.property(
        fc.record({
          clientId: fc.uuid(),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
          facSocketId: fc.uuid(),
          intruderSocketId: fc.uuid()
        }).filter((r) => r.facSocketId !== r.intruderSocketId),
        ({ clientId, roomSuffix, facSocketId, intruderSocketId }) => {
          rooms.clear();
          const roomId = 'COLLIDE' + roomSuffix;

          // Facilitator creates the room and stays connected.
          const fac = makeSocket('fac-' + facSocketId, { clientId });
          handleRoomCreate(fac, { desiredRoomId: roomId, name: 'Mod', clientId });
          const room = rooms.get(roomId);
          fac.data.modKey = room.moderatorKey;
          expect(room.users[clientId].isModerator).toBe(true);
          expect(room.users[clientId].connected).toBe(true);
          expect(room.users[clientId].socketId).toBe(fac.id);

          // A different live socket joins with the SAME clientId but NO modKey.
          const intruder = makeSocket('int-' + intruderSocketId, { clientId });
          handleRoomJoin(intruder, { roomId, name: 'Sneaky', clientId });

          // The join is rejected with an error.
          expect(intruder.emitted.some((m) => m.event === 'error')).toBe(true);

          // The facilitator's record is untouched: still the sole user, still a
          // connected moderator, still bound to the facilitator's socket.
          expect(Object.keys(room.users).length).toBe(1);
          const rec = room.users[clientId];
          expect(rec.isModerator).toBe(true);
          expect(rec.connected).toBe(true);
          expect(rec.socketId).toBe(fac.id);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('allows a live reconnect that presents a valid modKey to take over the record', () => {
    rooms.clear();
    const roomId = 'COLLIDEOK';
    const clientId = 'collide-ok-c1';

    const fac = makeSocket('fac-a', { clientId });
    handleRoomCreate(fac, { desiredRoomId: roomId, name: 'Mod', clientId });
    const room = rooms.get(roomId);
    const modKey = room.moderatorKey;

    const fac2 = makeSocket('fac-b', { clientId });
    handleRoomJoin(fac2, { roomId, name: 'Mod', clientId, modKey });

    expect(fac2.emitted.some((m) => m.event === 'error')).toBe(false);
    expect(Object.keys(room.users).length).toBe(1);
    expect(room.users[clientId].isModerator).toBe(true);
    expect(room.users[clientId].socketId).toBe(fac2.id);
  });

  it('allows a genuine resume of a disconnected moderator without a modKey (Req 10.1 preserved)', () => {
    rooms.clear();
    const roomId = 'COLLIDERESUME';
    const clientId = 'collide-resume-c1';

    const fac = makeSocket('fac-a', { clientId });
    handleRoomCreate(fac, { desiredRoomId: roomId, name: 'Mod', clientId });
    const room = rooms.get(roomId);

    handleDisconnect(fac);
    expect(room.users[clientId].connected).toBe(false);

    const fac2 = makeSocket('fac-b', { clientId });
    handleRoomJoin(fac2, { roomId, name: 'Mod', clientId });

    expect(fac2.emitted.some((m) => m.event === 'error')).toBe(false);
    expect(room.users[clientId].isModerator).toBe(true);
    expect(room.users[clientId].connected).toBe(true);
    expect(room.users[clientId].socketId).toBe(fac2.id);
  });
});
