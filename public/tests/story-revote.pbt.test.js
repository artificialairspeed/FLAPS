/**
 * Property-Based Tests — re-vote pure core (`public/story-revote.js`)
 * Spec: clear-revote-finalized-story (Tasks 1.2, 13.4)
 *
 * This file owns the shared fast-check generators for the seven property tests
 * that live here (Properties 8, 10, 11, 12, 19, 20, 21). Task 1.2 contributes
 * the room/queue/user/id generators; task 13.4 widens the operation-sequence
 * generator with `delete` steps, adds the delete-request payload generator, and
 * keeps every generator a named export so `delete-finalized-handler.pbt.test.js`
 * and `public/delete-finalized-ui.pbt.test.js` import them instead of
 * redefining them. The properties themselves land in tasks 1.3–1.6, 5.1–5.3,
 * 14.x, and 15.x. Only generators and their self-checks live here.
 *
 * The generated input space is deliberately wider than the happy path: empty
 * and unicode story text, whitespace-only `finalPoints`, zero-length queues,
 * zero users, `activeStoryId` values that match nothing, non-string story ids,
 * room ids needing trimming, case folding, or the socket fallback, ids already
 * removed earlier in the same sequence, and sequences that empty the queue.
 * Edge cases are covered by the ranges of these generators rather than by
 * dedicated tests.
 *
 * Requirements: 3.5, 4.4, 5.3, 8.8, 10.2, 10.9, 10.10, 10.13, 10.14, 11.13
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isFinalizedValue, normalizeStoryId } from '../story-revote.js';

/** Iterations every property in this file runs at. */
export const NUM_RUNS = 100;

/** Deck values a room is created with (mirrors the server default deck). */
export const ROOM_DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];

/** The point values the finalize control can write (Requirement 8.1). */
export const FINALIZE_POINTS = ['1', '2', '3', '5', '8', '13'];

/** Characters story ids are built from, so every id survives a `trim()`. */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Characters room ids are built from: already normalized, so alnum upper case. */
const ROOM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** `server.js`'s `MAX_ROOM_ID_LENGTH`; every generated room id is far shorter. */
const MAX_ROOM_ID_LENGTH = 50;

/** A small pool of emoji-ish strings for user records. */
const EMOJIS = ['😀', '🎉', '🚀', '🐙', '🦊', ''];

/**
 * Whitespace-only strings: truthy, yet not a finalized value and not a usable
 * story id (Requirements 1.10, 4.4).
 *
 * @returns {fc.Arbitrary<string>} 1–4 whitespace characters.
 */
export function whitespaceString() {
  return fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u2003'), {
      minLength: 1,
      maxLength: 4
    })
    .map((chars) => chars.join(''));
}

/**
 * Free text for a story's `number` / `title`, spanning empty, ASCII, padded,
 * and unicode values.
 *
 * @returns {fc.Arbitrary<string>}
 */
export function storyText() {
  return fc.oneof(
    { weight: 3, arbitrary: fc.string({ maxLength: 24 }) },
    { weight: 1, arbitrary: fc.constant('') },
    {
      weight: 1,
      arbitrary: fc.constantFrom(
        'ストーリー 42',
        'Café ☕ flow',
        '  padded title  ',
        '🚀 launch',
        'Ω-1'
      )
    }
  );
}

/**
 * A story id: non-empty, trimmed, and unique-able.
 *
 * @returns {fc.Arbitrary<string>}
 */
export function storyId() {
  return fc
    .array(fc.constantFrom(...ID_ALPHABET), { minLength: 1, maxLength: 8 })
    .map((chars) => `s-${chars.join('')}`);
}

/**
 * An already-normalized room id, i.e. one `normalizeRoomIdLike` maps to itself.
 * Rooms are keyed in `server.js`'s `rooms` map by exactly such a value, so a
 * generated room id has to be one for the request-payload variants below to be
 * able to hit it.
 *
 * @returns {fc.Arbitrary<string>}
 */
export function normalizedRoomId() {
  return fc
    .array(fc.constantFrom(...ROOM_ID_ALPHABET), { minLength: 4, maxLength: 8 })
    .map((chars) => chars.join(''));
}

/**
 * Mirror of `server.js`'s `normalizeRoomId`: decode, trim, upper-case, clamp.
 * Kept here (rather than imported) because `server.js` does not export it and
 * importing the server for a string function would start its side effects.
 *
 * @param {unknown} roomId - Raw room id from a request payload.
 * @returns {string} The normalized room id, `''` for absent/blank values.
 */
export function normalizeRoomIdLike(roomId) {
  try {
    return decodeURIComponent(String(roomId || ''))
      .trim()
      .toUpperCase()
      .slice(0, MAX_ROOM_ID_LENGTH);
  } catch {
    return String(roomId || '')
      .trim()
      .toUpperCase()
      .slice(0, MAX_ROOM_ID_LENGTH);
  }
}

/**
 * Mirror of the story-id coercion in `handleStoryQueueRemove`:
 * `String(storyId || "")`. Note what it does NOT do — it never trims, so a
 * whitespace-only story id stays whitespace and therefore matches no queue
 * entry rather than collapsing to `''`. `normalizeStoryId` (the re-vote core's
 * stricter predicate) trims; the delete path does not, and the generators below
 * are built against this one.
 *
 * @param {unknown} storyId - Raw story id from a request payload.
 * @returns {string} The coerced story id.
 */
export function coerceStoryId(storyId) {
  return String(storyId || '');
}

/**
 * The room id `handleStoryQueueRemove` resolves a request to:
 * `normalizeRoomId(roomId) || socket.data.roomId`.
 *
 * @param {unknown} payloadRoomId - The request's `roomId` field.
 * @param {string|null|undefined} socketRoomId - The room the socket has joined.
 * @returns {string} The resolved room id, `''` when nothing resolves.
 */
export function resolveRequestRoomId(payloadRoomId, socketRoomId) {
  return normalizeRoomIdLike(payloadRoomId) || socketRoomId || '';
}

/**
 * Padding `String.prototype.trim` is guaranteed to remove, so a padded room id
 * still normalizes back to the room's own id.
 *
 * @returns {fc.Arbitrary<string>}
 */
function roomIdPad() {
  return fc.constantFrom('', ' ', '  ', '\t', '\n', ' \t ');
}

/**
 * A room id that matches no room: normalized in shape, but not `roomId`.
 *
 * @param {string} roomId - The room id to avoid.
 * @returns {fc.Arbitrary<string>}
 */
export function unknownRoomId(roomId) {
  return normalizedRoomId().filter((candidate) => candidate !== roomId);
}

/**
 * The `roomId` field of a request aimed at the room `roomId` identifies: the id
 * itself, the id wrapped in whitespace with random letters lower-cased (both
 * normalize back to it, Requirement 10.2), the three blank forms that fall back
 * to the socket's joined room (Requirement 10.2), and an id matching no room at
 * all (Requirement 10.8).
 *
 * @param {string} roomId - The target room's own (already normalized) id.
 * @returns {fc.Arbitrary<string|null|undefined>}
 */
export function arbitraryRoomIdVariant(roomId) {
  const paddedMixedCase = fc
    .record({
      flips: fc.array(fc.boolean(), { minLength: roomId.length, maxLength: roomId.length }),
      left: roomIdPad(),
      right: roomIdPad()
    })
    .map(
      ({ flips, left, right }) =>
        left +
        [...roomId].map((char, i) => (flips[i] ? char.toLowerCase() : char)).join('') +
        right
    );

  return fc.oneof(
    { weight: 4, arbitrary: fc.constant(roomId) },
    { weight: 3, arbitrary: paddedMixedCase },
    { weight: 1, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: unknownRoomId(roomId) }
  );
}

/**
 * A `finalPoints` value: `null` (pending), a real estimate (finalized), or a
 * whitespace-only string (truthy but NOT finalized).
 *
 * @returns {fc.Arbitrary<string|null>}
 */
export function finalPointsValue() {
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(null) },
    { weight: 2, arbitrary: fc.constantFrom(...FINALIZE_POINTS) },
    { weight: 1, arbitrary: whitespaceString() }
  );
}

/**
 * A single story queue entry.
 *
 * @returns {fc.Arbitrary<{id: string, number: string, title: string, finalPoints: string|null}>}
 */
export function queueEntry() {
  return fc.record({
    id: storyId(),
    number: storyText(),
    title: storyText(),
    finalPoints: finalPointsValue()
  });
}

/**
 * A story queue: 0–20 entries with unique ids.
 *
 * @returns {fc.Arbitrary<Array<{id: string, number: string, title: string, finalPoints: string|null}>>}
 */
export function storyQueue() {
  return fc.uniqueArray(queueEntry(), {
    minLength: 0,
    maxLength: 20,
    selector: (entry) => entry.id
  });
}

/**
 * An `activeStoryId` for `queue`: `null`, an id in the queue, or an id that
 * matches no entry.
 *
 * @param {Array<{id: string}>} queue - The queue the room will carry.
 * @returns {fc.Arbitrary<string|null>}
 */
export function activeStoryIdFor(queue) {
  const ids = queue.map((entry) => entry.id);
  const foreign = storyId().filter((id) => !ids.includes(id));
  if (ids.length === 0) {
    return fc.oneof(fc.constant(null), foreign);
  }
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 3, arbitrary: fc.constantFrom(...ids) },
    { weight: 1, arbitrary: foreign }
  );
}

/**
 * A single user record. `vote` is null or a deck value; `connected` is random,
 * because a re-vote clears the votes of connected and disconnected users alike
 * (Requirements 3.5, 5.3).
 *
 * @returns {fc.Arbitrary<object>}
 */
export function userRecord() {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 12 }),
    emoji: fc.constantFrom(...EMOJIS),
    vote: fc.option(fc.constantFrom(...ROOM_DECK), { nil: null }),
    isModerator: fc.boolean(),
    socketId: fc.string({ minLength: 1, maxLength: 10 }),
    connected: fc.boolean()
  });
}

/**
 * A users map: 0–30 records keyed by distinct client ids.
 *
 * @returns {fc.Arbitrary<Record<string, object>>}
 */
export function usersMap() {
  return fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), userRecord(), {
    minKeys: 0,
    maxKeys: 30
  });
}

/**
 * An in-memory room in the exact shape `server.js` keeps in `rooms`.
 *
 * `room.story` mirrors the active queue entry when `activeStoryId` names one,
 * matching what `handleStoryQueueSetActive` leaves behind; otherwise it is
 * `null` or a free-standing story, as it is for a room whose active story was
 * removed.
 *
 * @returns {fc.Arbitrary<object>}
 */
export function arbitraryRoom() {
  return storyQueue().chain((queue) =>
    fc
      .record({
        roomId: normalizedRoomId(),
        moderatorKey: fc.string({ minLength: 6, maxLength: 12 }),
        phase: fc.constantFrom('voting', 'revealed'),
        activeStoryId: activeStoryIdFor(queue),
        users: usersMap(),
        createdAt: fc.integer({ min: 1, max: 1_000_000 }),
        lastActiveAt: fc.integer({ min: 1, max: 1_000_000 }),
        orphanStory: fc.option(
          fc.record({ number: storyText(), title: storyText(), finalPoints: finalPointsValue() }),
          { nil: null }
        )
      })
      .map((r) => {
        const active = queue.find((entry) => entry.id === r.activeStoryId) || null;
        return {
          roomId: r.roomId,
          moderatorKey: r.moderatorKey,
          deck: [...ROOM_DECK],
          phase: r.phase,
          story: active
            ? { number: active.number, title: active.title, finalPoints: active.finalPoints }
            : r.orphanStory,
          storyQueue: queue.map((entry) => ({ ...entry })),
          activeStoryId: r.activeStoryId,
          users: r.users,
          createdAt: r.createdAt,
          lastActiveAt: r.lastActiveAt
        };
      })
  );
}

/**
 * A room guaranteed to hold at least one finalized entry, paired with the id of
 * one of them — the precondition for an accepted re-vote.
 *
 * @returns {fc.Arbitrary<{room: object, storyId: string}>}
 */
export function arbitraryRoomWithFinalizedStory() {
  return arbitraryRoom()
    .chain((room) =>
      fc.integer({ min: 0, max: Math.max(0, room.storyQueue.length - 1) }).map((index) => {
        // Force the chosen slot finalized so the pair is always accept-eligible,
        // creating the entry when the generated queue was empty.
        const queue = room.storyQueue.length
          ? room.storyQueue.map((entry) => ({ ...entry }))
          : [{ id: 's-seed', number: '1', title: 'seeded story', finalPoints: null }];
        const target = queue[Math.min(index, queue.length - 1)];
        if (!isFinalizedValue(target.finalPoints)) target.finalPoints = FINALIZE_POINTS[0];
        const active = queue.find((entry) => entry.id === room.activeStoryId) || null;
        return {
          room: {
            ...room,
            storyQueue: queue,
            story: active
              ? { number: active.number, title: active.title, finalPoints: active.finalPoints }
              : room.story
          },
          storyId: target.id
        };
      })
    );
}

/**
 * Story ids that must all be treated as matching no queue entry: absent,
 * `null`, empty, whitespace-only, and every non-string type (Requirement 4.4).
 *
 * @returns {fc.Arbitrary<unknown>}
 */
export function arbitraryInvalidStoryId() {
  return fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(''),
    whitespaceString(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.array(storyId(), { maxLength: 3 }),
    // Spread so the record has `Object.prototype`, matching a JSON-derived
    // socket payload: the delete path coerces with `String(storyId || "")`,
    // which throws on a prototype-less object no real request could carry.
    fc.record({ id: storyId() }).map((record) => ({ ...record })),
    fc.constant({})
  );
}

/**
 * A story id shaped like a real one that no entry in `ids` carries.
 *
 * @param {string[]} ids - Story ids present in the room's queue.
 * @returns {fc.Arbitrary<string>}
 */
export function unknownStoryId(ids) {
  return storyId().filter((candidate) => !ids.includes(candidate));
}

/**
 * A 1–20 step finalize / re-vote / delete operation sequence over `ids`, with
 * deliberately invalid steps mixed in so rejected operations are interleaved
 * with accepted ones (Requirement 8.8).
 *
 * `delete` steps are what make the *shrinking* id set of Requirements 10.13 and
 * 10.14 reachable. Each delete draws its `storyId` from the ids still live at
 * that point in the sequence, from the ids an earlier accepted delete already
 * removed, or from the invalid-id generator — so repeat-delete idempotence
 * (Requirement 10.10) and the emptied-queue case (Requirement 11.13) both occur
 * naturally rather than needing dedicated tests.
 *
 * The expected id set is carried forward step by step, starting from the
 * pre-sequence set and subtracting the id of each *accepted* delete only. A
 * delete is accepted when its requester is the facilitator, its room id
 * resolves to the target room, and its coerced story id matches a live entry;
 * a rejected delete contributes nothing to the set (Requirement 10.14, and
 * Requirement 8.8's unchanged-queue clause). `expectedIdsBefore` and
 * `expectedIdsAfter` are arrays, not sets, so a consumer can assert surviving
 * *order* as well as membership.
 *
 * `points` is the value a `finalize` step writes; `revote` and `delete` steps
 * ignore it. `accepted` is `null` on `finalize` and `revote` steps because
 * their acceptance turns on finalized status, which the id set does not depend
 * on — only a delete can change the id set.
 *
 * @param {string[]} ids - Story ids present in the room's queue, in queue order.
 * @param {object} [options] - Room-resolution context for `delete` steps.
 * @param {string|null} [options.roomId] - The target room's own id. When omitted,
 *   `roomId` is left `undefined` on every step and every step is treated as
 *   resolving (the socket-fallback case).
 * @param {string|null} [options.socketRoomId] - The room the requesting socket has
 *   joined; defaults to `options.roomId`.
 * @returns {fc.Arbitrary<Array<object>>}
 */
export function arbitraryOperationSequence(ids, { roomId = null, socketRoomId = roomId } = {}) {
  const targetRoomId = typeof roomId === 'string' ? roomId : null;
  const target = ids.length
    ? fc.oneof(
        { weight: 4, arbitrary: fc.constantFrom(...ids) },
        { weight: 1, arbitrary: arbitraryInvalidStoryId() }
      )
    : arbitraryInvalidStoryId();

  const rawStep = fc.record({
    kind: fc.constantFrom('finalize', 'revote', 'delete'),
    target,
    // Which pool a `delete` step draws its id from. `live` twice so accepted
    // deletes dominate, which is what feeds the `removed` pool.
    pool: fc.constantFrom('live', 'live', 'removed', 'invalid'),
    pick: fc.nat({ max: 63 }),
    invalidId: arbitraryInvalidStoryId(),
    points: fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...FINALIZE_POINTS) },
      { weight: 1, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: whitespaceString() }
    ),
    // Weighted towards the facilitator so the authorization no-op path is
    // reached without starving the accepted path (Requirement 10.7).
    isFacilitator: fc.oneof(
      { weight: 4, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) }
    ),
    roomId: targetRoomId === null ? fc.constant(undefined) : arbitraryRoomIdVariant(targetRoomId)
  });

  return fc.array(rawStep, { minLength: 1, maxLength: 20 }).map((rawSteps) => {
    let live = [...ids];
    const removed = [];

    return rawSteps.map((step) => {
      const expectedIdsBefore = [...live];

      let storyIdValue;
      if (step.kind !== 'delete') {
        storyIdValue = step.target;
      } else if (step.pool === 'live' && live.length) {
        storyIdValue = live[step.pick % live.length];
      } else if (step.pool === 'removed' && removed.length) {
        storyIdValue = removed[step.pick % removed.length];
      } else {
        storyIdValue = step.invalidId;
      }

      const roomResolves =
        targetRoomId === null
          ? true
          : resolveRequestRoomId(step.roomId, socketRoomId) === targetRoomId;
      const coercedId = coerceStoryId(storyIdValue);
      const accepted =
        step.kind === 'delete' && step.isFacilitator && roomResolves && live.includes(coercedId);

      if (accepted) {
        live = live.filter((id) => id !== coercedId);
        removed.push(coercedId);
      }

      return {
        kind: step.kind,
        storyId: storyIdValue,
        points: step.points,
        isFacilitator: step.isFacilitator,
        roomId: step.roomId,
        roomResolves,
        accepted: step.kind === 'delete' ? accepted : null,
        expectedIdsBefore,
        expectedIdsAfter: [...live]
      };
    });
  });
}

/**
 * A room paired with an operation sequence drawn over its own queue ids and its
 * own room id, plus the id set expected once the whole sequence has run.
 *
 * @returns {fc.Arbitrary<{room: object, operations: Array<object>, initialIds: string[], expectedIds: string[]}>}
 */
export function arbitraryRoomWithOperations() {
  return arbitraryRoom().chain((room) => {
    const initialIds = room.storyQueue.map((entry) => entry.id);
    return arbitraryOperationSequence(initialIds, { roomId: room.roomId }).map((operations) => ({
      room,
      operations,
      initialIds,
      expectedIds: operations.length
        ? operations[operations.length - 1].expectedIdsAfter
        : initialIds
    }));
  });
}

/**
 * A `storyQueue:remove` request payload aimed at `room`.
 *
 * `roomId` spans the room's own id, that id with surrounding whitespace and
 * mixed case, the three blank forms that fall back to the socket's joined room,
 * and an id matching no room (Requirements 10.2, 10.8). `storyId` spans live
 * queue ids, ids shaped like real ones that match no entry, and the whole
 * invalid-id range — `undefined`, `null`, `''`, whitespace-only strings,
 * numbers, booleans, arrays, and objects (Requirements 10.9, 10.11).
 *
 * @param {object} room - The target room, as produced by `arbitraryRoom`.
 * @returns {fc.Arbitrary<{roomId: string|null|undefined, storyId: unknown}>}
 */
export function arbitraryDeleteRequest(room) {
  const ids = room.storyQueue.map((entry) => entry.id);
  const storyIdArb = ids.length
    ? fc.oneof(
        { weight: 4, arbitrary: fc.constantFrom(...ids) },
        { weight: 1, arbitrary: unknownStoryId(ids) },
        { weight: 2, arbitrary: arbitraryInvalidStoryId() }
      )
    : fc.oneof(
        { weight: 1, arbitrary: unknownStoryId(ids) },
        { weight: 2, arbitrary: arbitraryInvalidStoryId() }
      );

  return fc.record({
    roomId: arbitraryRoomIdVariant(room.roomId),
    storyId: storyIdArb
  });
}

/**
 * A room paired with one delete request over it and the requester's role, so
 * the authorization no-op path is driven by the same generator as the accepted
 * path (Requirement 10.7).
 *
 * @returns {fc.Arbitrary<{room: object, request: {roomId: string|null|undefined, storyId: unknown}, isFacilitator: boolean}>}
 */
export function arbitraryRoomWithDeleteRequest() {
  return arbitraryRoom().chain((room) =>
    fc
      .record({ request: arbitraryDeleteRequest(room), isFacilitator: fc.boolean() })
      .map(({ request, isFacilitator }) => ({ room, request, isFacilitator }))
  );
}

describe('clear-revote-finalized-story: shared generators (Task 1.2)', () => {
  it('produces well-formed rooms across the whole generated space', () => {
    fc.assert(
      fc.property(arbitraryRoom(), (room) => {
        expect(room.storyQueue.length).toBeLessThanOrEqual(20);
        const ids = room.storyQueue.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const entry of room.storyQueue) {
          expect(normalizeStoryId(entry.id)).toBe(entry.id);
          expect(typeof entry.number).toBe('string');
          expect(typeof entry.title).toBe('string');
          expect(entry.finalPoints === null || typeof entry.finalPoints === 'string').toBe(true);
        }
        expect(['voting', 'revealed']).toContain(room.phase);
        expect(room.activeStoryId === null || typeof room.activeStoryId === 'string').toBe(true);

        const userIds = Object.keys(room.users);
        expect(userIds.length).toBeLessThanOrEqual(30);
        for (const uid of userIds) {
          const record = room.users[uid];
          expect(record.vote === null || typeof record.vote === 'string').toBe(true);
          expect(typeof record.connected).toBe('boolean');
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('produces finalized targets that are present and finalized', () => {
    fc.assert(
      fc.property(arbitraryRoomWithFinalizedStory(), ({ room, storyId: id }) => {
        const entry = room.storyQueue.find((s) => s.id === id);
        expect(entry).toBeTruthy();
        expect(isFinalizedValue(entry.finalPoints)).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('produces invalid story ids that normalize to the empty id', () => {
    fc.assert(
      fc.property(arbitraryInvalidStoryId(), (id) => {
        expect(normalizeStoryId(id)).toBe('');
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('produces 1-20 step operation sequences with a mix of valid and invalid steps', () => {
    fc.assert(
      fc.property(arbitraryRoomWithOperations(), ({ room, operations }) => {
        expect(operations.length).toBeGreaterThanOrEqual(1);
        expect(operations.length).toBeLessThanOrEqual(20);
        const ids = new Set(room.storyQueue.map((entry) => entry.id));
        for (const op of operations) {
          expect(['finalize', 'revote', 'delete']).toContain(op.kind);
          expect(op.points === null || typeof op.points === 'string').toBe(true);
          expect(typeof op.isFacilitator).toBe('boolean');
          // A step either targets a real queue entry or is one of the invalid
          // shapes, which all normalize to the empty id.
          const normalized = normalizeStoryId(op.storyId);
          expect(normalized === '' || ids.has(normalized)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('clear-revote-finalized-story: delete generators (Task 13.4)', () => {
  it('carries the expected id set forward, subtracting accepted deletes only', () => {
    fc.assert(
      fc.property(arbitraryRoomWithOperations(), ({ room, operations, initialIds, expectedIds }) => {
        const originalOrder = room.storyQueue.map((entry) => entry.id);
        expect(initialIds).toEqual(originalOrder);

        let previous = initialIds;
        for (const op of operations) {
          expect(op.expectedIdsBefore).toEqual(previous);

          if (op.kind === 'delete') {
            expect(typeof op.accepted).toBe('boolean');
            const id = coerceStoryId(op.storyId);
            if (op.accepted) {
              // Accepted only when facilitator, room resolves, and the id is live.
              expect(op.isFacilitator).toBe(true);
              expect(op.roomResolves).toBe(true);
              expect(op.expectedIdsBefore).toContain(id);
              expect(op.expectedIdsAfter).not.toContain(id);
              expect(op.expectedIdsAfter.length).toBe(op.expectedIdsBefore.length - 1);
            } else {
              expect(op.expectedIdsAfter).toEqual(op.expectedIdsBefore);
            }
          } else {
            // Finalize and re-vote never change the id set (Requirement 8.8).
            expect(op.accepted).toBeNull();
            expect(op.expectedIdsAfter).toEqual(op.expectedIdsBefore);
          }

          // Survivors keep their relative pre-sequence order (Requirement 10.14).
          expect(op.expectedIdsAfter).toEqual(
            originalOrder.filter((id) => op.expectedIdsAfter.includes(id))
          );
          previous = op.expectedIdsAfter;
        }

        expect(expectedIds).toEqual(previous);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('draws delete ids from live entries, already-removed entries, and invalid values, and reaches an emptied queue', () => {
    // A fixed seed keeps this coverage check deterministic.
    const samples = fc.sample(arbitraryRoomWithOperations(), { numRuns: 400, seed: 1304 });

    let sawLiveDelete = false;
    let sawRepeatDelete = false;
    let sawInvalidDelete = false;
    let sawRejectedDelete = false;
    let sawEmptiedQueue = false;

    for (const { operations, initialIds, expectedIds } of samples) {
      for (const op of operations) {
        if (op.kind !== 'delete') continue;
        const id = coerceStoryId(op.storyId);
        if (op.accepted) sawLiveDelete = true;
        else sawRejectedDelete = true;
        // Already removed earlier in this same sequence.
        if (initialIds.includes(id) && !op.expectedIdsBefore.includes(id)) sawRepeatDelete = true;
        if (!initialIds.includes(id)) sawInvalidDelete = true;
      }
      if (initialIds.length > 0 && expectedIds.length === 0) sawEmptiedQueue = true;
    }

    expect(sawLiveDelete).toBe(true);
    expect(sawRepeatDelete).toBe(true);
    expect(sawInvalidDelete).toBe(true);
    expect(sawRejectedDelete).toBe(true);
    expect(sawEmptiedQueue).toBe(true);
  });

  it('produces delete requests whose room id resolves as the handler would resolve it', () => {
    fc.assert(
      fc.property(arbitraryRoomWithDeleteRequest(), ({ room, request, isFacilitator }) => {
        expect(typeof isFacilitator).toBe('boolean');

        const resolved = resolveRequestRoomId(request.roomId, room.roomId);
        if (
          request.roomId === '' ||
          request.roomId === null ||
          request.roomId === undefined ||
          normalizeRoomIdLike(request.roomId) === room.roomId
        ) {
          // Exact, padded/mixed-case, and blank-with-socket-fallback all resolve.
          expect(resolved).toBe(room.roomId);
        } else {
          // The unknown-room variant, which must not resolve to the target.
          expect(resolved).not.toBe(room.roomId);
          expect(normalizeRoomIdLike(request.roomId)).toBe(resolved);
        }

        // A whitespace-only story id is NOT trimmed by the delete path, so it
        // matches no entry instead of collapsing to the empty id.
        const coerced = coerceStoryId(request.storyId);
        const ids = room.storyQueue.map((entry) => entry.id);
        if (coerced.trim() === '' || !ids.includes(coerced)) {
          expect(room.storyQueue.some((entry) => entry.id === coerced)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('produces delete request room ids spanning every resolution branch', () => {
    const samples = fc.sample(arbitraryRoomWithDeleteRequest(), { numRuns: 400, seed: 1304 });

    const seen = { exact: false, normalized: false, blank: false, unknown: false };
    let sawLiveStoryId = false;
    let sawUnmatchedStoryId = false;

    for (const { room, request } of samples) {
      const raw = request.roomId;
      if (raw === room.roomId) seen.exact = true;
      else if (raw === '' || raw === null || raw === undefined) seen.blank = true;
      else if (normalizeRoomIdLike(raw) === room.roomId) seen.normalized = true;
      else seen.unknown = true;

      const coerced = coerceStoryId(request.storyId);
      if (room.storyQueue.some((entry) => entry.id === coerced)) sawLiveStoryId = true;
      else sawUnmatchedStoryId = true;
    }

    expect(seen.exact).toBe(true);
    expect(seen.normalized).toBe(true);
    expect(seen.blank).toBe(true);
    expect(seen.unknown).toBe(true);
    expect(sawLiveStoryId).toBe(true);
    expect(sawUnmatchedStoryId).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * Properties 8, 10, 11, 12 — the pure re-vote reducer (Tasks 1.3–1.6)
 *
 * These four properties are about `applyRevote` / `validateRevote` only: no
 * socket, no `io`, no timers. `now` is injected on every call so timestamp
 * assertions are exact rather than clock-dependent. `applyRevote` mutates its
 * room in place, so every "unchanged" claim is asserted against a structural
 * clone taken before the call.
 * ------------------------------------------------------------------------- */

import { REVOTE_REASONS, validateRevote, applyRevote } from '../story-revote.js';

/**
 * A structural clone of `room`, taken before a mutating call so "unchanged"
 * claims have something to compare against. Clones are never frozen, even when
 * the source is, which is what makes the frozen-room case comparable.
 *
 * @param {object} room - The room to snapshot.
 * @returns {object} A deep, independent copy.
 */
function snapshotRoom(room) {
  return structuredClone(room);
}

/**
 * Values that are not a room: falsy values and non-objects. Arrays are excluded
 * deliberately — an array is a truthy `object`, so it passes the room-existence
 * check and fails later on an empty queue, which is a different cause.
 *
 * @returns {fc.Arbitrary<unknown>}
 */
function notARoom() {
  return fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(''),
    fc.constant(0),
    fc.constant(NaN),
    fc.boolean(),
    fc.integer(),
    fc.string({ maxLength: 6 })
  );
}

/**
 * A room guaranteed to hold at least one finalized entry and at least one
 * pending entry, so a scenario can target either kind. The two seeded ids
 * contain `-`, which `storyId()`'s alphabet excludes, so they can never collide
 * with a generated id.
 *
 * @returns {fc.Arbitrary<object>}
 */
function roomWithFinalizedAndPendingStories() {
  return arbitraryRoom().map((room) => {
    const queue = room.storyQueue.map((entry) => ({ ...entry }));
    queue.push({ id: 's-seed-final', number: '3', title: 'seeded finalized', finalPoints: '3' });
    queue.push({ id: 's-seed-pending', number: '', title: 'seeded pending', finalPoints: null });
    const active = queue.find((entry) => entry.id === room.activeStoryId) || null;
    return {
      ...room,
      storyQueue: queue,
      story: active
        ? { number: active.number, title: active.title, finalPoints: active.finalPoints }
        : room.story
    };
  });
}

/**
 * One rejection scenario per cause listed in Property 10, including the
 * mutation failure reached with a frozen room.
 *
 * @returns {fc.Arbitrary<{cause: string, room: object, badRoom?: unknown, targetId: unknown, isFacilitator: boolean}>}
 */
function revoteRejectionScenario() {
  return roomWithFinalizedAndPendingStories().chain((room) => {
    const knownIds = room.storyQueue.map((entry) => entry.id);
    const finalizedIds = room.storyQueue
      .filter((entry) => isFinalizedValue(entry.finalPoints))
      .map((entry) => entry.id);
    const pendingIds = room.storyQueue
      .filter((entry) => !isFinalizedValue(entry.finalPoints))
      .map((entry) => entry.id);
    const foreignId = storyId().filter((id) => !knownIds.includes(id));

    return fc
      .oneof(
        fc.record({
          cause: fc.constant('no-room'),
          badRoom: notARoom(),
          targetId: fc.constantFrom(...finalizedIds),
          isFacilitator: fc.boolean()
        }),
        fc.record({
          cause: fc.constant('not-facilitator'),
          targetId: fc.constantFrom(...finalizedIds),
          isFacilitator: fc.constant(false)
        }),
        fc.record({
          cause: fc.constant('invalid-id'),
          targetId: arbitraryInvalidStoryId(),
          isFacilitator: fc.constant(true)
        }),
        fc.record({
          cause: fc.constant('unknown-id'),
          targetId: foreignId,
          isFacilitator: fc.constant(true)
        }),
        fc.record({
          cause: fc.constant('not-finalized'),
          targetId: fc.constantFrom(...pendingIds),
          isFacilitator: fc.constant(true)
        }),
        fc.record({
          cause: fc.constant('mutation-throws'),
          targetId: fc.constantFrom(...finalizedIds),
          isFacilitator: fc.constant(true)
        })
      )
      .map((scenario) => ({ ...scenario, room }));
  });
}

/** The reason each Property 10 cause must report. */
const EXPECTED_REJECTION_REASON = {
  'no-room': REVOTE_REASONS.NO_ROOM,
  'not-facilitator': REVOTE_REASONS.NOT_MODERATOR,
  'invalid-id': REVOTE_REASONS.NO_STORY,
  'unknown-id': REVOTE_REASONS.NO_STORY,
  'not-finalized': REVOTE_REASONS.NOT_FINALIZED,
  'mutation-throws': REVOTE_REASONS.NOT_APPLIED
};

/**
 * A request whose failing checks are chosen independently, so requests failing
 * two or more checks at once occur naturally.
 *
 * @returns {fc.Arbitrary<{room: object, failRoom: boolean, isFacilitator: boolean, idKind: string}>}
 */
function orderedCheckScenario() {
  return roomWithFinalizedAndPendingStories().chain((room) => {
    const knownIds = room.storyQueue.map((entry) => entry.id);
    const finalizedIds = room.storyQueue
      .filter((entry) => isFinalizedValue(entry.finalPoints))
      .map((entry) => entry.id);
    const pendingIds = room.storyQueue
      .filter((entry) => !isFinalizedValue(entry.finalPoints))
      .map((entry) => entry.id);
    const foreignId = storyId().filter((id) => !knownIds.includes(id));

    return fc
      .record({
        failRoom: fc.boolean(),
        isFacilitator: fc.boolean(),
        idChoice: fc.oneof(
          fc.record({ kind: fc.constant('invalid'), id: arbitraryInvalidStoryId() }),
          fc.record({ kind: fc.constant('unknown'), id: foreignId }),
          fc.record({ kind: fc.constant('pending'), id: fc.constantFrom(...pendingIds) }),
          fc.record({ kind: fc.constant('finalized'), id: fc.constantFrom(...finalizedIds) })
        )
      })
      .map((choice) => ({ ...choice, room }));
  });
}

describe('clear-revote-finalized-story: the pure re-vote reducer', () => {
  // Feature: clear-revote-finalized-story, Property 8: The accepted transition clears exactly one estimate and resets the room
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 5.1, 5.2, 5.3, 5.4, 5.5
  it('Property 8: clears exactly one estimate and resets the room', () => {
    fc.assert(
      fc.property(
        arbitraryRoomWithFinalizedStory(),
        fc.nat({ max: 1_000_000 }),
        ({ room, storyId: requestedId }, offset) => {
          // `now` is injected and is >= the prior timestamp, per Requirement 3.9.
          const now = room.lastActiveAt + offset;
          const before = snapshotRoom(room);
          const beforeTarget = before.storyQueue.find((entry) => entry.id === requestedId);
          const clearedValue = beforeTarget.finalPoints;
          const userRefs = Object.fromEntries(
            Object.keys(room.users).map((uid) => [uid, room.users[uid]])
          );

          const result = applyRevote(room, requestedId, { isFacilitator: true, now });

          // REQ 3.11: a facilitator request for a finalized entry is accepted.
          expect(result.ok).toBe(true);

          const target = room.storyQueue.find((entry) => entry.id === requestedId);
          expect(result.story).toBe(target);

          // REQ 3.1, 3.8: that entry's estimate is cleared, no other entry's is.
          expect(target.finalPoints).toBeNull();
          for (const entry of before.storyQueue) {
            if (entry.id === requestedId) continue;
            const after = room.storyQueue.find((s) => s.id === entry.id);
            expect(after.finalPoints).toEqual(entry.finalPoints);
          }

          // REQ 3.2, 5.1, 5.5: the requested id becomes the active story id,
          // whatever it was before.
          expect(room.activeStoryId).toBe(requestedId);

          // REQ 3.3, 5.1: room.story is exactly three mirrored fields.
          expect(Object.keys(room.story).sort()).toEqual(['finalPoints', 'number', 'title']);
          expect(room.story.number).toBe(target.number);
          expect(room.story.title).toBe(target.title);
          expect(room.story.finalPoints).toBeNull();

          // REQ 3.4, 5.2: the room returns to voting.
          expect(room.phase).toBe('voting');

          // REQ 3.5, 5.3: every vote is null, connected or not, and every other
          // field of every record — and the record's identity — is untouched.
          for (const uid of Object.keys(before.users)) {
            expect(room.users[uid]).toBe(userRefs[uid]);
            expect(room.users[uid].vote).toBeNull();
            expect(room.users[uid]).toEqual({ ...before.users[uid], vote: null });
          }
          expect(Object.keys(room.users)).toEqual(Object.keys(before.users));

          // REQ 3.6, 3.7: queue length, order, and every entry's id/number/title
          // survive character-for-character.
          expect(room.storyQueue.length).toBe(before.storyQueue.length);
          expect(room.storyQueue.map((entry) => entry.id)).toEqual(
            before.storyQueue.map((entry) => entry.id)
          );
          room.storyQueue.forEach((entry, index) => {
            expect(entry.number).toBe(before.storyQueue[index].number);
            expect(entry.title).toBe(before.storyQueue[index].title);
          });

          // REQ 5.4: a previously active *different* entry keeps all four fields
          // and its position.
          const priorActiveIndex = before.storyQueue.findIndex(
            (entry) => entry.id === before.activeStoryId
          );
          if (priorActiveIndex >= 0 && before.activeStoryId !== requestedId) {
            expect(room.storyQueue[priorActiveIndex]).toEqual(
              before.storyQueue[priorActiveIndex]
            );
          }

          // REQ 3.8: the cleared value is gone from every field the transition
          // writes. `room.deck` and other entries may legitimately hold an equal
          // string — that is a different story's estimate, not this one's.
          const writtenValues = [
            target.finalPoints,
            room.story.finalPoints,
            ...Object.values(room.users).map((record) => record.vote)
          ];
          for (const value of writtenValues) expect(value).not.toBe(clearedValue);

          // REQ 3.9: lastActiveAt is exactly the injected timestamp, and never
          // moves backwards.
          expect(room.lastActiveAt).toBe(now);
          expect(room.lastActiveAt).toBeGreaterThanOrEqual(before.lastActiveAt);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: clear-revote-finalized-story, Property 10: Rejected and failed requests leave the server exactly as it was
  // Validates: Requirements 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 5.7
  it('Property 10: rejected and failed requests leave the room exactly as it was', () => {
    fc.assert(
      fc.property(
        revoteRejectionScenario(),
        fc.nat({ max: 1_000_000 }),
        ({ cause, room, badRoom, targetId, isFacilitator }, offset) => {
          const target = cause === 'mutation-throws' ? Object.freeze(room) : room;
          const now = room.lastActiveAt + offset;
          const before = snapshotRoom(room);

          // A registry stands in for the server's `rooms` map so Requirement
          // 4.2's "creates no room" clause is observable in the pure core.
          const rooms = new Map([[before.roomId, target]]);
          const requestRoom = cause === 'no-room' ? badRoom : rooms.get(before.roomId);

          const result = applyRevote(requestRoom, targetId, { isFacilitator, now });

          // REQ 4.1, 4.3, 4.4, 4.5, 3.12: one error response naming this cause.
          // A pure return value is delivered to the requesting socket alone by
          // construction — there is no channel here to reach another socket.
          expect(result.ok).toBe(false);
          expect(result.reason).toBe(EXPECTED_REJECTION_REASON[cause]);
          expect(Object.values(REVOTE_REASONS)).toContain(result.reason);

          // REQ 4.2: no room was created for an unmatched room id.
          expect(rooms.size).toBe(1);
          expect([...rooms.keys()]).toEqual([before.roomId]);

          // REQ 4.3, 4.8, 5.7, 3.12: queue entries, activeStoryId, story, phase,
          // every vote, and lastActiveAt are all exactly as they were — the
          // frozen-room case included, which is the snapshot-restore path.
          expect(room).toEqual(before);
          expect(room.storyQueue).toEqual(before.storyQueue);
          expect(room.storyQueue.length).toBe(before.storyQueue.length);
          expect(room.activeStoryId).toEqual(before.activeStoryId);
          expect(room.story).toEqual(before.story);
          expect(room.phase).toBe(before.phase);
          expect(room.lastActiveAt).toBe(before.lastActiveAt);
          for (const uid of Object.keys(before.users)) {
            expect(room.users[uid].vote).toEqual(before.users[uid].vote);
          }

          // REQ 4.8: a rejection carries no accepted story, so the handler
          // wrapping this core has nothing to broadcast.
          expect(result.story).toBeUndefined();
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: clear-revote-finalized-story, Property 11: The first failing check determines the response
  // Validates: Requirements 4.7
  it('Property 11: the first failing check determines the response', () => {
    fc.assert(
      fc.property(
        orderedCheckScenario(),
        fc.nat({ max: 1_000_000 }),
        ({ room, failRoom, isFacilitator, idChoice }, offset) => {
          const requestRoom = failRoom ? undefined : room;
          const requestedId = idChoice.id;
          const normalized = normalizeStoryId(requestedId);
          const entry = failRoom
            ? undefined
            : room.storyQueue.find((s) => normalized !== '' && s.id === normalized);

          // The five checks, evaluated independently of each other.
          const checks = [
            { fails: !requestRoom, reason: REVOTE_REASONS.NO_ROOM },
            { fails: !isFacilitator, reason: REVOTE_REASONS.NOT_MODERATOR },
            { fails: normalized === '', reason: REVOTE_REASONS.NO_STORY },
            { fails: !entry, reason: REVOTE_REASONS.NO_STORY },
            { fails: !entry || !isFinalizedValue(entry.finalPoints), reason: REVOTE_REASONS.NOT_FINALIZED }
          ];
          const failing = checks.filter((check) => check.fails);
          fc.pre(failing.length >= 2);

          const before = snapshotRoom(room);
          const validation = validateRevote(requestRoom, requestedId, isFacilitator);
          const applied = applyRevote(requestRoom, requestedId, {
            isFacilitator,
            now: room.lastActiveAt + offset
          });

          // REQ 4.7: the earliest failing check in the documented order wins.
          expect(validation.ok).toBe(false);
          expect(validation.reason).toBe(failing[0].reason);
          expect(applied.ok).toBe(false);
          expect(applied.reason).toBe(failing[0].reason);
          expect(room).toEqual(before);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: clear-revote-finalized-story, Property 12: Re-vote is idempotent
  // Validates: Requirements 4.6
  it('Property 12: a repeated re-vote leaves the first result standing', () => {
    fc.assert(
      fc.property(
        arbitraryRoomWithFinalizedStory(),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        ({ room, storyId: requestedId }, firstOffset, secondOffset) => {
          const firstNow = room.lastActiveAt + firstOffset;
          const first = applyRevote(room, requestedId, { isFacilitator: true, now: firstNow });
          expect(first.ok).toBe(true);

          const afterFirst = snapshotRoom(room);

          // A different injected timestamp, so an accidental write to
          // lastActiveAt would show up rather than hide behind an equal value.
          const secondNow = firstNow + secondOffset + 1;
          const second = applyRevote(room, requestedId, { isFacilitator: true, now: secondNow });

          // The second request finds a cleared estimate and is rejected as not
          // finalized, without mutating anything.
          expect(second.ok).toBe(false);
          expect(second.reason).toBe(REVOTE_REASONS.NOT_FINALIZED);

          // REQ 4.6: identical in every field except lastActiveAt — and here
          // lastActiveAt is identical too, which is stricter than required.
          const { lastActiveAt: firstStamp, ...firstRest } = afterFirst;
          const { lastActiveAt: secondStamp, ...secondRest } = snapshotRoom(room);
          expect(secondRest).toEqual(firstRest);
          expect(secondStamp).toBe(firstStamp);
          expect(secondStamp).toBe(firstNow);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------------- *
 * Properties 19, 20, 21 — finalize/re-vote round trip and persistence
 * (Tasks 5.1, 5.2, 5.3)
 *
 * This file is the pure-core suite, so nothing below imports `server.js`:
 * importing it would start its side effects and drag `io`, timers, and the
 * filesystem into a suite that deliberately has none of them. The two server
 * behaviours these properties need — the finalize write and the persistence
 * round trip — are therefore modelled locally, faithful to the code they
 * mirror:
 *
 *   - `finalizeQueueEntry` mirrors `handleStoryQueueFinalize`: moderator gate,
 *     `String(storyId || "")`, `String(finalPoints || "").trim()`, the
 *     coffee/question/finite-number check, the deck-membership check, then
 *     `item.finalPoints = points` plus `room.story.finalPoints = points` when
 *     the story is the active one.
 *   - `serializeRoomForPersist` / `restorePersistedRoom` mirror
 *     `serializeRoomsForPersist` and `loadPersistedRooms`, including the users
 *     reduction to `{ name, emoji, vote, isModerator }`, the JSON hop, and the
 *     field defaulting applied on the way back. No filesystem is touched: the
 *     snapshot is a string held in memory.
 * ------------------------------------------------------------------------- */

/**
 * Emoji whitelist mirroring `ALLOWED_EMOJIS` in `server.js`, needed because the
 * restore path sanitizes every stored emoji through it.
 */
const ALLOWED_EMOJIS = new Set([
  '🙂',
  '😀', '😎', '🤓', '🤩', '🥳', '🚀', '🔥', '⭐', '🌈', '🦄',
  '🐱', '🐶', '🦊', '🐼', '🐸', '🦁', '🐧', '🦉', '🐢', '🍕',
  '🎸', '🎉', '🏆'
]);

/**
 * Mirror of `server.js`'s `sanitizeEmoji`.
 *
 * @param {unknown} emoji - Stored emoji value.
 * @returns {string} The emoji when whitelisted, `''` otherwise.
 */
function sanitizeEmojiLike(emoji) {
  const value = String(emoji || '').trim();
  return ALLOWED_EMOJIS.has(value) ? value : '';
}

/**
 * Mirror of `server.js`'s `isFiniteNumberString`.
 *
 * @param {unknown} v - Candidate points value.
 * @returns {boolean} Whether the trimmed string parses as a finite number.
 */
function isFiniteNumberStringLike(v) {
  const n = Number(String(v).trim());
  return Number.isFinite(n);
}

/**
 * The queue-entry write `handleStoryQueueFinalize` performs, with the same
 * validation in the same order and the same moderator gate. Mutates `room` in
 * place on acceptance and reports rejection instead of throwing, so a sequence
 * of mixed valid and invalid steps can be driven through it.
 *
 * @param {object} room - The target room, mutated in place on acceptance.
 * @param {unknown} storyId - Requested story id, from an untrusted payload.
 * @param {unknown} finalPoints - Requested points value, from an untrusted payload.
 * @param {{isFacilitator?: boolean, now?: number|null}} [options] - Requester role and request timestamp.
 * @returns {{ok: true, story: object} | {ok: false, reason: string}}
 */
function finalizeQueueEntry(room, storyId, finalPoints, { isFacilitator = true, now = null } = {}) {
  if (!room || typeof room !== 'object') return { ok: false, reason: 'no-room' };
  if (!isFacilitator) return { ok: false, reason: 'not-facilitator' };

  const id = String(storyId || '');
  const points = String(finalPoints || '').trim();
  if (!id || !points) return { ok: false, reason: 'blank' };
  if (points !== '☕' && points !== '?' && !isFiniteNumberStringLike(points)) {
    return { ok: false, reason: 'not-a-points-value' };
  }
  if (!room.deck.includes(points)) return { ok: false, reason: 'not-in-deck' };

  const item = room.storyQueue.find((s) => s && s.id === id);
  if (!item) return { ok: false, reason: 'no-story' };

  item.finalPoints = points;
  // The handler mirrors the value onto the active story slot; `room.story` is
  // null only for a room whose active id matches no entry, which by definition
  // is not this entry.
  if (room.activeStoryId === id && room.story) room.story.finalPoints = points;
  if (now !== null) room.lastActiveAt = now;

  return { ok: true, story: item };
}

/**
 * One step of a finalize/re-vote sequence, routed the way the two handlers
 * would route it. A step whose room id resolves to some other room leaves this
 * room untouched, which is a rejection from this room's point of view.
 *
 * @param {object} room - The target room, mutated in place on acceptance.
 * @param {{kind: string, storyId: unknown, points: unknown, isFacilitator: boolean, roomResolves: boolean}} op - The operation to apply.
 * @param {number} now - The request timestamp.
 * @returns {{ok: boolean, reason?: string}}
 */
function applySequenceStep(room, op, now) {
  if (!op.roomResolves) return { ok: false, reason: 'other-room' };
  if (op.kind === 'revote') {
    return applyRevote(room, op.storyId, { isFacilitator: op.isFacilitator, now });
  }
  return finalizeQueueEntry(room, op.storyId, op.points, {
    isFacilitator: op.isFacilitator,
    now
  });
}

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
 * The restore `loadPersistedRooms` performs on one parsed entry: room id
 * normalization, per-field defaulting, users rebuilt with sanitized emoji and
 * cleared runtime state, and `lastActiveAt` refreshed to the restore time.
 * Returns `null` for an entry the loader would skip.
 *
 * @param {unknown} saved - One parsed entry from the persisted array.
 * @param {number} now - The restore timestamp.
 * @returns {object|null} The restored room, or `null` when skipped.
 */
function restorePersistedRoom(saved, now) {
  if (!saved || typeof saved.roomId !== 'string') return null;
  const roomId = normalizeRoomIdLike(saved.roomId);
  if (!roomId) return null;

  const users = {};
  if (saved.users && typeof saved.users === 'object') {
    for (const [key, u] of Object.entries(saved.users)) {
      if (!u || typeof u !== 'object') continue;
      users[key] = {
        name: typeof u.name === 'string' ? u.name : '',
        emoji: sanitizeEmojiLike(u.emoji),
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
    story:
      saved.story && typeof saved.story === 'object'
        ? saved.story
        : { number: '', title: 'Add Story to Queue', finalPoints: null },
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

/**
 * A room paired with the id of one of its *pending* entries — the precondition
 * for the finalize that Property 20 starts from. Mirrors
 * `arbitraryRoomWithFinalizedStory`, forcing the chosen slot pending instead.
 *
 * @returns {fc.Arbitrary<{room: object, storyId: string}>}
 */
function arbitraryRoomWithPendingStory() {
  return arbitraryRoom().chain((room) =>
    fc.integer({ min: 0, max: Math.max(0, room.storyQueue.length - 1) }).map((index) => {
      const queue = room.storyQueue.length
        ? room.storyQueue.map((entry) => ({ ...entry }))
        : [{ id: 's-seed-pending', number: '1', title: 'seeded story', finalPoints: null }];
      const target = queue[Math.min(index, queue.length - 1)];
      // A whitespace-only value is already pending (Requirement 1.10); only a
      // real estimate has to be cleared to reach the pre-finalize state.
      if (isFinalizedValue(target.finalPoints)) target.finalPoints = null;
      const active = queue.find((entry) => entry.id === room.activeStoryId) || null;
      return {
        room: {
          ...room,
          storyQueue: queue,
          story: active
            ? { number: active.number, title: active.title, finalPoints: active.finalPoints }
            : room.story
        },
        storyId: target.id
      };
    })
  );
}

describe('clear-revote-finalized-story: finalize/re-vote round trip and persistence', () => {
  // Feature: clear-revote-finalized-story, Property 20: Finalize and re-vote are inverses
  // Validates: Requirements 8.1, 8.2
  it('Property 20: finalize and re-vote are inverses', () => {
    fc.assert(
      fc.property(
        arbitraryRoomWithPendingStory(),
        fc.constantFrom(...FINALIZE_POINTS),
        fc.nat({ max: 1_000_000 }),
        ({ room, storyId: requestedId }, points, offset) => {
          const preFinalize = { ...room.storyQueue.find((entry) => entry.id === requestedId) };

          // Finalize.
          const firstFinalize = finalizeQueueEntry(room, requestedId, points, {
            isFacilitator: true,
            now: room.lastActiveAt
          });
          expect(firstFinalize.ok).toBe(true);
          const afterFirstFinalize = { ...room.storyQueue.find((e) => e.id === requestedId) };
          expect(afterFirstFinalize).toEqual({ ...preFinalize, finalPoints: points });
          expect(isFinalizedValue(afterFirstFinalize.finalPoints)).toBe(true);

          // Re-vote.
          const revote = applyRevote(room, requestedId, {
            isFacilitator: true,
            now: room.lastActiveAt + offset
          });
          expect(revote.ok).toBe(true);

          // REQ 8.1: identity fields survive the round trip character-for-
          // character, and the estimate is cleared.
          const afterRevote = room.storyQueue.find((entry) => entry.id === requestedId);
          expect(afterRevote.id).toBe(preFinalize.id);
          expect(afterRevote.number).toBe(preFinalize.number);
          expect(afterRevote.title).toBe(preFinalize.title);
          expect(afterRevote.finalPoints).toBeNull();
          expect(isFinalizedValue(afterRevote.finalPoints)).toBe(false);

          // REQ 8.2: finalizing again with the same points reproduces the entry
          // the first finalize produced, field for field.
          const secondFinalize = finalizeQueueEntry(room, requestedId, points, {
            isFacilitator: true,
            now: room.lastActiveAt + offset + 1
          });
          expect(secondFinalize.ok).toBe(true);
          expect({ ...room.storyQueue.find((e) => e.id === requestedId) }).toEqual(
            afterFirstFinalize
          );
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: clear-revote-finalized-story, Property 21: Finalize/re-vote sequences preserve the queue
  // Validates: Requirements 8.3, 8.4, 8.7, 8.8
  it('Property 21: finalize/re-vote sequences preserve the queue', () => {
    fc.assert(
      fc.property(arbitraryRoomWithOperations(), ({ room, operations }) => {
        // Property 21 is the finalize/re-vote-only claim: neither operation can
        // add to or remove from the queue, so the id set is FIXED. `delete`
        // steps from the widened generator are skipped here because they
        // shrink that set; Property 32 (a different task, in
        // `delete-finalized-handler.pbt.test.js`) owns the shrinking-id-set
        // claim for mixed finalize / re-vote / delete sequences.
        const steps = operations.filter((op) => op.kind !== 'delete');
        fc.pre(steps.length >= 1);

        const originalIds = room.storyQueue.map((entry) => entry.id);
        const originalIdSet = new Set(originalIds);
        let now = room.lastActiveAt;
        // The queue as it stood when an operation was rejected, so the next
        // accepted operation can be shown to apply to that unchanged queue.
        let queueLeftByRejection = null;

        for (const op of steps) {
          const queueBefore = structuredClone(room.storyQueue);
          now += 1;

          const result = applySequenceStep(room, op, now);
          const idsAfter = room.storyQueue.map((entry) => entry.id);

          // REQ 8.3: length is the pre-sequence length after every operation.
          expect(room.storyQueue.length).toBe(originalIds.length);
          // REQ 8.4: the id set is the pre-sequence set after every operation.
          expect(new Set(idsAfter)).toEqual(originalIdSet);
          // REQ 8.7: relative order is the pre-sequence order after every one.
          expect(idsAfter).toEqual(originalIds);

          if (!result.ok) {
            // REQ 8.8: a rejected operation changes no length, no id, no
            // position, and no entry's finalPoints.
            expect(room.storyQueue).toEqual(queueBefore);
            queueLeftByRejection = queueBefore;
          } else {
            // REQ 8.8: the next accepted operation applies to exactly the queue
            // the rejected one left behind.
            if (queueLeftByRejection) {
              expect(queueBefore).toEqual(queueLeftByRejection);
              queueLeftByRejection = null;
            }
            const target = room.storyQueue.find(
              (entry) => entry.id === String(op.storyId || '').trim()
            );
            expect(target).toBeTruthy();
            expect(target.finalPoints).toEqual(op.kind === 'revote' ? null : op.points);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: clear-revote-finalized-story, Property 19: Persistence round trip preserves the re-voted story
  // Validates: Requirements 7.7
  it('Property 19: a persistence round trip preserves the re-voted story', () => {
    fc.assert(
      fc.property(
        arbitraryRoomWithFinalizedStory(),
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        ({ room, storyId: requestedId }, offset, restoreOffset) => {
          const revote = applyRevote(room, requestedId, {
            isFacilitator: true,
            now: room.lastActiveAt + offset
          });
          expect(revote.ok).toBe(true);

          const entryBefore = { ...room.storyQueue.find((e) => e.id === requestedId) };

          // Serialize in the shape `.rooms-state.json` holds, through JSON, and
          // restore — all in memory, no filesystem.
          const snapshot = JSON.stringify([serializeRoomForPersist(room)]);
          const parsed = JSON.parse(snapshot);
          expect(Array.isArray(parsed)).toBe(true);
          const restored = restorePersistedRoom(parsed[0], room.lastActiveAt + restoreOffset);
          expect(restored).not.toBeNull();

          // REQ 7.7: the re-voted story comes back pending...
          const entryAfter = restored.storyQueue.find((entry) => entry.id === requestedId);
          expect(entryAfter).toBeTruthy();
          expect(entryAfter.finalPoints).toBeNull();
          expect(isFinalizedValue(entryAfter.finalPoints)).toBe(false);

          // ...and as the active story, with the room back in voting.
          expect(restored.activeStoryId).toBe(requestedId);
          expect(restored.phase).toBe('voting');
          expect(restored.story.number).toBe(entryBefore.number);
          expect(restored.story.title).toBe(entryBefore.title);
          expect(restored.story.finalPoints).toBeNull();

          // ...with identity fields character-for-character unchanged.
          expect(entryAfter.id).toBe(entryBefore.id);
          expect(entryAfter.number).toBe(entryBefore.number);
          expect(entryAfter.title).toBe(entryBefore.title);

          // The rest of the queue survives the round trip untouched.
          expect(restored.storyQueue).toEqual(room.storyQueue);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
