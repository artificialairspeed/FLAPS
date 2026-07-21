/**
 * Property-Based Tests — Fix Checking (Property 1) + Preservation Checking (Property 2)
 * Spec: session-persistence-on-tab-inactive  (Task 5)
 *
 * This is a dedicated PBT file that verifies the fixed server across many
 * randomly-generated inputs:
 *
 *   Property 1 (Fix Checking):
 *     FOR ALL input WHERE isBugCondition(input):
 *       a disconnect followed by a reconnect within the grace window (under a
 *       NEW socket.id but the SAME stable clientId) ALWAYS restores the session
 *       with the correct role and vote, with no duplicate/ghost participants.
 *       (sessionRestored = true, roleRestored = priorRole,
 *        requiredManualRejoin = false, canContinueInSameSession = true)
 *
 *   Property 2 (Preservation Checking):
 *     FOR ALL input WHERE NOT isBugCondition(input):
 *       originalSystem(input) = fixedSystem(input) — foreground actions,
 *       first-time joins, intentional leaves, in-session actions, and idle
 *       timings all behave exactly as the documented baseline.
 *
 *   Role assignment:
 *     Random moderator/participant configurations preserve role assignment on
 *     both first join and resume.
 *
 * Bug condition (from bugfix.md / design.md):
 *   isBugCondition(x) =
 *     x.userHasActiveSession AND x.wentInactive AND x.connectionLapsed
 *     AND x.userReturns AND NOT x.userIntentionallyLeft
 *
 * Observable output: the payload each connected socket receives is built by
 * `makeRoomState(room, socket)` (the exact function used inside broadcastRoom),
 * combined with `room.users` membership. We treat these as the faithful,
 * deterministic observable for equivalence/restoration checking.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  rooms,
  getOrCreateRoom,
  makeRoomState,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleVoteClear,
  handleVoteReveal,
  handleStoryQueueSetActive,
  handleDisconnect,
  startRoomCleanup,
  stopRoomCleanup,
  DISCONNECT_GRACE_MS,
  ROOM_IDLE_TIMEOUT,
  CLEANUP_INTERVAL,
} from './server.js';

const NUM_RUNS = 100;

/** Deck values usable for vote:set (excludes '?' and '☕' which are not numeric). */
const DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144'];

/** Encodes the bug condition exactly as specified in bugfix.md / design.md. */
function isBugCondition(x) {
  return (
    x.userHasActiveSession &&
    x.wentInactive &&
    x.connectionLapsed &&
    x.userReturns &&
    !x.userIntentionallyLeft
  );
}

/**
 * Minimal fake Socket.IO socket good enough to drive the server handlers.
 * Matches the harness used by the exploration/preservation tests.
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

/** The user record for a socket regardless of clientId- vs socketId-keying. */
function findUser(room, socket) {
  const clientId = socket.data.clientId;
  if (clientId && room.users[clientId]) return room.users[clientId];
  return room.users[socket.id];
}

/**
 * The room:state users-map key for a given socket, robust to whether the server
 * keys room.users by socket.id or clientId.
 */
function stateKeyForSocket(state, socket) {
  const clientId = socket.data.clientId;
  if (clientId && state.users[clientId]) return clientId;
  return socket.id;
}

beforeEach(() => {
  rooms.clear();
});

afterEach(() => {
  stopRoomCleanup();
});

// ---------------------------------------------------------------------------
// Property 1 — Fix Checking
// ---------------------------------------------------------------------------
describe('Property 1 (PBT): Fix Checking — session always restored for buggy inputs', () => {
  // FOR ALL input WHERE isBugCondition(input): after a background lapse and a
  // reconnect within the grace window (new socket.id, same clientId), the
  // session is restored with role + vote intact and exactly one user record.
  //
  // Validates: Requirements 2.1, 2.3, 2.4, 2.5
  it('FOR ALL isBugCondition(input): role + vote restored, no ghost, single record', () => {
    fc.assert(
      fc.property(
        fc.record({
          isFacilitator: fc.boolean(),
          vote: fc.constantFrom(...DECK),
          clientId: fc.uuid(),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
          firstSocketId: fc.uuid(),
          secondSocketId: fc.uuid(),
        }),
        ({ isFacilitator, vote, clientId, roomSuffix, firstSocketId, secondSocketId }) => {
          rooms.clear();
          const roomId = 'FIX' + roomSuffix;

          const input = {
            userHasActiveSession: true,
            wentInactive: true,
            connectionLapsed: true,
            userReturns: true,
            userIntentionallyLeft: false,
            priorRole: isFacilitator ? 'facilitator' : 'participant',
          };
          // Only exercise the property for buggy inputs.
          fc.pre(isBugCondition(input));

          // Establish an active session and cast a vote.
          const first = makeSocket('a-' + firstSocketId, { clientId });
          let modKey = null;
          if (isFacilitator) {
            handleRoomCreate(first, { desiredRoomId: roomId, name: 'F', clientId });
            modKey = rooms.get(roomId).moderatorKey;
            first.data.modKey = modKey;
          } else {
            handleRoomJoin(first, { roomId, name: 'P', clientId });
          }
          handleVoteSet(first, { roomId, vote });

          // Background lapse -> disconnect (session held, not deleted).
          handleDisconnect(first);

          // Return within grace under a NEW socket.id with the SAME identity.
          const second = makeSocket('b-' + secondSocketId, { clientId, modKey });
          handleRoomJoin(second, {
            roomId,
            name: isFacilitator ? 'F' : 'P',
            modKey,
            clientId,
          });

          const room = rooms.get(roomId);
          const resumed = findUser(room, second);

          // sessionRestored / canContinueInSameSession
          expect(resumed).toBeDefined();
          // roleRestored = priorRole
          expect(!!resumed.isModerator).toBe(isFacilitator);
          // state (vote) preserved
          expect(resumed.vote).toBe(vote);
          // reconnect re-attached to the live socket.id (no manual re-join needed)
          expect(resumed.socketId).toBe(second.id);
          expect(resumed.connected).toBe(true);
          // no duplicate/ghost participant — keyed by stable clientId
          expect(Object.keys(room.users).length).toBe(1);
          expect(room.users[clientId]).toBeDefined();

          // youAreModerator in the restored state matches the prior role.
          const state = makeRoomState(room, second);
          expect(state.youAreModerator).toBe(isFacilitator);
          expect(state.myId).toBe(clientId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // A reconnect ANYWHERE within the grace window (before the timer fires) must
  // restore the session. Uses fake timers to advance an arbitrary amount that
  // stays strictly under DISCONNECT_GRACE_MS.
  //
  // Validates: Requirements 2.1, 2.3, 2.5
  it('FOR ALL delays < grace window: reconnect within the window restores the session', () => {
    fc.assert(
      fc.property(
        fc.record({
          clientId: fc.uuid(),
          vote: fc.constantFrom(...DECK),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
          delay: fc.integer({ min: 0, max: DISCONNECT_GRACE_MS - 1 }),
        }),
        ({ clientId, vote, roomSuffix, delay }) => {
          vi.useFakeTimers();
          try {
            rooms.clear();
            const roomId = 'GRACE' + roomSuffix;

            const first = makeSocket('a-' + clientId, { clientId });
            handleRoomJoin(first, { roomId, name: 'P', clientId });
            handleVoteSet(first, { roomId, vote });

            handleDisconnect(first);

            // Wait some time strictly less than the grace window, then return.
            vi.advanceTimersByTime(delay);

            const second = makeSocket('b-' + clientId, { clientId });
            handleRoomJoin(second, { roomId, name: 'P', clientId });

            const room = rooms.get(roomId);
            const resumed = findUser(room, second);
            expect(resumed).toBeDefined();
            expect(resumed.vote).toBe(vote);
            expect(resumed.connected).toBe(true);
            expect(Object.keys(room.users).length).toBe(1);

            // Advancing past the (cancelled) grace window must NOT remove the
            // resumed, connected user.
            vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 1000);
            expect(findUser(room, second)).toBeDefined();
            expect(Object.keys(room.users).length).toBe(1);
          } finally {
            vi.useRealTimers();
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — Preservation Checking
// ---------------------------------------------------------------------------
describe('Property 2 (PBT): Preservation Checking — non-buggy behavior unchanged', () => {
  // Generates non-buggy SessionEvents by construction, additionally guarded
  // with fc.pre(!isBugCondition(...)).
  const nonBuggyEvent = fc
    .record({
      userHasActiveSession: fc.boolean(),
      wentInactive: fc.boolean(),
      connectionLapsed: fc.boolean(),
      userReturns: fc.boolean(),
      userIntentionallyLeft: fc.boolean(),
    })
    .filter((x) => !isBugCondition(x));

  // 3.1 Foreground real-time updates: connected users receive room:state
  // reflecting every action.
  //
  // Validates: Requirements 3.1, 3.4
  it('3.1/3.4 foreground actions broadcast consistent state to every connected socket', () => {
    fc.assert(
      fc.property(
        nonBuggyEvent,
        fc.array(fc.record({ clientId: fc.uuid(), vote: fc.constantFrom(...DECK) }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 100000 }),
        (event, members, suffix) => {
          fc.pre(!isBugCondition(event));
          rooms.clear();
          const roomId = 'PRES' + suffix;

          const mod = makeSocket('m-' + suffix, { clientId: 'mod-' + suffix });
          handleRoomCreate(mod, { desiredRoomId: roomId, name: 'Mod', clientId: 'mod-' + suffix });
          const room = rooms.get(roomId);
          mod.data.modKey = room.moderatorKey;

          const voters = [];
          const connected = [mod];
          const seen = new Set(['mod-' + suffix]);
          for (const m of members) {
            if (seen.has(m.clientId)) continue;
            seen.add(m.clientId);
            const s = makeSocket('s-' + m.clientId, { clientId: m.clientId });
            handleRoomJoin(s, { roomId, name: 'U', clientId: m.clientId });
            handleVoteSet(s, { roomId, vote: m.vote });
            voters.push({ socket: s, vote: m.vote });
            connected.push(s);
          }

          // Every connected socket sees the same membership count.
          const memberCount = Object.keys(room.users).length;
          for (const s of connected) {
            expect(Object.keys(makeRoomState(room, s).users).length).toBe(memberCount);
          }

          // While voting, votes are masked as "selected" for every viewer.
          for (const viewer of connected) {
            const state = makeRoomState(room, viewer);
            for (const { socket } of voters) {
              const key = stateKeyForSocket(state, socket);
              expect(state.users[key].vote).toBe('selected');
            }
          }

          // After reveal, actual values are broadcast to every connected socket.
          handleVoteReveal(mod, { roomId });
          for (const viewer of connected) {
            const state = makeRoomState(room, viewer);
            expect(state.phase).toBe('revealed');
            for (const { socket, vote } of voters) {
              const key = stateKeyForSocket(state, socket);
              expect(state.users[key].vote).toBe(vote);
            }
          }

          // Foreground activity never removes anyone.
          expect(Object.keys(room.users).length).toBe(memberCount);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // 3.2 Intentional leave removal: a disconnect with no reconnect ultimately
  // removes the user once the grace window elapses.
  //
  // Validates: Requirement 3.2
  it('3.2 intentional leave: disconnect with no reconnect ultimately removes the user', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 0, max: 100000 }),
        fc.constantFrom(...DECK),
        (clientId, suffix, vote) => {
          vi.useFakeTimers();
          try {
            rooms.clear();
            const roomId = 'PRES' + suffix;
            const s = makeSocket('s-' + clientId, { clientId });
            handleRoomJoin(s, { roomId, name: 'U', clientId });
            handleVoteSet(s, { roomId, vote });
            const room = rooms.get(roomId);
            expect(findUser(room, s)).toBeDefined();

            // Intentional leave: disconnect, then let the grace window elapse
            // WITHOUT a reconnect.
            handleDisconnect(s);

            // Still present during the grace window (session held).
            expect(findUser(room, s)).toBeDefined();

            // After the grace window with no reconnect, the user is removed.
            vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 1000);
            expect(findUser(room, s)).toBeUndefined();
          } finally {
            vi.useRealTimers();
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // 3.3 First-time create/join role assignment via isModerator(room, modKey).
  //
  // Validates: Requirement 3.3
  it('3.3 first-time joins: role == isModerator(room, modKey) for every member; no ghosts', () => {
    fc.assert(
      fc.property(
        nonBuggyEvent,
        fc.array(fc.record({ clientId: fc.uuid(), useModKey: fc.boolean() }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 100000 }),
        (event, members, suffix) => {
          fc.pre(!isBugCondition(event));
          rooms.clear();
          const roomId = 'PRES' + suffix;

          const mod = makeSocket('m-' + suffix, { clientId: 'mod-' + suffix });
          handleRoomCreate(mod, { desiredRoomId: roomId, name: 'Mod', clientId: 'mod-' + suffix });
          const room = rooms.get(roomId);
          const modKey = room.moderatorKey;

          // Creator is always the facilitator.
          expect(findUser(room, mod).isModerator).toBe(true);

          const seen = new Set(['mod-' + suffix]);
          let expectedCount = 1;
          for (const m of members) {
            if (seen.has(m.clientId)) continue;
            seen.add(m.clientId);
            expectedCount++;
            const key = m.useModKey ? modKey : null;
            const s = makeSocket('s-' + m.clientId, { clientId: m.clientId, modKey: key });
            handleRoomJoin(s, { roomId, name: 'U', modKey: key, clientId: m.clientId });

            // Role is exactly isModerator(room, modKey).
            expect(!!findUser(room, s).isModerator).toBe(!!key && key === modKey);
            // State reflects the same role.
            expect(makeRoomState(room, s).youAreModerator).toBe(!!key && key === modKey);
          }

          // One record per distinct member (no ghosts).
          expect(Object.keys(room.users).length).toBe(expectedCount);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // 3.3 (resume) Role assignment is preserved across a resume for BOTH
  // facilitator and participant configurations — first join role == resume role.
  //
  // Validates: Requirements 3.3, 2.4
  it('3.3 role assignment is preserved on both first join and resume (mod + participant)', () => {
    fc.assert(
      fc.property(
        fc.record({
          isFacilitator: fc.boolean(),
          clientId: fc.uuid(),
          suffix: fc.integer({ min: 0, max: 100000 }),
        }),
        ({ isFacilitator, clientId, suffix }) => {
          rooms.clear();
          const roomId = 'ROLE' + suffix;

          const first = makeSocket('a-' + clientId, { clientId });
          let modKey = null;
          if (isFacilitator) {
            handleRoomCreate(first, { desiredRoomId: roomId, name: 'X', clientId });
            modKey = rooms.get(roomId).moderatorKey;
            first.data.modKey = modKey;
          } else {
            handleRoomJoin(first, { roomId, name: 'X', clientId });
          }

          const room = rooms.get(roomId);
          const firstRole = !!findUser(room, first).isModerator;
          expect(firstRole).toBe(isFacilitator);

          // Disconnect + resume; role must be identical to the first-join role.
          handleDisconnect(first);
          const second = makeSocket('b-' + clientId, { clientId, modKey });
          handleRoomJoin(second, { roomId, name: 'X', modKey, clientId });

          const resumedRole = !!findUser(room, second).isModerator;
          expect(resumedRole).toBe(firstRole);
          expect(makeRoomState(room, second).youAreModerator).toBe(firstRole);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // 3.4 In-session actions: vote -> reveal -> clear cycle broadcasts correct
  // state (revealed shows actual votes; clear resets to voting with null votes).
  //
  // Validates: Requirement 3.4
  it('3.4 vote/reveal/clear cycle broadcasts correct state for random votes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ clientId: fc.uuid(), vote: fc.constantFrom(...DECK) }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 100000 }),
        (members, suffix) => {
          rooms.clear();
          const roomId = 'PRES' + suffix;

          const mod = makeSocket('m-' + suffix, { clientId: 'mod-' + suffix });
          handleRoomCreate(mod, { desiredRoomId: roomId, name: 'Mod', clientId: 'mod-' + suffix });
          const room = rooms.get(roomId);
          mod.data.modKey = room.moderatorKey;

          const voters = [];
          const seen = new Set(['mod-' + suffix]);
          for (const m of members) {
            if (seen.has(m.clientId)) continue;
            seen.add(m.clientId);
            const s = makeSocket('s-' + m.clientId, { clientId: m.clientId });
            handleRoomJoin(s, { roomId, name: 'U', clientId: m.clientId });
            handleVoteSet(s, { roomId, vote: m.vote });
            voters.push({ socket: s, vote: m.vote });
          }

          // Reveal: actual votes visible.
          handleVoteReveal(mod, { roomId });
          let state = makeRoomState(room, mod);
          expect(state.phase).toBe('revealed');
          for (const { socket, vote } of voters) {
            expect(state.users[stateKeyForSocket(state, socket)].vote).toBe(vote);
          }

          // Clear: back to voting, all votes null.
          handleVoteClear(mod, { roomId });
          state = makeRoomState(room, mod);
          expect(state.phase).toBe('voting');
          for (const { socket } of voters) {
            expect(state.users[stateKeyForSocket(state, socket)].vote).toBe(null);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // 3.4 Story activation: setActive activates a queued story, mirrors it into
  // room.story, resets voting, and clears prior votes.
  //
  // Validates: Requirement 3.4
  it('3.4 storyQueue:setActive activates + mirrors the story and resets voting', () => {
    fc.assert(
      fc.property(
        fc.record({
          suffix: fc.integer({ min: 0, max: 100000 }),
          storyId: fc.uuid(),
          title: fc.string({ minLength: 1, maxLength: 20 }).filter((t) => t.trim().length > 0),
          vote: fc.constantFrom(...DECK),
        }),
        ({ suffix, storyId, title, vote }) => {
          rooms.clear();
          const roomId = 'PRES' + suffix;

          const mod = makeSocket('m-' + suffix, { clientId: 'mod-' + suffix });
          handleRoomCreate(mod, { desiredRoomId: roomId, name: 'Mod', clientId: 'mod-' + suffix });
          const room = rooms.get(roomId);
          mod.data.modKey = room.moderatorKey;

          const p = makeSocket('p-' + suffix, { clientId: 'p-' + suffix });
          handleRoomJoin(p, { roomId, name: 'P', clientId: 'p-' + suffix });
          handleVoteSet(p, { roomId, vote });

          room.storyQueue.push({ id: storyId, number: 'N-1', title, finalPoints: null });

          handleStoryQueueSetActive(mod, { roomId, storyId });

          const state = makeRoomState(room, mod);
          expect(state.activeStoryId).toBe(storyId);
          expect(state.story.title).toBe(title);
          expect(state.phase).toBe('voting');
          // Activating a story clears prior votes.
          expect(state.users[stateKeyForSocket(state, p)].vote).toBe(null);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // 3.5 Idle-room cleanup: an empty room idle beyond ROOM_IDLE_TIMEOUT is
  // cleaned up; a non-empty or recently-active room is not.
  //
  // Validates: Requirement 3.5
  it('3.5 idle cleanup: empty+idle rooms are removed; non-empty or fresh rooms are kept', () => {
    fc.assert(
      fc.property(
        fc.record({
          suffix: fc.integer({ min: 0, max: 100000 }),
          isEmpty: fc.boolean(),
          idleMs: fc.integer({ min: 0, max: ROOM_IDLE_TIMEOUT * 2 }),
        }),
        ({ suffix, isEmpty, idleMs }) => {
          vi.useFakeTimers();
          try {
            rooms.clear();
            const roomId = 'IDLE' + suffix;
            const room = getOrCreateRoom(roomId);
            room.users = isEmpty
              ? {}
              : { 'c-x': { name: 'X', emoji: '', vote: null, isModerator: false } };
            room.lastActiveAt = Date.now() - idleMs;

            startRoomCleanup();
            vi.advanceTimersByTime(CLEANUP_INTERVAL + 1000);

            // Under fake timers, advancing the clock also advances Date.now(),
            // so the effective idle age evaluated inside the cleanup callback
            // (which fires at t = CLEANUP_INTERVAL) is idleMs + CLEANUP_INTERVAL.
            const effectiveIdle = idleMs + CLEANUP_INTERVAL;
            const shouldBeRemoved = isEmpty && effectiveIdle > ROOM_IDLE_TIMEOUT;
            expect(rooms.has(roomId)).toBe(!shouldBeRemoved);
          } finally {
            stopRoomCleanup();
            vi.useRealTimers();
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
