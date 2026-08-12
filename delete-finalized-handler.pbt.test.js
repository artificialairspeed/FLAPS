/**
 * Property-based tests for the story-delete SERVER handler.
 * Spec: clear-revote-finalized-story (Tasks 14.1 – 14.8)
 *
 * Covers eight properties from design.md:
 *   Property 27 — An accepted delete removes exactly the requested entry
 *                 (Requirements 10.1, 10.2, 10.5, 10.11)
 *   Property 28 — Deleting the active story clears the active slot, and deleting
 *                 any other story leaves it alone (Requirements 10.3, 10.4)
 *   Property 29 — Exactly one broadcast per processed delete, issued after every
 *                 state change, at any request rate (Requirements 10.6, 10.12)
 *   Property 30 — Unauthorized and unresolvable deletes are total no-ops with no
 *                 response (Requirements 10.7, 10.8)
 *   Property 31 — An unmatched story id leaves the queue untouched but still
 *                 advances `lastActiveAt` and broadcasts once
 *                 (Requirements 10.9, 10.10)
 *   Property 32 — Finalize, re-vote, and delete sequences preserve the surviving
 *                 ids and their order (Requirements 10.13, 10.14)
 *   Property 36 — One broadcast per socket after a delete, identical for every
 *                 recipient (Requirements 11.6)
 *   Property 38 — Persistence round trip preserves a delete (Requirements 11.9)
 *
 * All eight drive the real `handleStoryQueueRemove` from `server.js` with the
 * `makeSocket` fake-socket pattern established in `server.exploration.test.js`
 * and reused in `revote-handler.pbt.test.js`: no network, no real `io`.
 * `io.in(roomId).fetchSockets()` is replaced with a counting stub so "exactly
 * one broadcast" is assertable and so the room state observed *at broadcast
 * time* can be snapshotted — which is how "issued after every state change" is
 * checked rather than assumed.
 *
 * `handleStoryQueueRemove` is unchanged by this feature. It takes no ack
 * callback, returns nothing, and calls `Date.now()` itself with no injected
 * clock. So every `lastActiveAt` claim here is asserted as **bounded
 * monotonicity** — `before <= room.lastActiveAt <= after`, sampled around the
 * call — never as equality against an injected value. Property 29's "without
 * advancing the clock" is a statement about request *rate* (no rate-based
 * rejection), not about timestamps.
 *
 * Generators come from `public/story-revote.pbt.test.js`, which exports them for
 * exactly this purpose (task 13.4). That file is itself a test file, so its own
 * generator self-check suites are collected a second time here; they are fast
 * (~0.2 s) and importing them is what keeps one definition of the generated
 * input space instead of two.
 *
 * Importing `server.js` does not enable persistence (it is armed only by the
 * live entry point), and Property 38 does its round trip entirely in memory, so
 * nothing here touches `.rooms-state.json` — pinned by the final sanity test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import {
  io,
  rooms,
  getOrCreateRoom,
  handleStoryQueueRemove,
  handleStoryQueueRevote,
  handleStoryQueueFinalize
} from './server.js';
import {
  NUM_RUNS,
  ROOM_DECK,
  arbitraryRoom,
  arbitraryRoomWithFinalizedStory,
  arbitraryRoomWithOperations,
  arbitraryDeleteRequest,
  arbitraryRoomIdVariant,
  arbitraryInvalidStoryId,
  unknownStoryId,
  unknownRoomId,
  coerceStoryId,
  resolveRequestRoomId
} from './public/story-revote.pbt.test.js';

// ---------------------------------------------------------------------------
// Fake socket (the `makeSocket` pattern from server.exploration.test.js).
// ---------------------------------------------------------------------------

/**
 * Minimal fake Socket.IO socket good enough to receive `room:state`.
 * Payloads are deep-cloned on arrival: `makeRoomState` hands out live
 * references to `room.storyQueue` / `room.story`, so a clone is what pins the
 * state as it was at delivery time.
 *
 * @param {string} id - Socket id.
 * @param {object} [data] - `socket.data` contents (clientId, roomId, modKey).
 * @returns {object} The fake socket.
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
      emitted.push({ event, payload: structuredClone(payload) });
    },
    emitted
  };
}

/**
 * Payloads a socket received for `room:state`.
 *
 * @param {object} socket - A fake socket.
 * @returns {object[]} The `room:state` payloads, in arrival order.
 */
function roomStates(socket) {
  return socket.emitted.filter((e) => e.event === 'room:state').map((e) => e.payload);
}

/**
 * Fields of a `room:state` payload that must be identical for every recipient.
 *
 * @param {object} payload - One `room:state` payload.
 * @returns {object} The payload without its per-viewer fields.
 */
function sharedView(payload) {
  const { youAreModerator, myId, mySocketId, ...shared } = payload;
  return shared;
}

/** Let the async `broadcastRoom` run to completion. */
function flushBroadcast() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A callback the handler must never invoke: `handleStoryQueueRemove` takes no
 * ack, so passing one is how "no acknowledgement and no error response" becomes
 * observable rather than assumed.
 *
 * @returns {{calls: unknown[][], fn: Function}}
 */
function makeNeverCalledAck() {
  const calls = [];
  return { calls, fn: (...args) => calls.push(args) };
}

/** The `room.story` value the server writes when no story is active. */
const STORY_PLACEHOLDER = Object.freeze({
  number: '',
  title: 'Add Story to Queue',
  finalPoints: null
});

// ---------------------------------------------------------------------------
// Broadcast stub: counts broadcasts and snapshots the room at broadcast time.
// ---------------------------------------------------------------------------

/** @type {Array<{ roomId: string, state: object|null }>} */
let broadcasts = [];
/** @type {object[]} */
let joinedSockets = [];

/**
 * Install the counting `io.in` stub and clear server state. Scoped to the outer
 * describe below rather than the file, so the generator self-check suites this
 * file imports are not wrapped in hooks that have nothing to do with them.
 */
function installBroadcastStub() {
  rooms.clear();
  broadcasts = [];
  joinedSockets = [];
  io.in = (roomId) => ({
    fetchSockets: async () => {
      const room = rooms.get(roomId);
      broadcasts.push({
        roomId,
        // The state as it stands at the moment the broadcast is issued.
        state: room
          ? structuredClone({
              storyQueue: room.storyQueue,
              activeStoryId: room.activeStoryId,
              story: room.story,
              phase: room.phase,
              users: room.users,
              lastActiveAt: room.lastActiveAt
            })
          : null
      });
      return joinedSockets;
    }
  });
}

// ---------------------------------------------------------------------------
// Seeding and snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Put a generated room into the server's `rooms` map under its own id, cloned
 * so the generated value is never mutated by the handler.
 *
 * @param {object} generated - A room from `arbitraryRoom`.
 * @returns {object} The live room now held by the server.
 */
function seedRoom(generated) {
  const room = structuredClone(generated);
  rooms.set(room.roomId, room);
  return room;
}

/**
 * The requesting facilitator's socket for `room`.
 *
 * @param {object} room - The live room.
 * @param {object} [overrides] - `socket.data` overrides (e.g. a wrong modKey).
 * @returns {object} The fake socket.
 */
function facilitatorSocket(room, overrides = {}) {
  return makeSocket('sock-mod', {
    clientId: 'client-mod',
    roomId: room.roomId,
    modKey: room.moderatorKey,
    ...overrides
  });
}

/**
 * The four room fields the active-story reset writes, plus the votes it clears.
 *
 * @param {object} room - The live room.
 * @returns {object} A deep clone of the active-slot fields.
 */
function activeSlotSnapshot(room) {
  return structuredClone({
    activeStoryId: room.activeStoryId,
    story: room.story,
    phase: room.phase,
    votes: Object.fromEntries(Object.entries(room.users).map(([uid, u]) => [uid, u.vote]))
  });
}

/**
 * Every user record with its `vote` stripped, so "every other field of every
 * record unchanged" is assertable independently of the vote clearing.
 *
 * @param {object} room - The live room.
 * @returns {object} The users map without `vote` fields.
 */
function usersWithoutVotes(room) {
  return structuredClone(
    Object.fromEntries(
      Object.entries(room.users).map(([uid, u]) => {
        const { vote, ...rest } = u;
        return [uid, rest];
      })
    )
  );
}

/**
 * Every room the server holds, deep-cloned and keyed by id — the value
 * Property 30's "leaves every room deep-equal" claim compares.
 *
 * @returns {Record<string, object>} A deep snapshot of the whole `rooms` map.
 */
function snapshotAllRooms() {
  const out = {};
  for (const [roomId, room] of rooms.entries()) out[roomId] = structuredClone(room);
  return out;
}

/**
 * A request `roomId` that always resolves back to `roomId`: the id itself, the
 * id wrapped in whitespace with mixed case, or a blank value that falls back to
 * the socket's joined room. The unknown-room variant of `arbitraryRoomIdVariant`
 * is filtered out, because the properties below that use this generator require
 * the request to be *processed* (Requirement 10.2); the unresolvable branch is
 * Property 30's subject instead.
 *
 * @param {string} roomId - The target room's own (already normalized) id.
 * @returns {fc.Arbitrary<string|null|undefined>}
 */
function resolvingRoomIdVariant(roomId) {
  return arbitraryRoomIdVariant(roomId).filter(
    (variant) => resolveRequestRoomId(variant, roomId) === roomId
  );
}

/**
 * Story ids that match no entry in `room`'s queue, spanning the whole invalid-id
 * range (absent, `null`, empty, whitespace-only, numbers, booleans, arrays,
 * objects) plus real-looking ids no entry carries. The filter is what makes the
 * "matches no entry" precondition true by construction: the array branch of
 * `arbitraryInvalidStoryId` stringifies to a bare id, which could otherwise
 * coincide with a live one.
 *
 * @param {object} room - The target room.
 * @returns {fc.Arbitrary<unknown>}
 */
function unmatchedStoryId(room) {
  const ids = room.storyQueue.map((entry) => entry.id);
  return fc
    .oneof(
      { weight: 3, arbitrary: arbitraryInvalidStoryId() },
      { weight: 1, arbitrary: unknownStoryId(ids) }
    )
    .filter((candidate) => !ids.includes(coerceStoryId(candidate)));
}

// ---------------------------------------------------------------------------
// Persistence mirrors for Property 38.
//
// `serializeRoomsForPersist` and `loadPersistedRooms` are not exported by
// `server.js`, and the load path reads the real `.rooms-state.json`. These two
// helpers mirror them field for field so the round trip runs entirely in memory
// on a string snapshot — no filesystem, and nothing written to the real file.
// The emoji whitelist the restore path applies to user records is deliberately
// not mirrored: Property 38's claim is about the queue, and no assertion below
// reads a restored emoji.
// ---------------------------------------------------------------------------

/**
 * The per-room shape `.rooms-state.json` holds, mirroring
 * `serializeRoomsForPersist`: nine room fields plus a users map reduced to
 * `{ name, emoji, vote, isModerator }`.
 *
 * @param {object} room - The live room.
 * @returns {object} The persistable snapshot object.
 */
function serializeRoomForPersist(room) {
  const users = {};
  for (const [key, u] of Object.entries(room.users)) {
    users[key] = {
      name: u.name,
      emoji: u.emoji || '',
      vote: u.vote ?? null,
      isModerator: !!u.isModerator
    };
  }
  return {
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
  };
}

/**
 * The restore `loadPersistedRooms` performs on one parsed entry: per-field
 * defaulting, users rebuilt with cleared runtime state, and `lastActiveAt`
 * refreshed to the restore time. Returns `null` for an entry the loader skips.
 *
 * @param {unknown} saved - One parsed entry from the persisted array.
 * @param {number} now - The restore timestamp.
 * @returns {object|null} The restored room, or `null` when skipped.
 */
function restorePersistedRoom(saved, now) {
  if (!saved || typeof saved.roomId !== 'string') return null;
  const roomId = saved.roomId.trim().toUpperCase().slice(0, 50);
  if (!roomId) return null;

  const users = {};
  if (saved.users && typeof saved.users === 'object') {
    for (const [key, u] of Object.entries(saved.users)) {
      if (!u || typeof u !== 'object') continue;
      users[key] = {
        name: typeof u.name === 'string' ? u.name : '',
        vote: u.vote ?? null,
        isModerator: !!u.isModerator,
        socketId: null,
        connected: false,
        disconnectedAt: now,
        graceTimer: null
      };
    }
  }

  return {
    roomId,
    deck: Array.isArray(saved.deck) ? saved.deck : [...ROOM_DECK],
    phase: saved.phase === 'revealed' ? 'revealed' : 'voting',
    story: saved.story && typeof saved.story === 'object' ? saved.story : { ...STORY_PLACEHOLDER },
    storyQueue: Array.isArray(saved.storyQueue) ? saved.storyQueue : [],
    activeStoryId: saved.activeStoryId ?? null,
    users,
    moderatorKey:
      typeof saved.moderatorKey === 'string' && saved.moderatorKey
        ? saved.moderatorKey
        : 'regenerated-key',
    createdAt: typeof saved.createdAt === 'number' ? saved.createdAt : now,
    lastActiveAt: now
  };
}

// ---------------------------------------------------------------------------
// The delete handler properties.
// ---------------------------------------------------------------------------

describe('clear-revote-finalized-story: handleStoryQueueRemove properties', () => {
  beforeEach(() => {
    installBroadcastStub();
  });

  afterEach(() => {
    delete io.in; // restore the real Server.prototype.in
    rooms.clear();
  });

  // Feature: clear-revote-finalized-story, Property 27: An accepted delete removes exactly the requested entry
  describe('Property 27: An accepted delete removes exactly the requested entry', () => {
    it('FOR ALL rooms, finalized story ids, and resolvable request room ids: the entry is gone, every survivor is untouched, and lastActiveAt advances', async () => {
      // Validates: Requirements 10.1, 10.2, 10.5, 10.11
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoomWithFinalizedStory().chain(({ room, storyId }) =>
            fc.record({
              room: fc.constant(room),
              storyId: fc.constant(storyId),
              requestRoomId: resolvingRoomIdVariant(room.roomId)
            })
          ),
          async ({ room: generated, storyId: targetId, requestRoomId }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            const socket = facilitatorSocket(room);
            joinedSockets = [socket];

            const queueBefore = structuredClone(room.storyQueue);
            const lastActiveBefore = room.lastActiveAt;
            const ack = makeNeverCalledAck();

            // The request story id's string form equals the entry's id.
            expect(coerceStoryId(targetId)).toBe(targetId);
            expect(queueBefore.some((entry) => entry.id === targetId)).toBe(true);

            const before = Date.now();
            handleStoryQueueRemove(socket, { roomId: requestRoomId, storyId: targetId }, ack.fn);
            const after = Date.now();
            await flushBroadcast();

            // REQ 10.2: the request resolved to this room and was processed.
            expect(rooms.get(room.roomId)).toBe(room);
            expect(broadcasts.length).toBe(1);
            expect(broadcasts[0].roomId).toBe(room.roomId);

            // REQ 10.1: exactly one entry shorter, and the removed id is gone.
            expect(room.storyQueue.length).toBe(queueBefore.length - 1);
            expect(room.storyQueue.some((entry) => entry.id === targetId)).toBe(false);

            // REQ 10.11: every survivor keeps its position and all four fields.
            expect(room.storyQueue).toEqual(queueBefore.filter((entry) => entry.id !== targetId));

            // REQ 10.5: lastActiveAt is the timestamp taken while processing the
            // request. The handler calls Date.now() itself, so this is bounded
            // monotonicity around the call, not equality against an injection.
            expect(room.lastActiveAt).toBeGreaterThanOrEqual(before);
            expect(room.lastActiveAt).toBeLessThanOrEqual(after);
            expect(room.lastActiveAt).toBeGreaterThanOrEqual(lastActiveBefore);

            // No response of any kind travels back on this event.
            expect(ack.calls).toEqual([]);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 28: Deleting the active story clears the active slot, and deleting any other story leaves it alone
  describe('Property 28: Deleting the active story clears the active slot, and deleting any other story leaves it alone', () => {
    /**
     * A room with a non-empty queue, a chosen delete target, and an
     * `activeStoryId` that is `null`, the target's id, another entry's id, or an
     * id matching no entry — so both directions of the biconditional are driven
     * by one generator.
     *
     * @returns {fc.Arbitrary<{room: object, targetId: string}>}
     */
    function arbitraryRoomWithTargetAndActiveSlot() {
      return arbitraryRoom()
        .filter((room) => room.storyQueue.length > 0)
        .chain((room) =>
          fc
            .record({
              targetIndex: fc.nat({ max: room.storyQueue.length - 1 }),
              otherIndex: fc.nat({ max: room.storyQueue.length - 1 }),
              slot: fc.constantFrom('null', 'target', 'other', 'foreign')
            })
            .map(({ targetIndex, otherIndex, slot }) => {
              const queue = room.storyQueue.map((entry) => ({ ...entry }));
              const target = queue[targetIndex];
              const others = queue.filter((entry) => entry.id !== target.id);

              let activeStoryId = null;
              if (slot === 'target') activeStoryId = target.id;
              else if (slot === 'other' && others.length) {
                activeStoryId = others[otherIndex % others.length].id;
              } else if (slot === 'foreign' || (slot === 'other' && !others.length)) {
                // 's-absent-slot' is outside the generated id alphabet, so no
                // entry can carry it.
                activeStoryId = 's-absent-slot';
              }

              const active = queue.find((entry) => entry.id === activeStoryId) || null;
              return {
                room: {
                  ...room,
                  storyQueue: queue,
                  activeStoryId,
                  story: active
                    ? { number: active.number, title: active.title, finalPoints: active.finalPoints }
                    : room.story
                },
                targetId: target.id
              };
            })
        );
    }

    it('FOR ALL rooms and any activeStoryId: the active slot is reset if and only if the removed entry was the active one', async () => {
      // Validates: Requirements 10.3, 10.4
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoomWithTargetAndActiveSlot(),
          async ({ room: generated, targetId }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            const socket = facilitatorSocket(room);
            joinedSockets = [socket];

            const wasActive = room.activeStoryId === targetId;
            const slotBefore = activeSlotSnapshot(room);
            const usersBefore = usersWithoutVotes(room);

            handleStoryQueueRemove(socket, { roomId: room.roomId, storyId: targetId });
            await flushBroadcast();

            // The delete itself was accepted in both branches.
            expect(room.storyQueue.some((entry) => entry.id === targetId)).toBe(false);

            // Both directions are asserted separately, so an inverted condition
            // fails whichever way round it is inverted.
            if (wasActive) {
              // REQ 10.3: the slot is cleared, the room reopens for voting, the
              // placeholder is written with exactly three fields, and every
              // vote is dropped — connected or not.
              expect(room.activeStoryId).toBeNull();
              expect(room.phase).toBe('voting');
              expect(room.story).toEqual({ ...STORY_PLACEHOLDER });
              expect(Object.keys(room.story).sort()).toEqual(['finalPoints', 'number', 'title']);
              for (const record of Object.values(room.users)) expect(record.vote).toBeNull();
            } else {
              // REQ 10.4: none of the four fields is written at all.
              expect(activeSlotSnapshot(room)).toEqual(slotBefore);
            }

            // Every other field of every user record is untouched either way.
            expect(usersWithoutVotes(room)).toEqual(usersBefore);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 29: Exactly one broadcast per processed delete, issued after every state change, at any request rate
  describe('Property 29: Exactly one broadcast per processed delete, issued after every state change, at any request rate', () => {
    it('FOR ALL rooms and 2..20 back-to-back facilitator deletes: each request is processed, broadcasts once, and the state at that broadcast already reflects it', async () => {
      // Validates: Requirements 10.6, 10.12
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoom().chain((room) =>
            fc.record({
              room: fc.constant(room),
              requests: fc.array(
                fc.record({
                  roomId: resolvingRoomIdVariant(room.roomId),
                  storyId: arbitraryDeleteRequest(room).map((request) => request.storyId)
                }),
                { minLength: 2, maxLength: 20 }
              )
            })
          ),
          async ({ room: generated, requests }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            const socket = facilitatorSocket(room);
            joinedSockets = [socket];

            for (let i = 0; i < requests.length; i++) {
              const request = requests[i];
              const id = coerceStoryId(request.storyId);
              const wasActive = room.activeStoryId === id;
              const expectedIds = room.storyQueue
                .map((entry) => entry.id)
                .filter((entryId) => entryId !== id);

              const before = Date.now();
              handleStoryQueueRemove(socket, request);
              const after = Date.now();
              await flushBroadcast();

              // REQ 10.12: no request is turned away on rate grounds, however
              // fast they arrive — the requests are issued back to back with no
              // clock advance between them.
              // REQ 10.6: exactly one broadcast per processed request.
              expect(broadcasts.length).toBe(i + 1);

              const atBroadcast = broadcasts[i].state;
              expect(broadcasts[i].roomId).toBe(room.roomId);
              expect(atBroadcast).not.toBeNull();

              // The state observed at the broadcast already carries this
              // request's removal...
              expect(atBroadcast.storyQueue.map((entry) => entry.id)).toEqual(expectedIds);
              expect(atBroadcast.storyQueue.some((entry) => entry.id === id)).toBe(false);

              // ...and this request's active-story reset, when it had one.
              if (wasActive) {
                expect(atBroadcast.activeStoryId).toBeNull();
                expect(atBroadcast.phase).toBe('voting');
                expect(atBroadcast.story).toEqual({ ...STORY_PLACEHOLDER });
                for (const record of Object.values(atBroadcast.users)) {
                  expect(record.vote).toBeNull();
                }
              }

              // The timestamp written for this request was already in place.
              expect(atBroadcast.lastActiveAt).toBe(room.lastActiveAt);
              expect(room.lastActiveAt).toBeGreaterThanOrEqual(before);
              expect(room.lastActiveAt).toBeLessThanOrEqual(after);
            }

            // One broadcast per request over the whole burst, not one per
            // surviving entry and not a coalesced single broadcast.
            expect(broadcasts.length).toBe(requests.length);
            expect(roomStates(socket).length).toBe(requests.length);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 30: Unauthorized and unresolvable deletes are total no-ops with no response
  describe('Property 30: Unauthorized and unresolvable deletes are total no-ops with no response', () => {
    it('FOR ALL rooms and either rejection cause: every room is deep-equal including lastActiveAt, no room is created, nothing is broadcast, and nothing comes back', async () => {
      // Validates: Requirements 10.7, 10.8
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoom().chain((room) =>
            fc.record({
              room: fc.constant(room),
              storyId: arbitraryDeleteRequest(room).map((request) => request.storyId),
              cause: fc.constantFrom('not-facilitator', 'no-room'),
              resolvingRoomId: resolvingRoomIdVariant(room.roomId),
              unresolvableRoomId: fc.oneof(
                { weight: 3, arbitrary: unknownRoomId(room.roomId) },
                { weight: 1, arbitrary: fc.constant('') },
                { weight: 1, arbitrary: fc.constant(null) },
                { weight: 1, arbitrary: fc.constant(undefined) }
              ),
              wrongModKey: fc.constantFrom(undefined, '', 'not-the-moderator-key')
            })
          ),
          async ({ room: generated, storyId, cause, resolvingRoomId, unresolvableRoomId, wrongModKey }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            // A second room, so "every room held by the server" is more than a
            // claim about one room. Its id is longer than any generated id, so
            // it can never be the request's target.
            const decoy = getOrCreateRoom('DECOYROOM');
            decoy.storyQueue = [{ id: 's-decoy', number: '7', title: 'Decoy', finalPoints: '5' }];
            decoy.activeStoryId = 's-decoy';
            decoy.story = { number: '7', title: 'Decoy', finalPoints: '5' };
            decoy.users = { 'client-decoy': { name: 'Dee', emoji: '', vote: '5', isModerator: false, connected: true } };
            decoy.lastActiveAt = 4242;

            let socket;
            let payload;
            if (cause === 'not-facilitator') {
              // The room resolves; only the moderator gate fails.
              socket = facilitatorSocket(room, { id: 'sock-participant', modKey: wrongModKey });
              payload = { roomId: resolvingRoomId, storyId };
              expect(socket.data.modKey).not.toBe(room.moderatorKey);
            } else {
              // The requester holds the right key, but the room id resolves to
              // nothing: the socket has joined no room, so there is no fallback.
              socket = makeSocket('sock-roomless', {
                clientId: 'client-roomless',
                roomId: undefined,
                modKey: room.moderatorKey
              });
              payload = { roomId: unresolvableRoomId, storyId };
              expect(rooms.has(resolveRequestRoomId(unresolvableRoomId, undefined))).toBe(false);
            }
            joinedSockets = [socket];

            const roomsBefore = snapshotAllRooms();
            const ack = makeNeverCalledAck();

            handleStoryQueueRemove(socket, payload, ack.fn);
            await flushBroadcast();

            // REQ 10.7, 10.8: no state change anywhere, lastActiveAt included.
            expect(snapshotAllRooms()).toEqual(roomsBefore);

            // No room was created for an unresolvable id.
            expect(Object.keys(snapshotAllRooms()).sort()).toEqual(Object.keys(roomsBefore).sort());

            // No broadcast was even attempted, and nothing reached any socket.
            expect(broadcasts).toEqual([]);
            expect(socket.emitted).toEqual([]);

            // No acknowledgement and no error response: this event has neither.
            expect(ack.calls).toEqual([]);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 31: An unmatched story id leaves the queue untouched but still advances `lastActiveAt` and broadcasts once
  describe('Property 31: An unmatched story id leaves the queue untouched but still advances lastActiveAt and broadcasts once', () => {
    it('FOR ALL rooms and any unmatched story id, including a repeat of an accepted delete: the queue is untouched, lastActiveAt advances, and exactly one broadcast goes out', async () => {
      // Validates: Requirements 10.9, 10.10
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoom().chain((room) =>
            fc.record({
              room: fc.constant(room),
              unmatched: unmatchedStoryId(room),
              requestRoomId: resolvingRoomIdVariant(room.roomId),
              // `null` when the queue is empty: there is then no accepted delete
              // to repeat, so the repeat leg is skipped for that room.
              repeatIndex: room.storyQueue.length
                ? fc.nat({ max: room.storyQueue.length - 1 })
                : fc.constant(null)
            })
          ),
          async ({ room: generated, unmatched, requestRoomId, repeatIndex }) => {
            // ---- Leg A: a story id that matches nothing ----------------------
            installBroadcastStub();

            const room = seedRoom(generated);
            const socket = facilitatorSocket(room);
            joinedSockets = [socket];

            const queueBefore = structuredClone(room.storyQueue);
            const slotBefore = activeSlotSnapshot(room);
            const usersBefore = usersWithoutVotes(room);
            const ack = makeNeverCalledAck();

            expect(room.storyQueue.some((entry) => entry.id === coerceStoryId(unmatched))).toBe(
              false
            );

            const before = Date.now();
            handleStoryQueueRemove(socket, { roomId: requestRoomId, storyId: unmatched }, ack.fn);
            const after = Date.now();
            await flushBroadcast();

            // REQ 10.9: nothing about the queue moves — no length change, no
            // reorder, no field change, and no entry added.
            expect(room.storyQueue).toEqual(queueBefore);
            // ...and the active slot and every vote are left alone.
            expect(activeSlotSnapshot(room)).toEqual(slotBefore);
            expect(usersWithoutVotes(room)).toEqual(usersBefore);

            // REQ 10.9: yet this is a BROADCASTING no-op, not a silent one —
            // lastActiveAt advances and exactly one broadcast carrying the
            // unchanged state goes out, with no response to the requester.
            expect(room.lastActiveAt).toBeGreaterThanOrEqual(before);
            expect(room.lastActiveAt).toBeLessThanOrEqual(after);
            expect(broadcasts.length).toBe(1);
            expect(broadcasts[0].state.storyQueue).toEqual(queueBefore);
            expect(roomStates(socket).length).toBe(1);
            expect(ack.calls).toEqual([]);

            // ---- Leg B: repeating an already-accepted delete -----------------
            // The second request for the same id is exactly the unmatched case,
            // which is where Requirement 10.10's idempotence comes from.
            if (repeatIndex === null) return;

            installBroadcastStub();

            const repeatRoom = seedRoom(generated);
            const repeatSocket = facilitatorSocket(repeatRoom);
            joinedSockets = [repeatSocket];

            const repeatId = repeatRoom.storyQueue[repeatIndex].id;
            const repeatAck = makeNeverCalledAck();

            handleStoryQueueRemove(
              repeatSocket,
              { roomId: requestRoomId, storyId: repeatId },
              repeatAck.fn
            );
            await flushBroadcast();

            expect(broadcasts.length).toBe(1);
            const queueAfterFirst = structuredClone(repeatRoom.storyQueue);
            const slotAfterFirst = activeSlotSnapshot(repeatRoom);
            const usersAfterFirst = usersWithoutVotes(repeatRoom);
            expect(queueAfterFirst.some((entry) => entry.id === repeatId)).toBe(false);

            const repeatBefore = Date.now();
            handleStoryQueueRemove(
              repeatSocket,
              { roomId: requestRoomId, storyId: repeatId },
              repeatAck.fn
            );
            const repeatAfter = Date.now();
            await flushBroadcast();

            // REQ 10.10: the second request produces a queue deep-equal to the
            // one the first produced and leaves the other fields alone...
            expect(repeatRoom.storyQueue).toEqual(queueAfterFirst);
            expect(activeSlotSnapshot(repeatRoom)).toEqual(slotAfterFirst);
            expect(usersWithoutVotes(repeatRoom)).toEqual(usersAfterFirst);

            // ...while still advancing lastActiveAt and broadcasting once more.
            expect(repeatRoom.lastActiveAt).toBeGreaterThanOrEqual(repeatBefore);
            expect(repeatRoom.lastActiveAt).toBeLessThanOrEqual(repeatAfter);
            expect(broadcasts.length).toBe(2);
            expect(broadcasts[1].state.storyQueue).toEqual(queueAfterFirst);
            expect(roomStates(repeatSocket).length).toBe(2);
            expect(repeatAck.calls).toEqual([]);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 32: Finalize, re-vote, and delete sequences preserve the surviving ids and their order
  describe('Property 32: Finalize, re-vote, and delete sequences preserve the surviving ids and their order', () => {
    it('FOR ALL rooms and 1..20 mixed finalize / re-vote / delete operations, rejected ones included: after every step the surviving ids are the pre-sequence ids minus the accepted deletes, in their original order', async () => {
      // Validates: Requirements 10.13, 10.14
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoomWithOperations(),
          async ({ room: generated, operations, initialIds, expectedIds }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            const modSocket = facilitatorSocket(room);
            const outsiderSocket = makeSocket('sock-outsider', {
              clientId: 'client-outsider',
              roomId: room.roomId,
              modKey: 'not-the-moderator-key'
            });
            joinedSockets = [modSocket];

            const originalOrder = room.storyQueue.map((entry) => entry.id);
            expect(originalOrder).toEqual(initialIds);

            for (const op of operations) {
              const socket = op.isFacilitator ? modSocket : outsiderSocket;
              const payload = { roomId: op.roomId, storyId: op.storyId };

              // Each operation goes through the real handler that owns it.
              if (op.kind === 'delete') {
                handleStoryQueueRemove(socket, payload);
              } else if (op.kind === 'revote') {
                handleStoryQueueRevote(socket, payload, () => {});
              } else {
                handleStoryQueueFinalize(socket, { ...payload, finalPoints: op.points });
              }

              const idsAfter = room.storyQueue.map((entry) => entry.id);

              // REQ 10.13: the surviving id set is the pre-sequence set minus
              // the ids accepted deletes removed — finalize and re-vote steps,
              // and every rejected step, contribute nothing to that subtraction.
              expect(new Set(idsAfter)).toEqual(new Set(op.expectedIdsAfter));

              // REQ 10.14: survivors keep their pre-sequence relative order.
              expect(idsAfter).toEqual(op.expectedIdsAfter);
              expect(idsAfter).toEqual(originalOrder.filter((id) => idsAfter.includes(id)));
            }

            expect(room.storyQueue.map((entry) => entry.id)).toEqual(expectedIds);
            await flushBroadcast();
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 36: One broadcast per socket after a delete, identical for every recipient
  describe('Property 36: One broadcast per socket after a delete, identical for every recipient', () => {
    it('FOR ALL rooms with 1..20 joined sockets: an accepted delete reaches each socket exactly once, with payloads differing only in the per-viewer fields', async () => {
      // Validates: Requirements 11.6
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoomWithFinalizedStory().chain(({ room, storyId }) =>
            fc.record({
              room: fc.constant(room),
              storyId: fc.constant(storyId),
              // Whether each non-requesting socket holds the moderator key, so
              // the per-viewer facilitator flag varies across recipients.
              viewers: fc.array(fc.boolean(), { minLength: 1, maxLength: 20 })
            })
          ),
          async ({ room: generated, storyId: targetId, viewers }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            const sockets = viewers.map((holdsModKey, i) =>
              makeSocket(`sock-${i}`, {
                clientId: `client-sock-${i}`,
                roomId: room.roomId,
                // Socket 0 is the requester and must be the facilitator.
                modKey: i === 0 || holdsModKey ? room.moderatorKey : 'not-the-moderator-key'
              })
            );
            joinedSockets = sockets;

            handleStoryQueueRemove(sockets[0], { roomId: room.roomId, storyId: targetId });
            await flushBroadcast();

            // One applying pass, one broadcast.
            expect(broadcasts.length).toBe(1);

            const shared = [];
            for (const socket of sockets) {
              const states = roomStates(socket);

              // Exactly one payload per socket, and nothing else emitted.
              expect(socket.emitted.length).toBe(1);
              expect(states.length).toBe(1);

              const payload = states[0];

              // Every recipient sees the removal.
              expect(payload.storyQueue.some((entry) => entry.id === targetId)).toBe(false);

              // Per-viewer fields: the facilitator flag and the recipient's own
              // identity.
              expect(payload.youAreModerator).toBe(socket.data.modKey === room.moderatorKey);
              expect(payload.myId).toBe(socket.data.clientId);
              expect(payload.mySocketId).toBe(socket.id);

              shared.push(sharedView(payload));
            }

            // REQ 11.6: story queue, activeStoryId, room.story, and phase are
            // deep-equal across recipients — everything outside the per-viewer
            // fields is.
            for (const view of shared) expect(view).toEqual(shared[0]);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // Feature: clear-revote-finalized-story, Property 38: Persistence round trip preserves a delete
  describe('Property 38: Persistence round trip preserves a delete', () => {
    it('FOR ALL rooms to which a delete has been applied: the restored queue holds no removed id and every survivor comes back character-for-character', async () => {
      // Validates: Requirements 11.9
      await fc.assert(
        fc.asyncProperty(
          arbitraryRoomWithFinalizedStory().chain(({ room, storyId }) =>
            fc.record({
              room: fc.constant(room),
              storyId: fc.constant(storyId),
              restoreOffset: fc.integer({ min: 1, max: 1_000_000 })
            })
          ),
          async ({ room: generated, storyId: targetId, restoreOffset }) => {
            installBroadcastStub();

            const room = seedRoom(generated);
            const socket = facilitatorSocket(room);
            joinedSockets = [socket];

            handleStoryQueueRemove(socket, { roomId: room.roomId, storyId: targetId });
            await flushBroadcast();

            const survivors = structuredClone(room.storyQueue);
            expect(survivors.some((entry) => entry.id === targetId)).toBe(false);
            expect(survivors.length).toBeLessThanOrEqual(100);

            // Serialize in the shape `.rooms-state.json` holds, through JSON,
            // and restore — all in memory, so the real file is never written.
            const snapshot = JSON.stringify([serializeRoomForPersist(room)]);
            const parsed = JSON.parse(snapshot);
            expect(Array.isArray(parsed)).toBe(true);

            const restored = restorePersistedRoom(parsed[0], room.lastActiveAt + restoreOffset);
            expect(restored).not.toBeNull();

            // REQ 11.9: the deleted entry does not come back...
            expect(restored.storyQueue.some((entry) => entry.id === targetId)).toBe(false);

            // ...and each of the 0..100 survivors round trips field for field,
            // in order.
            expect(restored.storyQueue).toEqual(survivors);
            for (let i = 0; i < survivors.length; i++) {
              expect(restored.storyQueue[i].id).toBe(survivors[i].id);
              expect(restored.storyQueue[i].number).toBe(survivors[i].number);
              expect(restored.storyQueue[i].title).toBe(survivors[i].title);
              expect(restored.storyQueue[i].finalPoints).toEqual(survivors[i].finalPoints);
            }

            // The active slot survives the round trip as the delete left it.
            expect(restored.activeStoryId).toBe(room.activeStoryId);
            expect(restored.phase).toBe(room.phase);
            // `room.story` is `null` for a room whose active id matches no entry;
            // the load path defaults that to the Story_Placeholder rather than
            // restoring `null`, so only a non-null story round trips as-is.
            expect(restored.story).toEqual(room.story ?? { ...STORY_PLACEHOLDER });
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Sanity: driving the handler in-process must not touch the persisted file.
  // -------------------------------------------------------------------------

  it('sanity: driving the delete handler in-process writes nothing to disk', async () => {
    const stateFile = process.env.ROOMS_STATE_FILE || path.join(process.cwd(), '.rooms-state.json');
    const before = fs.existsSync(stateFile) ? fs.statSync(stateFile) : null;

    const room = getOrCreateRoom('DISKDEL');
    room.storyQueue = [{ id: 's-1', number: '1', title: 'Disk check', finalPoints: '5' }];
    const socket = facilitatorSocket(room);
    joinedSockets = [socket];

    handleStoryQueueRemove(socket, { roomId: 'DISKDEL', storyId: 's-1' });
    await flushBroadcast();

    expect(roomStates(socket).length).toBe(1);
    expect(room.storyQueue).toEqual([]);

    const after = fs.existsSync(stateFile) ? fs.statSync(stateFile) : null;
    expect(after === null).toBe(before === null);
    if (before && after) {
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.size).toBe(before.size);
    }
  });
});
