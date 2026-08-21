/**
 * Property-based tests for the re-vote SERVER handler.
 * Spec: clear-revote-finalized-story
 *
 * Covers two properties from design.md:
 *   Property 9  — One broadcast, sent after every state change, identical for
 *                 every recipient (Requirements 3.10, 5.6, 7.1)
 *   Property 18 — A failing delivery does not roll back state or starve other
 *                 sockets (Requirements 7.5, 7.6)
 *
 * Both drive the real `handleStoryQueueRevote` from `server.js` with the
 * `makeSocket` fake-socket pattern established in `server.exploration.test.js`:
 * no network, no real `io`. `io.in(roomId).fetchSockets()` is replaced with a
 * counting stub so "exactly one broadcast" is assertable and so the room state
 * observed at broadcast time can be snapshotted.
 *
 * Importing `server.js` does not enable persistence (it is armed only by the
 * live entry point), so nothing here touches the filesystem — pinned by the
 * final sanity test in this file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import { io, rooms, getOrCreateRoom, handleStoryQueueRevote } from '../../server.js';

// ---------------------------------------------------------------------------
// Fake socket (the `makeSocket` pattern from server.exploration.test.js, with
// per-emit recording and an optional throwing delivery for Property 18).
// ---------------------------------------------------------------------------

/**
 * Minimal fake Socket.IO socket good enough to receive `room:state`.
 * Payloads are deep-cloned on arrival: `makeRoomState` hands out live
 * references to `room.storyQueue` / `room.story`, so a clone is what pins the
 * state as it was at delivery time.
 */
function makeSocket(id, data = {}, { failEmit = false } = {}) {
  const emitted = [];
  return {
    id,
    data: { ...data },
    joinedRooms: new Set(),
    emitAttempts: 0,
    join(roomId) {
      this.joinedRooms.add(roomId);
    },
    leave(roomId) {
      this.joinedRooms.delete(roomId);
    },
    emit(event, payload) {
      this.emitAttempts += 1;
      if (failEmit) throw new Error(`delivery failed for ${id}`);
      emitted.push({ event, payload: structuredClone(payload) });
    },
    emitted
  };
}

/** Payloads a socket received for `room:state`. */
function roomStates(socket) {
  return socket.emitted.filter((e) => e.event === 'room:state').map((e) => e.payload);
}

/** Fields of a `room:state` payload that must be identical for every recipient. */
function sharedView(payload) {
  const { youAreModerator, myId, mySocketId, ...shared } = payload;
  return shared;
}

/** Let the async `broadcastRoom` run to completion. */
function flushBroadcast() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Broadcast stub: counts broadcasts and snapshots the room at broadcast time.
// ---------------------------------------------------------------------------

/** @type {Array<{ roomId: string, state: object }>} */
let broadcasts = [];
/** @type {object[]} */
let joinedSockets = [];

beforeEach(() => {
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
              phase: room.phase
            })
          : null
      });
      return joinedSockets;
    }
  });
});

afterEach(() => {
  delete io.in; // restore the real Server.prototype.in
  rooms.clear();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const FINALIZE_POINTS = ['0.5', '1', '2', '3', '5', '8', '13', '21'];
const ROOM_DECK_VOTES = ['?', '1', '3', '5', '8', '13', '☕'];

const whitespaceValue = () => fc.constantFrom(' ', '  ', '\t', '\n', '\u00a0 ');

/** `finalPoints` including the blank-but-truthy values Requirement 1.10 cares about. */
const finalPointsArb = () =>
  fc.oneof(
    { weight: 2, arbitrary: fc.constant(null) },
    { weight: 2, arbitrary: fc.constantFrom(...FINALIZE_POINTS) },
    { weight: 1, arbitrary: whitespaceValue() }
  );

/** Story `number` / `title`: empty, ascii, and unicode all occur. */
const storyText = () =>
  fc.oneof(
    { weight: 3, arbitrary: fc.string({ maxLength: 20 }) },
    { weight: 1, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: fc.constantFrom('ストーリー 42', 'Café ☕', 'ünïcødé — title') }
  );

const storyIdArb = () => fc.integer({ min: 0, max: 99999 }).map((n) => `s-${n}`);
const userKeyArb = () => fc.integer({ min: 0, max: 9999 }).map((n) => `client-${n}`);

/**
 * A room with a guaranteed-finalized target entry plus 1..maxSockets joined
 * sockets. Socket 0 is the requesting facilitator; the rest hold the moderator
 * key or not, so the per-viewer flag varies across recipients.
 */
function scenarioArb({ minSockets, maxSockets }) {
  return fc
    .uniqueArray(storyIdArb(), { minLength: 1, maxLength: 8 })
    .chain((ids) =>
      fc.record({
        roomId: fc.constantFrom('ROOMA', 'ROOMB', 'ROOM42'),
        entries: fc.tuple(
          ...ids.map((id) =>
            fc.record({
              id: fc.constant(id),
              number: storyText(),
              title: storyText(),
              finalPoints: finalPointsArb()
            })
          )
        ),
        targetIndex: fc.nat({ max: ids.length - 1 }),
        targetPoints: fc.constantFrom(...FINALIZE_POINTS),
        // Prior active story: none, some queue entry (possibly the target), or
        // an id matching no entry.
        priorActive: fc.oneof(
          { weight: 1, arbitrary: fc.constant(null) },
          { weight: 3, arbitrary: fc.nat({ max: ids.length - 1 }) },
          { weight: 1, arbitrary: fc.constant('s-not-in-queue') }
        ),
        priorActivePoints: fc.oneof(fc.constant(null), fc.constantFrom(...FINALIZE_POINTS)),
        phase: fc.constantFrom('voting', 'revealed'),
        users: fc.uniqueArray(
          fc.record({
            key: userKeyArb(),
            name: fc.string({ minLength: 1, maxLength: 10 }),
            vote: fc.option(fc.constantFrom(...ROOM_DECK_VOTES), { nil: null }),
            isModerator: fc.boolean(),
            connected: fc.boolean()
          }),
          { maxLength: 6, selector: (u) => u.key }
        ),
        viewers: fc.array(fc.boolean(), { minLength: minSockets, maxLength: maxSockets })
      })
    );
}

/**
 * Seed `rooms` from a generated scenario and return everything the assertions
 * need. `room.story` is mirrored off the active entry exactly as the real
 * setActive / finalize paths leave it.
 */
function seedScenario(scenario) {
  const { roomId, entries, targetIndex, targetPoints, priorActive, priorActivePoints, phase, users, viewers } =
    scenario;

  const room = getOrCreateRoom(roomId);
  room.storyQueue = entries.map((e) => ({ ...e }));

  // The target must be finalized for the re-vote to be accepted.
  const target = room.storyQueue[targetIndex];
  target.finalPoints = targetPoints;

  // Resolve the prior active story.
  let activeStoryId = null;
  if (typeof priorActive === 'number') activeStoryId = room.storyQueue[priorActive].id;
  else if (typeof priorActive === 'string') activeStoryId = priorActive;
  room.activeStoryId = activeStoryId;

  const priorEntry = room.storyQueue.find((s) => s.id === activeStoryId) || null;
  if (priorEntry && priorEntry !== target) priorEntry.finalPoints = priorActivePoints;

  room.phase = phase;
  room.story = priorEntry
    ? { number: priorEntry.number, title: priorEntry.title, finalPoints: priorEntry.finalPoints }
    : { number: '', title: 'Add Story to Queue', finalPoints: null };

  room.users = {};
  for (const u of users) {
    room.users[u.key] = {
      name: u.name,
      emoji: '',
      vote: u.vote,
      isModerator: u.isModerator,
      connected: u.connected
    };
  }

  return {
    room,
    roomId: room.roomId,
    target,
    priorEntry,
    priorFinalPoints: priorEntry ? priorEntry.finalPoints : null,
    viewers
  };
}

/** Build the joined sockets: index 0 is the requesting facilitator. */
function makeViewerSockets(room, viewers, { failIndex = -1 } = {}) {
  return viewers.map((holdsModKey, i) =>
    makeSocket(
      `sock-${i}`,
      {
        clientId: `client-sock-${i}`,
        roomId: room.roomId,
        // Socket 0 is the requester and must be the facilitator.
        modKey: i === 0 || holdsModKey ? room.moderatorKey : 'WRONG-KEY'
      },
      { failEmit: i === failIndex }
    )
  );
}

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

// Feature: clear-revote-finalized-story, Property 9: One broadcast, sent after every state change, identical for every recipient
describe('Property 9: One broadcast, sent after every state change, identical for every recipient', () => {
  it('FOR ALL rooms with 1..10 joined sockets: an accepted re-vote broadcasts exactly once, after the transition, identically to every recipient', async () => {
    // Validates: Requirements 3.10, 5.6, 7.1
    await fc.assert(
      fc.asyncProperty(scenarioArb({ minSockets: 1, maxSockets: 10 }), async (scenario) => {
        rooms.clear();
        broadcasts = [];

        const { room, roomId, target, priorEntry, priorFinalPoints, viewers } = seedScenario(scenario);
        const sockets = makeViewerSockets(room, viewers);
        joinedSockets = sockets;

        const acks = [];
        handleStoryQueueRevote(sockets[0], { roomId, storyId: target.id }, (res) => acks.push(res));
        await flushBroadcast();

        // The request was accepted, and answered on the requesting socket only.
        expect(acks).toEqual([{ ok: true }]);

        // Exactly one broadcast, for this room.
        expect(broadcasts.length).toBe(1);
        expect(broadcasts[0].roomId).toBe(roomId);

        // ...issued after every state change had been applied: the room as it
        // stood when the broadcast was issued already carries the transition.
        const atBroadcast = broadcasts[0].state;
        expect(atBroadcast.activeStoryId).toBe(target.id);
        expect(atBroadcast.phase).toBe('voting');
        expect(atBroadcast.storyQueue.find((s) => s.id === target.id).finalPoints).toBe(null);
        expect(atBroadcast.story).toEqual({ number: target.number, title: target.title, finalPoints: null });

        const shared = [];
        for (let i = 0; i < sockets.length; i++) {
          const socket = sockets[i];
          const states = roomStates(socket);

          // Exactly one broadcast per recipient, and nothing else emitted.
          expect(socket.emitted.length).toBe(1);
          expect(states.length).toBe(1);

          const payload = states[0];

          // The requested story is the active story with a cleared estimate.
          expect(payload.activeStoryId).toBe(target.id);
          expect(payload.story).toEqual({ number: target.number, title: target.title, finalPoints: null });
          expect(Object.keys(payload.story).sort()).toEqual(['finalPoints', 'number', 'title']);
          expect(payload.storyQueue.find((s) => s.id === target.id).finalPoints).toBe(null);

          // The previously active story keeps its own final estimate.
          if (priorEntry && priorEntry.id !== target.id) {
            expect(payload.storyQueue.find((s) => s.id === priorEntry.id).finalPoints).toEqual(priorFinalPoints);
          }

          // Voting is reopened and every vote is cleared.
          expect(payload.phase).toBe('voting');
          for (const user of Object.values(payload.users)) expect(user.vote).toBe(null);

          // Per-viewer fields: the facilitator flag and the recipient's own identity.
          expect(payload.youAreModerator).toBe(socket.data.modKey === room.moderatorKey);
          expect(payload.myId).toBe(socket.data.clientId);
          expect(payload.mySocketId).toBe(socket.id);

          shared.push(sharedView(payload));
        }

        // Everything else — story queue, activeStoryId, story, phase included —
        // is deep-equal across all recipients.
        for (const view of shared) expect(view).toEqual(shared[0]);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18
// ---------------------------------------------------------------------------

// Feature: clear-revote-finalized-story, Property 18: A failing delivery does not roll back state or starve other sockets
describe('Property 18: A failing delivery does not roll back state or starve other sockets', () => {
  beforeEach(() => {
    // broadcastRoom logs each failed delivery; keep the suite output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FOR ALL rooms with 2..10 joined sockets and any one failing delivery: applied state stands and every other socket still receives it once', async () => {
    // Validates: Requirements 7.5, 7.6
    await fc.assert(
      fc.asyncProperty(
        scenarioArb({ minSockets: 2, maxSockets: 10 }).chain((scenario) =>
          fc.record({
            scenario: fc.constant(scenario),
            failIndex: fc.nat({ max: scenario.viewers.length - 1 })
          })
        ),
        async ({ scenario, failIndex }) => {
          rooms.clear();
          broadcasts = [];

          const { room, roomId, target, viewers } = seedScenario(scenario);
          const sockets = makeViewerSockets(room, viewers, { failIndex });
          joinedSockets = sockets;

          handleStoryQueueRevote(sockets[0], { roomId, storyId: target.id }, () => {});

          // The transition is applied synchronously, before any delivery is
          // attempted. This is the state a failing delivery must not undo.
          const applied = {
            finalPoints: target.finalPoints,
            activeStoryId: room.activeStoryId,
            phase: room.phase
          };
          expect(applied).toEqual({ finalPoints: null, activeStoryId: target.id, phase: 'voting' });

          await flushBroadcast();

          // No rollback after the failed delivery.
          expect(room.storyQueue.find((s) => s.id === target.id).finalPoints).toBe(applied.finalPoints);
          expect(room.activeStoryId).toBe(applied.activeStoryId);
          expect(room.phase).toBe(applied.phase);

          // The failing socket was attempted exactly once and received nothing.
          expect(sockets[failIndex].emitAttempts).toBe(1);
          expect(sockets[failIndex].emitted.length).toBe(0);

          // Every remaining socket received exactly one broadcast of that state.
          for (let i = 0; i < sockets.length; i++) {
            if (i === failIndex) continue;
            const states = roomStates(sockets[i]);
            expect(states.length).toBe(1);
            expect(states[0].activeStoryId).toBe(applied.activeStoryId);
            expect(states[0].phase).toBe(applied.phase);
            expect(states[0].storyQueue.find((s) => s.id === target.id).finalPoints).toBe(applied.finalPoints);
          }

          // Still one broadcast, not one retry per failure.
          expect(broadcasts.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity: importing server.js must not arm persistence.
// ---------------------------------------------------------------------------

describe('sanity: driving the handler in-process writes nothing to disk', () => {
  it('leaves the persisted room-state file untouched', async () => {
    const stateFile = process.env.ROOMS_STATE_FILE || path.join(process.cwd(), '.rooms-state.json');
    const before = fs.existsSync(stateFile) ? fs.statSync(stateFile) : null;

    const room = getOrCreateRoom('DISKCHK');
    room.storyQueue = [{ id: 's-1', number: '1', title: 'Disk check', finalPoints: '5' }];
    const socket = makeSocket('sock-disk', { clientId: 'c-disk', roomId: room.roomId, modKey: room.moderatorKey });
    joinedSockets = [socket];

    handleStoryQueueRevote(socket, { roomId: 'DISKCHK', storyId: 's-1' }, () => {});
    await flushBroadcast();

    expect(roomStates(socket).length).toBe(1);

    const after = fs.existsSync(stateFile) ? fs.statSync(stateFile) : null;
    expect(after === null).toBe(before === null);
    if (before && after) {
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.size).toBe(before.size);
    }
  });
});
