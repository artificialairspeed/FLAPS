/**
 * story-revote.js
 *
 * Pure core of the "re-vote a finalized story" transition.
 *
 * A re-vote reverses a finalize: the target queue entry's `finalPoints` is
 * cleared, the entry becomes the active story, the room returns to the
 * `"voting"` phase, and every cast vote is discarded.
 *
 * Everything here is a pure predicate or an in-place reducer over a plain room
 * object. The module deliberately touches no DOM, no `io`, no `rooms` registry,
 * no timers, and no filesystem, so it is importable by the browser as
 * `./story-revote.js` and by `server.js` as `./public/story-revote.js`. Client
 * and server therefore share one definition of "finalized".
 */

/**
 * Rejection reasons returned by {@link validateRevote} and {@link applyRevote}.
 *
 * `NO_ROOM`, `NOT_MODERATOR`, and `NO_STORY` are character-identical to the
 * strings the existing `storyQueue:setActive` handler acks with, so a re-vote
 * rejection reads the same as its sibling.
 *
 * @type {Readonly<{NO_ROOM: string, NOT_MODERATOR: string, NO_STORY: string, NOT_FINALIZED: string, NOT_APPLIED: string}>}
 */
export const REVOTE_REASONS = Object.freeze({
  NO_ROOM: 'Room not found',
  NOT_MODERATOR: 'Not facilitator / moderator',
  NO_STORY: 'Story not found in queue',
  NOT_FINALIZED: 'Story is not finalized',
  NOT_APPLIED: 'Re-vote was not applied'
});

/**
 * True iff `value` is a usable final estimate.
 *
 * `null`, `undefined`, `''`, and whitespace-only strings all count as "not
 * finalized", so a story carrying a blank estimate is pending everywhere:
 * queue partitioning, the card action area, the active-story highlight, and the
 * export summary.
 *
 * @param {unknown} value - Candidate `finalPoints` value.
 * @returns {boolean} `true` when the value is a non-blank final estimate.
 */
export function isFinalizedValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/**
 * Normalize a requested story id to a trimmed string.
 *
 * Absent, `null`, non-string, empty, and whitespace-only ids all collapse to
 * `''`, which matches no queue entry by construction.
 *
 * @param {unknown} storyId - Requested story id, from an untrusted payload.
 * @returns {string} The trimmed id, or `''` when the id is unusable.
 */
export function normalizeStoryId(storyId) {
  return typeof storyId === 'string' ? storyId.trim() : '';
}

/**
 * @typedef {{ id: string, number: string, title: string, finalPoints: string|null }} StoryQueueEntry
 */

/**
 * @typedef {{ ok: true, story: StoryQueueEntry } | { ok: false, reason: string }} RevoteResult
 */

/**
 * Validate a re-vote request without mutating anything.
 *
 * Checks run top to bottom and the first failure is the only one reported:
 * room existence, facilitator authorization, story id validity, story
 * existence, finalized status.
 *
 * @param {object|null|undefined} room - The target room, or a falsy value when no room matched.
 * @param {unknown} storyId - Requested story id, from an untrusted payload.
 * @param {boolean} isFacilitator - Whether the requester is the room's facilitator.
 * @returns {RevoteResult} The matched entry on success, or the rejection reason.
 */
export function validateRevote(room, storyId, isFacilitator) {
  if (!room || typeof room !== 'object') {
    return { ok: false, reason: REVOTE_REASONS.NO_ROOM };
  }
  if (!isFacilitator) {
    return { ok: false, reason: REVOTE_REASONS.NOT_MODERATOR };
  }

  const id = normalizeStoryId(storyId);
  if (!id) {
    return { ok: false, reason: REVOTE_REASONS.NO_STORY };
  }

  const queue = Array.isArray(room.storyQueue) ? room.storyQueue : [];
  const entry = queue.find((s) => s && s.id === id);
  if (!entry) {
    return { ok: false, reason: REVOTE_REASONS.NO_STORY };
  }
  if (!isFinalizedValue(entry.finalPoints)) {
    return { ok: false, reason: REVOTE_REASONS.NOT_FINALIZED };
  }

  return { ok: true, story: entry };
}

/**
 * Apply a re-vote to `room` in place, or report why it was rejected.
 *
 * On acceptance the entry's `finalPoints` becomes `null`, the entry becomes the
 * active story, `room.story` is rewritten to exactly `{ number, title,
 * finalPoints: null }`, `room.phase` becomes `"voting"`, every user record's
 * `vote` becomes `null` (connected or not, with every other field untouched),
 * and `room.lastActiveAt` becomes `now`. The queue's length, order, and every
 * entry's `id`/`number`/`title` are left alone, as is every other entry's
 * `finalPoints`.
 *
 * The transition is all-or-nothing: a pre-mutation snapshot is restored and
 * `NOT_APPLIED` returned if any write throws (a frozen or otherwise hostile
 * room object).
 *
 * A second re-vote of the same story finds `finalPoints === null`, fails the
 * finalized check, and returns `NOT_FINALIZED` without mutating, which is what
 * makes the operation idempotent.
 *
 * @param {object|null|undefined} room - The target room, mutated in place on acceptance.
 * @param {unknown} storyId - Requested story id, from an untrusted payload.
 * @param {{ isFacilitator?: boolean, now?: number }} [options] - Requester role and the request timestamp, captured once per request.
 * @returns {RevoteResult} The re-voted entry on success, or the rejection reason.
 */
export function applyRevote(room, storyId, { isFacilitator, now = Date.now() } = {}) {
  const validation = validateRevote(room, storyId, isFacilitator);
  if (!validation.ok) return validation;

  const entry = validation.story;
  const id = normalizeStoryId(storyId);

  // Snapshot every field the mutation below writes, so a throw mid-transition
  // can be rolled back to the exact pre-request state.
  const snapshot = {
    finalPoints: entry.finalPoints,
    activeStoryId: room.activeStoryId,
    story: room.story,
    phase: room.phase,
    lastActiveAt: room.lastActiveAt,
    votes: []
  };

  try {
    const userIds = room.users && typeof room.users === 'object' ? Object.keys(room.users) : [];
    for (const uid of userIds) {
      const record = room.users[uid];
      if (record && typeof record === 'object') snapshot.votes.push([uid, record.vote]);
    }

    entry.finalPoints = null;
    room.activeStoryId = id;
    room.story = { number: entry.number, title: entry.title, finalPoints: null };
    room.phase = 'voting';
    for (const [uid] of snapshot.votes) room.users[uid].vote = null;
    room.lastActiveAt = now;

    return { ok: true, story: entry };
  } catch (err) {
    restoreSnapshot(room, entry, snapshot);
    return { ok: false, reason: REVOTE_REASONS.NOT_APPLIED };
  }
}

/**
 * Roll `room` back to a snapshot taken by {@link applyRevote}.
 *
 * Restoration is best-effort: a room that refused the forward writes will
 * refuse these too, and in that case there was nothing to undo.
 *
 * @param {object} room - The room to restore.
 * @param {StoryQueueEntry} entry - The queue entry whose `finalPoints` was cleared.
 * @param {{finalPoints: unknown, activeStoryId: unknown, story: unknown, phase: unknown, lastActiveAt: unknown, votes: Array<[string, unknown]>}} snapshot - Pre-mutation values.
 * @returns {void}
 */
function restoreSnapshot(room, entry, snapshot) {
  try {
    entry.finalPoints = snapshot.finalPoints;
  } catch (err) {
    // Nothing was written, so nothing needs undoing.
  }
  try {
    room.activeStoryId = snapshot.activeStoryId;
    room.story = snapshot.story;
    room.phase = snapshot.phase;
    room.lastActiveAt = snapshot.lastActiveAt;
  } catch (err) {
    // Same: a room that rejected the write kept its original values.
  }
  for (const [uid, vote] of snapshot.votes) {
    try {
      room.users[uid].vote = vote;
    } catch (err) {
      // Per-record restore is independent; keep going.
    }
  }
}
