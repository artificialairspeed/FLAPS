/**
 * Bug Condition Exploration Tests (Property 1) — SERVER
 * Spec: session-persistence-on-tab-inactive
 *
 * These tests encode the EXPECTED behavior (Property 1: Seamless Session
 * Persistence on Return). They are written BEFORE the fix and are EXPECTED TO
 * FAIL on the unfixed code — the failures are the counterexamples that confirm
 * the hypothesized root cause:
 *   - handleDisconnect immediately runs `delete room.users[socket.id]`
 *   - identity is keyed on the transient `socket.id` (no stable `clientId`)
 *
 * Once the fix is in place (stable clientId identity + disconnect grace +
 * resume-on-reconnect) these exact tests become the Fix Checking for Property 1.
 *
 * Bug condition (from bugfix.md / design.md):
 *   isBugCondition(x) =
 *     x.userHasActiveSession AND x.wentInactive AND x.connectionLapsed
 *     AND x.userReturns AND NOT x.userIntentionallyLeft
 *
 * Property 1 assertions for isBugCondition inputs:
 *   sessionRestored = true, roleRestored = priorRole,
 *   requiredManualRejoin = false, repeatedConnectionErrorsShown = false,
 *   canContinueInSameSession = true
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  rooms,
  getOrCreateRoom,
  makeRoomState,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleDisconnect,
} from '../../server.js';

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
 * `clientId` is passed through socket.data so the (future) fix can key identity
 * off of it; the unfixed code simply ignores it and keys off `id`.
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

/**
 * Returns the user record for a returning client regardless of whether the
 * server keys `room.users` by clientId (fixed) or socket.id (unfixed). This
 * makes the intent of each assertion explicit: after a background lapse and
 * return, the SAME logical user must still be present with role + vote intact.
 */
function findUserByClientId(room, clientId, fallbackSocketId) {
  if (room.users[clientId]) return room.users[clientId];
  if (fallbackSocketId && room.users[fallbackSocketId]) {
    return room.users[fallbackSocketId];
  }
  return undefined;
}

const ROOM = 'PERSIST1';

beforeEach(() => {
  rooms.clear();
});

describe('Property 1 (server): Seamless session persistence on return', () => {
  it('sanity: isBugCondition matches the specified backgrounding scenario', () => {
    expect(
      isBugCondition({
        userHasActiveSession: true,
        wentInactive: true,
        connectionLapsed: true,
        userReturns: true,
        userIntentionallyLeft: false,
      })
    ).toBe(true);

    // An intentional leave is NOT the bug condition (preservation territory).
    expect(
      isBugCondition({
        userHasActiveSession: true,
        wentInactive: true,
        connectionLapsed: true,
        userReturns: true,
        userIntentionallyLeft: true,
      })
    ).toBe(false);
  });

  it('Case 1 — a transient disconnect must NOT immediately remove the user (session preserved)', () => {
    const clientId = 'client-case1';
    const socket = makeSocket('sock-1', { clientId });

    handleRoomJoin(socket, { roomId: ROOM, name: 'Ada', clientId });

    const room = rooms.get(ROOM);
    expect(room).toBeDefined();
    const before = Object.keys(room.users).length;
    expect(before).toBe(1);

    // User backgrounds the app -> socket heartbeat lapses -> disconnect fires.
    handleDisconnect(socket);

    // EXPECTED (Property 1: sessionRestored / canContinueInSameSession):
    // the session is held through the lapse, so the user is still in the room.
    // UNFIXED: handleDisconnect runs `delete room.users[socket.id]` immediately.
    expect(Object.keys(room.users).length).toBe(before);
    expect(findUserByClientId(room, clientId, socket.id)).toBeDefined();
  });

  it('Case 2 — identity survives reconnect under a new socket.id (same user, same vote)', () => {
    const clientId = 'client-case2';

    // Active session: join and cast a vote.
    const first = makeSocket('sock-2a', { clientId });
    handleRoomJoin(first, { roomId: ROOM, name: 'Grace', clientId });
    handleVoteSet(first, { roomId: ROOM, vote: '5' });

    const room = rooms.get(ROOM);
    expect(findUserByClientId(room, clientId, first.id)?.vote).toBe('5');

    // Backgrounded -> disconnect.
    handleDisconnect(first);

    // Returns: browser reconnects under a BRAND NEW socket.id, same clientId.
    const second = makeSocket('sock-2b', { clientId });
    handleRoomJoin(second, { roomId: ROOM, name: 'Grace', clientId });

    // EXPECTED (Property 1: roleRestored / canContinueInSameSession):
    // the returning client maps back to the same user record with vote intact,
    // and there is exactly one user (no ghost/duplicate).
    // UNFIXED: identity keyed on socket.id -> new record, vote lost.
    expect(Object.keys(room.users).length).toBe(1);
    const resumed = findUserByClientId(room, clientId, second.id);
    expect(resumed).toBeDefined();
    expect(resumed.vote).toBe('5');
  });

  it('Case 3 — facilitator role + identity is restored on reconnect', () => {
    const clientId = 'client-fac';

    const creator = makeSocket('sock-3a', { clientId });
    handleRoomCreate(creator, { desiredRoomId: ROOM, name: 'Mod', clientId });

    const room = rooms.get(ROOM);
    const modKey = room.moderatorKey;
    expect(findUserByClientId(room, clientId, creator.id)?.isModerator).toBe(true);

    // Facilitator backgrounds -> disconnect.
    handleDisconnect(creator);

    // Returns under a new socket.id, re-sending the stable clientId + modKey.
    const back = makeSocket('sock-3b', { clientId, modKey });
    handleRoomJoin(back, { roomId: ROOM, name: 'Mod', modKey, clientId });

    // EXPECTED (Property 1: roleRestored = facilitator, canContinueInSameSession):
    // the SAME identity is still present and still a moderator, and the state
    // reports youAreModerator.
    // UNFIXED: room.users is keyed by socket.id, so the stable clientId key is
    // absent (identity discontinuity).
    expect(Object.keys(room.users).length).toBe(1);
    const resumed = findUserByClientId(room, clientId, back.id);
    expect(resumed).toBeDefined();
    expect(resumed.isModerator).toBe(true);
    expect(room.users[clientId]).toBeDefined(); // stable-identity keying

    const state = makeRoomState(room, back);
    expect(state.youAreModerator).toBe(true);
  });

  it('Case 5 (edge) — a participant vote is preserved across a background lapse', () => {
    const clientId = 'client-vote';

    const first = makeSocket('sock-5a', { clientId });
    handleRoomJoin(first, { roomId: ROOM, name: 'Lin', clientId });
    handleVoteSet(first, { roomId: ROOM, vote: '8' });

    const room = rooms.get(ROOM);
    expect(findUserByClientId(room, clientId, first.id)?.vote).toBe('8');

    // Background lapse then return within the grace window.
    handleDisconnect(first);
    const second = makeSocket('sock-5b', { clientId });
    handleRoomJoin(second, { roomId: ROOM, name: 'Lin', clientId });

    // EXPECTED: prior vote is still present after resuming.
    // UNFIXED: vote lost (new record) or user gone.
    const resumed = findUserByClientId(room, clientId, second.id);
    expect(resumed).toBeDefined();
    expect(resumed.vote).toBe('8');
  });
});

describe('Property 1 (server, PBT): generalized identity + role + vote persistence', () => {
  // Scoped-then-generalized: the concrete cases above pin down the bug; this
  // property generalizes across roles and votes. For ALL inputs where the bug
  // condition holds, a disconnect followed by a reconnect within grace under a
  // new socket.id must restore the session (identity, role, vote).
  //
  // Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
  const deck = ['0.5', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144'];

  it('FOR ALL isBugCondition(input): session is restored with role + vote intact', () => {
    fc.assert(
      fc.property(
        fc.record({
          isFacilitator: fc.boolean(),
          vote: fc.constantFrom(...deck),
          clientId: fc.uuid(),
          roomSuffix: fc.integer({ min: 0, max: 100000 }),
        }),
        ({ isFacilitator, vote, clientId, roomSuffix }) => {
          rooms.clear();
          const roomId = 'PBT' + roomSuffix;

          const input = {
            userHasActiveSession: true,
            wentInactive: true,
            connectionLapsed: true,
            userReturns: true,
            userIntentionallyLeft: false,
            priorRole: isFacilitator ? 'facilitator' : 'participant',
          };
          // Only exercise the property for buggy inputs (defensive; always true here).
          fc.pre(isBugCondition(input));

          // Establish an active session and cast a vote.
          const first = makeSocket('s-' + clientId + '-a', { clientId });
          let modKey = null;
          if (isFacilitator) {
            handleRoomCreate(first, { desiredRoomId: roomId, name: 'F', clientId });
            modKey = rooms.get(roomId).moderatorKey;
            first.data.modKey = modKey;
          } else {
            handleRoomJoin(first, { roomId, name: 'P', clientId });
          }
          handleVoteSet(first, { roomId, vote });

          // Background lapse -> disconnect.
          handleDisconnect(first);

          // Return within grace under a new socket.id with the same identity.
          const second = makeSocket('s-' + clientId + '-b', { clientId, modKey });
          handleRoomJoin(second, { roomId, name: isFacilitator ? 'F' : 'P', modKey, clientId });

          const room = rooms.get(roomId);
          const resumed = findUserByClientId(room, clientId, second.id);

          // sessionRestored / canContinueInSameSession
          expect(resumed).toBeDefined();
          // roleRestored = priorRole
          expect(!!resumed.isModerator).toBe(isFacilitator);
          // state (vote) preserved
          expect(resumed.vote).toBe(vote);
          // no duplicate/ghost participant
          expect(Object.keys(room.users).length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
