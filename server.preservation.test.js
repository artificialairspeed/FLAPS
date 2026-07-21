/**
 * Preservation Property Tests (Property 2) — SERVER
 * Spec: session-persistence-on-tab-inactive
 *
 * These tests encode Property 2 (Preservation — Non-Backgrounding Behavior
 * Unchanged). They follow the observation-first methodology: we observe the
 * behavior of the UNFIXED server for every input where the bug condition does
 * NOT hold, capture the actual outputs as the baseline, and assert them. They
 * are EXPECTED TO PASS on the unfixed code (establishing the baseline) and MUST
 * continue to pass after the fix (originalSystem(input) = fixedSystem(input)).
 *
 * Bug condition (from bugfix.md / design.md):
 *   isBugCondition(x) =
 *     x.userHasActiveSession AND x.wentInactive AND x.connectionLapsed
 *     AND x.userReturns AND NOT x.userIntentionallyLeft
 *
 * Preservation domain (NOT isBugCondition):
 *   - Foreground real-time updates (3.1)
 *   - Intentional leave removal (3.2)
 *   - First-time create/join role assignment (3.3)
 *   - In-session actions + broadcasts (3.4)
 *   - Idle-room cleanup (3.5)
 *
 * Observable output: the payload each connected socket receives is built by
 * `makeRoomState(room, socket)` — the exact function used inside broadcastRoom.
 * We therefore treat `makeRoomState(...)` plus `room.users` membership as the
 * faithful, deterministic observable for equivalence checking.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
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
  ROOM_IDLE_TIMEOUT,
  CLEANUP_INTERVAL,
} from './server.js';

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
 * Matches the harness used by the exploration tests (Task 1).
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

const ROOM = 'PRESERVE1';

beforeEach(() => {
  rooms.clear();
});

afterEach(() => {
  stopRoomCleanup();
});

describe('Preservation sanity: the domain under test is NOT the bug condition', () => {
  it('foreground, intentional-leave, and first-time-join events are all non-buggy', () => {
    // Foreground activity (no inactivity / no lapse)
    expect(
      isBugCondition({
        userHasActiveSession: true,
        wentInactive: false,
        connectionLapsed: false,
        userReturns: false,
        userIntentionallyLeft: false,
      })
    ).toBe(false);

    // Intentional leave (userIntentionallyLeft = true)
    expect(
      isBugCondition({
        userHasActiveSession: true,
        wentInactive: true,
        connectionLapsed: true,
        userReturns: false,
        userIntentionallyLeft: true,
      })
    ).toBe(false);

    // First-time join (no prior active session)
    expect(
      isBugCondition({
        userHasActiveSession: false,
        wentInactive: false,
        connectionLapsed: false,
        userReturns: false,
        userIntentionallyLeft: false,
      })
    ).toBe(false);
  });
});

describe('3.1 Preservation — foreground real-time updates reach connected users', () => {
  it('every action produces a room:state payload reflecting the change for each connected socket', () => {
    const mod = makeSocket('sock-mod', { clientId: 'c-mod' });
    handleRoomCreate(mod, { desiredRoomId: ROOM, name: 'Mod', clientId: 'c-mod' });

    const room = rooms.get(ROOM);
    const modKey = room.moderatorKey;
    mod.data.modKey = modKey;

    const p1 = makeSocket('sock-p1', { clientId: 'c-p1' });
    const p2 = makeSocket('sock-p2', { clientId: 'c-p2' });
    handleRoomJoin(p1, { roomId: ROOM, name: 'P1', clientId: 'c-p1' });
    handleRoomJoin(p2, { roomId: ROOM, name: 'P2', clientId: 'c-p2' });

    // Baseline: all three connected sockets see the same three members.
    for (const s of [mod, p1, p2]) {
      const state = makeRoomState(room, s);
      expect(Object.keys(state.users).length).toBe(3);
      expect(state.phase).toBe('voting');
    }

    // Action: a participant votes. Every connected socket's next payload shows
    // that a vote was cast (masked as "selected" while voting).
    handleVoteSet(p1, { roomId: ROOM, vote: '5' });
    for (const s of [mod, p1, p2]) {
      const state = makeRoomState(room, s);
      const p1Id = findUserVoteVisibleKey(state, 'P1');
      expect(state.users[p1Id].vote).toBe('selected');
    }

    // Action: reveal. Every connected socket now sees the actual vote value.
    handleVoteReveal(mod, { roomId: ROOM });
    for (const s of [mod, p1, p2]) {
      const state = makeRoomState(room, s);
      expect(state.phase).toBe('revealed');
      const p1Id = findUserVoteVisibleKey(state, 'P1');
      expect(state.users[p1Id].vote).toBe('5');
    }

    // Users remain in the room through foreground activity (nobody removed).
    expect(Object.keys(room.users).length).toBe(3);
  });
});

/** Find the users-map key for a member by display name in a room:state payload. */
function findUserVoteVisibleKey(state, name) {
  const entry = Object.entries(state.users).find(([, u]) => u.name === name);
  return entry ? entry[0] : undefined;
}

/**
 * The room:state users-map key for a given socket, robust to whether the server
 * keys room.users by socket.id (unfixed) or clientId (fixed).
 */
function stateKeyForSocket(state, socket) {
  const clientId = socket.data.clientId;
  if (clientId && state.users[clientId]) return clientId;
  return socket.id;
}

describe('3.2 Preservation — intentional leave removes the user', () => {
  it('a user who intentionally leaves is removed from the room (allowing any grace period to elapse)', () => {
    vi.useFakeTimers();
    try {
      const s = makeSocket('sock-leave', { clientId: 'c-leave' });
      handleRoomJoin(s, { roomId: ROOM, name: 'Bye', clientId: 'c-leave' });

      const room = rooms.get(ROOM);
      expect(findUser(room, s)).toBeDefined();

      // Intentional leave (true unload/navigation): disconnect with no return.
      handleDisconnect(s);

      // Allow any (future) grace window to elapse without a reconnect. On the
      // unfixed code removal is immediate; after the fix it happens once the
      // grace timer fires. Either way the user must ultimately be gone.
      vi.advanceTimersByTime(120000);

      expect(findUser(room, s)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('3.3 Preservation — first-time create/join role assignment via isModerator', () => {
  it('room creator is assigned the facilitator (moderator) role', () => {
    const mod = makeSocket('sock-c', { clientId: 'c-c' });
    handleRoomCreate(mod, { desiredRoomId: ROOM, name: 'Creator', clientId: 'c-c' });

    const room = rooms.get(ROOM);
    mod.data.modKey = room.moderatorKey;

    expect(findUser(room, mod).isModerator).toBe(true);
    expect(makeRoomState(room, mod).youAreModerator).toBe(true);
  });

  it('a first-time join with the correct modKey is a moderator; without it is a participant', () => {
    const mod = makeSocket('sock-c', { clientId: 'c-c' });
    handleRoomCreate(mod, { desiredRoomId: ROOM, name: 'Creator', clientId: 'c-c' });
    const room = rooms.get(ROOM);
    const modKey = room.moderatorKey;

    // Correct modKey -> moderator.
    const modJoin = makeSocket('sock-m', { clientId: 'c-m', modKey });
    handleRoomJoin(modJoin, { roomId: ROOM, name: 'Mod2', modKey, clientId: 'c-m' });
    expect(findUser(room, modJoin).isModerator).toBe(true);

    // No modKey -> participant.
    const part = makeSocket('sock-p', { clientId: 'c-p' });
    handleRoomJoin(part, { roomId: ROOM, name: 'Part', clientId: 'c-p' });
    expect(findUser(room, part).isModerator).toBe(false);
    expect(makeRoomState(room, part).youAreModerator).toBe(false);

    // Wrong modKey -> participant.
    const wrong = makeSocket('sock-w', { clientId: 'c-w', modKey: 'not-the-key' });
    handleRoomJoin(wrong, { roomId: ROOM, name: 'Wrong', modKey: 'not-the-key', clientId: 'c-w' });
    expect(findUser(room, wrong).isModerator).toBe(false);
  });
});

describe('3.4 Preservation — in-session actions process and broadcast correct state', () => {
  function setupRoomWithMembers() {
    const mod = makeSocket('sock-mod', { clientId: 'c-mod' });
    handleRoomCreate(mod, { desiredRoomId: ROOM, name: 'Mod', clientId: 'c-mod' });
    const room = rooms.get(ROOM);
    mod.data.modKey = room.moderatorKey;

    const p1 = makeSocket('sock-p1', { clientId: 'c-p1' });
    handleRoomJoin(p1, { roomId: ROOM, name: 'P1', clientId: 'c-p1' });
    return { room, mod, p1 };
  }

  it('vote:set records a vote (masked while voting, revealed after reveal)', () => {
    const { room, mod, p1 } = setupRoomWithMembers();

    handleVoteSet(p1, { roomId: ROOM, vote: '8' });
    let state = makeRoomState(room, mod);
    let key = findUserVoteVisibleKey(state, 'P1');
    expect(state.phase).toBe('voting');
    expect(state.users[key].vote).toBe('selected');

    handleVoteReveal(mod, { roomId: ROOM });
    state = makeRoomState(room, mod);
    key = findUserVoteVisibleKey(state, 'P1');
    expect(state.phase).toBe('revealed');
    expect(state.users[key].vote).toBe('8');
  });

  it('vote:clear resets phase to voting and clears all votes', () => {
    const { room, mod, p1 } = setupRoomWithMembers();
    handleVoteSet(p1, { roomId: ROOM, vote: '3' });
    handleVoteReveal(mod, { roomId: ROOM });

    handleVoteClear(mod, { roomId: ROOM });

    const state = makeRoomState(room, mod);
    expect(state.phase).toBe('voting');
    const key = findUserVoteVisibleKey(state, 'P1');
    expect(state.users[key].vote).toBe(null);
  });

  it('storyQueue:setActive activates a queued story, mirrors it, and resets voting', () => {
    const { room, mod, p1 } = setupRoomWithMembers();

    // Seed a story into the queue (queue add handler is internal-only).
    const storyId = 'story-1';
    room.storyQueue.push({
      id: storyId,
      number: 'JIRA-1',
      title: 'Login flow',
      finalPoints: null,
    });
    handleVoteSet(p1, { roomId: ROOM, vote: '5' });

    handleStoryQueueSetActive(mod, { roomId: ROOM, storyId });

    const state = makeRoomState(room, mod);
    expect(state.activeStoryId).toBe(storyId);
    expect(state.story.title).toBe('Login flow');
    expect(state.phase).toBe('voting');
    // Activating a story clears prior votes.
    const key = findUserVoteVisibleKey(state, 'P1');
    expect(state.users[key].vote).toBe(null);
  });

  it('non-moderators cannot reveal/clear (moderator-gated actions are unchanged)', () => {
    const { room, mod, p1 } = setupRoomWithMembers();
    handleVoteSet(p1, { roomId: ROOM, vote: '2' });

    // p1 is not a moderator; reveal should be ignored.
    handleVoteReveal(p1, { roomId: ROOM });
    expect(makeRoomState(room, mod).phase).toBe('voting');
  });
});

describe('3.5 Preservation — idle-room cleanup timing and semantics', () => {
  it('an empty room idle beyond ROOM_IDLE_TIMEOUT is cleaned up on the cleanup interval', () => {
    vi.useFakeTimers();
    try {
      const room = getOrCreateRoom(ROOM);
      // Empty (no users) and idle (last active well beyond the timeout).
      room.users = {};
      room.lastActiveAt = Date.now() - (ROOM_IDLE_TIMEOUT + 1000);

      startRoomCleanup();
      vi.advanceTimersByTime(CLEANUP_INTERVAL + 1000);

      expect(rooms.has(ROOM)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a non-empty room is NOT cleaned up even when idle', () => {
    vi.useFakeTimers();
    try {
      const room = getOrCreateRoom(ROOM);
      room.users = { 'c-x': { name: 'X', emoji: '', vote: null, isModerator: false } };
      room.lastActiveAt = Date.now() - (ROOM_IDLE_TIMEOUT + 1000);

      startRoomCleanup();
      vi.advanceTimersByTime(CLEANUP_INTERVAL + 1000);

      expect(rooms.has(ROOM)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty but recently-active room is NOT cleaned up before the timeout', () => {
    vi.useFakeTimers();
    try {
      const room = getOrCreateRoom(ROOM);
      room.users = {};
      room.lastActiveAt = Date.now(); // recently active

      startRoomCleanup();
      vi.advanceTimersByTime(CLEANUP_INTERVAL + 1000);

      expect(rooms.has(ROOM)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Property 2 (PBT): baseline behavior is preserved across the non-buggy input domain', () => {
  const deck = ['0.5', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144'];

  // Generates non-buggy SessionEvents by construction. Each record varies the
  // flags such that at least one clause of isBugCondition is false, and we
  // additionally guard with fc.pre(!isBugCondition(...)).
  const nonBuggyEvent = fc
    .record({
      userHasActiveSession: fc.boolean(),
      wentInactive: fc.boolean(),
      connectionLapsed: fc.boolean(),
      userReturns: fc.boolean(),
      userIntentionallyLeft: fc.boolean(),
    })
    .filter((x) => !isBugCondition(x));

  it('first-time joins: role assignment matches isModerator(room, modKey) for every member', () => {
    fc.assert(
      fc.property(
        nonBuggyEvent,
        fc.array(
          fc.record({ clientId: fc.uuid(), useModKey: fc.boolean(), vote: fc.constantFrom(...deck) }),
          { minLength: 1, maxLength: 6 }
        ),
        fc.integer({ min: 0, max: 100000 }),
        (event, members, suffix) => {
          fc.pre(!isBugCondition(event));
          rooms.clear();
          const roomId = 'PBT' + suffix;

          // Facilitator creates the room (first-time create).
          const mod = makeSocket('m-' + suffix, { clientId: 'mod-' + suffix });
          handleRoomCreate(mod, { desiredRoomId: roomId, name: 'Mod', clientId: 'mod-' + suffix });
          const room = rooms.get(roomId);
          const modKey = room.moderatorKey;

          // Distinct participants join for the first time.
          const seen = new Set(['mod-' + suffix]);
          let expectedCount = 1; // the creator
          for (const m of members) {
            if (seen.has(m.clientId)) continue; // keep clientIds distinct
            seen.add(m.clientId);
            expectedCount++;
            const key = m.useModKey ? modKey : null;
            const s = makeSocket('s-' + m.clientId, { clientId: m.clientId, modKey: key });
            handleRoomJoin(s, { roomId, name: 'U', modKey: key, clientId: m.clientId });

            // Preservation 3.3: role is exactly isModerator(room, modKey).
            expect(!!findUser(room, s).isModerator).toBe(!!key && key === modKey);
          }

          // First-time joins create one record per distinct member (no ghosts).
          expect(Object.keys(room.users).length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('in-session votes: revealed state shows each members actual vote (broadcast correctness)', () => {
    fc.assert(
      fc.property(
        nonBuggyEvent,
        fc.array(fc.record({ clientId: fc.uuid(), vote: fc.constantFrom(...deck) }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 100000 }),
        (event, members, suffix) => {
          fc.pre(!isBugCondition(event));
          rooms.clear();
          const roomId = 'PBT' + suffix;

          const mod = makeSocket('m-' + suffix, { clientId: 'mod-' + suffix });
          handleRoomCreate(mod, { desiredRoomId: roomId, name: 'Mod', clientId: 'mod-' + suffix });
          const room = rooms.get(roomId);
          mod.data.modKey = room.moderatorKey;

          // Track each voter by its socket so lookups are key-agnostic and
          // immune to display-name sanitization/truncation.
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

          // While voting, cast votes are masked as "selected" for everyone.
          const votingState = makeRoomState(room, mod);
          for (const { socket } of voters) {
            const key = stateKeyForSocket(votingState, socket);
            expect(votingState.users[key].vote).toBe('selected');
          }

          // After reveal, the actual value is broadcast to every connected socket.
          handleVoteReveal(mod, { roomId });
          const revealedState = makeRoomState(room, mod);
          for (const { socket, vote } of voters) {
            const key = stateKeyForSocket(revealedState, socket);
            expect(revealedState.users[key].vote).toBe(vote);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('intentional leaves: a disconnect with no reconnect ultimately removes the user', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.integer({ min: 0, max: 100000 }), (clientId, suffix) => {
        vi.useFakeTimers();
        try {
          rooms.clear();
          const roomId = 'PBT' + suffix;
          const s = makeSocket('s-' + clientId, { clientId });
          handleRoomJoin(s, { roomId, name: 'U', clientId });
          const room = rooms.get(roomId);
          expect(findUser(room, s)).toBeDefined();

          // Intentional leave: disconnect, then let any grace window elapse.
          handleDisconnect(s);
          vi.advanceTimersByTime(120000);

          expect(findUser(room, s)).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      }),
      { numRuns: 50 }
    );
  });
});
