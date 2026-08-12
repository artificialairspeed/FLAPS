/**
 * Integration Tests — Deleting a Finalized Story
 * Spec: clear-revote-finalized-story (Tasks 16.2, 16.3)
 *
 * Concrete end-to-end examples, not property tests. They drive the real
 * exported server handlers through a whole flow — create room, queue stories,
 * vote, finalize, delete — and assert on the actual `room:state` payloads
 * `broadcastRoom` delivers, using the `makeSocket` fake-socket harness from
 * `server.exploration.test.js` (as `revote-integration.test.js` does).
 *
 * `io.in(roomId).fetchSockets()` is replaced with a stub returning the fake
 * sockets that have "joined" that room, so the payloads asserted here are the
 * ones `makeRoomState` actually produces per recipient. No network, no real
 * Socket.IO transport.
 *
 * Covered:
 *  - 16.2 Finalize a story, delete it through the finalized-card path, assert
 *    the resulting `room:state` omits it; then delete the SAME id again and
 *    assert one further broadcast carrying the unchanged queue.
 *    _Requirements: 10.1, 10.10_
 *  - 16.2 Delete a finalized story that is ALSO the active story, pinning the
 *    Story_Placeholder's literal title, `activeStoryId === null`,
 *    `phase === 'voting'`, and cleared votes in the broadcast payload.
 *    _Requirements: 10.3_
 *  - 16.3 Debounced persistence: against a TEMP state file, a delete reaches
 *    disk as a queue without that entry, with the updated `activeStoryId`.
 *    _Requirements: 11.8_
 *  - 16.3 After a delete, a newly joining facilitator and a newly joining
 *    participant each receive a queue with no entry carrying the removed id.
 *    _Requirements: 11.10_
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  vi
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  io,
  rooms,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleVoteReveal,
  handleStoryQueueSetActive,
  handleStoryQueueFinalize,
  handleStoryQueueRemove
} from './server.js';

const ROOM = 'DELINT1';

/** The Story_Placeholder the server writes when no story is active. */
const PLACEHOLDER_TITLE = 'Add Story to Queue';

// ---------------------------------------------------------------------------
// Fake socket harness (the `makeSocket` pattern from server.exploration.test.js)
// ---------------------------------------------------------------------------

/**
 * Minimal fake Socket.IO server socket: records the rooms it joined and every
 * event delivered to it. Payloads are deep-cloned on arrival because
 * `makeRoomState` hands out live references to `room.storyQueue` / `room.story`.
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

/** Sockets the `io.in` stub considers connected. */
let pool = [];

/** Add a fake socket to the connected pool so broadcasts can reach it. */
function register(socket) {
  pool.push(socket);
  return socket;
}

/** The `room:state` payloads a socket received, oldest first. */
function roomStates(socket) {
  return socket.emitted.filter((e) => e.event === 'room:state').map((e) => e.payload);
}

/** The most recent `room:state` payload a socket received. */
function lastRoomState(socket) {
  const states = roomStates(socket);
  return states[states.length - 1];
}

/** The part of a `room:state` payload that must be identical for every recipient. */
function sharedView(payload) {
  const { youAreModerator, myId, mySocketId, ...shared } = payload;
  return shared;
}

/** Let the async `broadcastRoom` run to completion. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A comparable projection of a queue: every field Requirement 10.1 pins. */
function queueShape(storyQueue) {
  return storyQueue.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    finalPoints: s.finalPoints
  }));
}

beforeEach(() => {
  rooms.clear();
  pool = [];
  io.in = (roomId) => ({
    fetchSockets: async () => pool.filter((s) => s.joinedRooms.has(roomId))
  });
});

afterEach(() => {
  delete io.in; // restore the real Server.prototype.in
  rooms.clear();
  pool = [];
});

/**
 * Drive the normal estimation flow up to two finalized stories and one pending
 * one: facilitator creates the room, a participant joins, three stories are
 * queued, A is made active, both users vote, votes are revealed, A is finalized
 * at 5 and B at 8. C is left pending. After this, `activeStoryId` is still A —
 * finalize does not move the active slot — so the caller decides whether the
 * story it deletes is the active one.
 */
async function seedFinalizedStories() {
  const facilitator = register(makeSocket('sock-fac', { clientId: 'client-fac' }));
  handleRoomCreate(facilitator, { desiredRoomId: ROOM, name: 'Mod', clientId: 'client-fac' });
  await flush();

  const participant = register(makeSocket('sock-p1', { clientId: 'client-p1' }));
  handleRoomJoin(participant, { roomId: ROOM, name: 'Ada', clientId: 'client-p1' });
  await flush();

  // `storyQueue:add` is not part of server.js's test exports, so the queue is
  // seeded directly — the same convention revote-integration.test.js uses.
  // Everything after this point goes through the real handlers.
  const room = rooms.get(ROOM);
  const storyAId = 'story-a';
  const storyBId = 'story-b';
  const storyCId = 'story-c';
  room.storyQueue.push(
    { id: storyAId, number: 'JIRA-1', title: 'Login flow', finalPoints: null },
    { id: storyBId, number: 'JIRA-2', title: 'Signup flow', finalPoints: null },
    { id: storyCId, number: 'JIRA-3', title: 'Reset password', finalPoints: null }
  );

  handleStoryQueueSetActive(facilitator, { roomId: ROOM, storyId: storyAId });
  handleVoteSet(facilitator, { roomId: ROOM, vote: '5' });
  handleVoteSet(participant, { roomId: ROOM, vote: '8' });
  handleVoteReveal(facilitator, { roomId: ROOM });
  handleStoryQueueFinalize(facilitator, { roomId: ROOM, storyId: storyAId, finalPoints: '5' });
  handleStoryQueueFinalize(facilitator, { roomId: ROOM, storyId: storyBId, finalPoints: '8' });
  await flush();

  return { room, facilitator, participant, storyAId, storyBId, storyCId };
}

// ---------------------------------------------------------------------------
// 16.2 — Delete a finalized story that is not the active story, then repeat it
// ---------------------------------------------------------------------------

describe('Integration: finalize then delete through the real handler', () => {
  it('deleting a finalized story broadcasts a queue without it, and a repeat delete of the same id broadcasts once more with that queue unchanged (10.1, 10.10)', async () => {
    const { room, facilitator, participant, storyAId, storyBId, storyCId } =
      await seedFinalizedStories();

    // Move the active slot off B so this delete exercises the non-active path;
    // B (finalized at 8) is the story the finalized card's ❌ removes.
    handleStoryQueueSetActive(facilitator, { roomId: ROOM, storyId: storyCId });
    await flush();

    // Precondition: B really is a Finalized_Story, and it is not the active one.
    expect(room.storyQueue.find((s) => s.id === storyBId).finalPoints).toBe('8');
    expect(room.activeStoryId).toBe(storyCId);

    const beforeShape = queueShape(room.storyQueue);
    const facBefore = roomStates(facilitator).length;
    const partBefore = roomStates(participant).length;
    const activeBefore = room.activeStoryId;
    const storyBeforeDelete = structuredClone(room.story);
    const phaseBefore = room.phase;
    const lastActiveBefore = room.lastActiveAt;

    // The finalized card's Delete_Control emits exactly this: the same event
    // name and the same two payload fields as the pending card's (Req 9.5).
    handleStoryQueueRemove(facilitator, { roomId: ROOM, storyId: storyBId });
    await flush();

    // 10.6: exactly one broadcast, delivered to every socket in the room.
    expect(roomStates(facilitator).length).toBe(facBefore + 1);
    expect(roomStates(participant).length).toBe(partBefore + 1);

    const afterFirst = lastRoomState(facilitator);

    // 10.1 / 10.11: exactly that entry is gone, length down by one, and every
    // surviving entry keeps its id, number, title, and finalPoints, in order.
    expect(afterFirst.storyQueue.some((s) => s.id === storyBId)).toBe(false);
    expect(afterFirst.storyQueue.length).toBe(beforeShape.length - 1);
    expect(queueShape(afterFirst.storyQueue)).toEqual(
      beforeShape.filter((s) => s.id !== storyBId)
    );
    expect(afterFirst.storyQueue.map((s) => s.id)).toEqual([storyAId, storyCId]);
    expect(afterFirst.storyQueue.find((s) => s.id === storyAId).finalPoints).toBe('5');

    // 10.4: the deleted story was not the active one, so the active slot, the
    // mirrored story, the phase, and every vote are untouched.
    expect(afterFirst.activeStoryId).toBe(activeBefore);
    expect(afterFirst.story).toEqual(storyBeforeDelete);
    expect(afterFirst.phase).toBe(phaseBefore);

    // 10.5: lastActiveAt advanced.
    expect(room.lastActiveAt).toBeGreaterThanOrEqual(lastActiveBefore);

    // Every recipient saw the same queue/story/phase view.
    expect(sharedView(lastRoomState(participant))).toEqual(sharedView(afterFirst));
    expect(afterFirst.youAreModerator).toBe(true);
    expect(lastRoomState(participant).youAreModerator).toBe(false);

    // --- 10.10: the repeat delete is the unmatched-id path, which still broadcasts.
    const facAfterFirst = roomStates(facilitator).length;
    const partAfterFirst = roomStates(participant).length;
    const activeAfterFirst = afterFirst.activeStoryId;
    const storyAfterFirst = structuredClone(afterFirst.story);
    const votesAfterFirst = Object.fromEntries(
      Object.entries(afterFirst.users).map(([uid, u]) => [uid, u.vote])
    );
    const lastActiveAfterFirst = room.lastActiveAt;

    handleStoryQueueRemove(facilitator, { roomId: ROOM, storyId: storyBId });
    await flush();

    // Exactly ONE further broadcast per socket — not zero, not two.
    expect(roomStates(facilitator).length).toBe(facAfterFirst + 1);
    expect(roomStates(participant).length).toBe(partAfterFirst + 1);

    const afterSecond = lastRoomState(facilitator);

    // The queue it carries is identical in length, order, and every field.
    expect(queueShape(afterSecond.storyQueue)).toEqual(queueShape(afterFirst.storyQueue));
    expect(afterSecond.activeStoryId).toBe(activeAfterFirst);
    expect(afterSecond.story).toEqual(storyAfterFirst);
    expect(afterSecond.phase).toBe(afterFirst.phase);
    expect(
      Object.fromEntries(Object.entries(afterSecond.users).map(([uid, u]) => [uid, u.vote]))
    ).toEqual(votesAfterFirst);

    // 10.9: lastActiveAt still advances on the unmatched-id path.
    expect(room.lastActiveAt).toBeGreaterThanOrEqual(lastActiveAfterFirst);

    // No acknowledgement and no error response accompanies either delete.
    const acks = facilitator.emitted.filter((e) => e.event !== 'room:state');
    expect(acks.some((e) => e.event === 'error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 16.2 — Delete a finalized story that is ALSO the active story
// ---------------------------------------------------------------------------

describe('Integration: deleting a finalized story that is also the active story', () => {
  it('broadcasts the Story_Placeholder, activeStoryId null, phase "voting", and cleared votes (10.3)', async () => {
    const { room, facilitator, participant, storyAId, storyBId, storyCId } =
      await seedFinalizedStories();

    // A is finalized at 5 AND is still the active story: finalize does not move
    // the active slot, so the active-story reset path is reachable from a
    // finalized-card delete.
    expect(room.storyQueue.find((s) => s.id === storyAId).finalPoints).toBe('5');
    expect(room.activeStoryId).toBe(storyAId);
    expect(room.phase).toBe('revealed');
    expect(Object.values(room.users).map((u) => u.vote)).toEqual(['5', '8']);

    const facBefore = roomStates(facilitator).length;
    const partBefore = roomStates(participant).length;

    handleStoryQueueRemove(facilitator, { roomId: ROOM, storyId: storyAId });
    await flush();

    // 10.6: exactly one broadcast per socket.
    expect(roomStates(facilitator).length).toBe(facBefore + 1);
    expect(roomStates(participant).length).toBe(partBefore + 1);

    const state = lastRoomState(facilitator);

    // 10.1: the active-and-finalized entry is gone; the rest survive in order.
    expect(state.storyQueue.some((s) => s.id === storyAId)).toBe(false);
    expect(state.storyQueue.map((s) => s.id)).toEqual([storyBId, storyCId]);
    expect(state.storyQueue.find((s) => s.id === storyBId).finalPoints).toBe('8');
    expect(state.storyQueue.find((s) => s.id === storyCId).finalPoints).toBeNull();

    // 10.3: activeStoryId cleared, phase back to voting.
    expect(state.activeStoryId).toBeNull();
    expect(state.phase).toBe('voting');

    // 10.3: room.story is exactly the Story_Placeholder — the literal title is
    // the fixed value this example exists to pin character-for-character.
    expect(state.story).toEqual({ number: '', title: PLACEHOLDER_TITLE, finalPoints: null });
    expect(state.story.title).toBe('Add Story to Queue');
    expect(Object.keys(state.story)).toEqual(['number', 'title', 'finalPoints']);

    // 10.3: every vote cleared, in the payload and in room state.
    expect(Object.values(state.users).map((u) => u.vote)).toEqual([null, null]);
    expect(Object.values(room.users).map((u) => u.vote)).toEqual([null, null]);

    // Every other field of each user record survives the reset.
    for (const [uid, user] of Object.entries(state.users)) {
      expect(user.name).toBe(room.users[uid].name);
    }

    // Both recipients saw the same placeholder view.
    const participantState = lastRoomState(participant);
    expect(sharedView(participantState)).toEqual(sharedView(state));
    expect(participantState.story.title).toBe(PLACEHOLDER_TITLE);
    expect(participantState.activeStoryId).toBeNull();
    expect(participantState.phase).toBe('voting');
  });
});

// ---------------------------------------------------------------------------
// 16.3 — Joining after a delete (Requirement 11.10)
// ---------------------------------------------------------------------------

describe('Integration: joining after a finalized story was deleted', () => {
  it('a newly joining facilitator and a newly joining participant each receive a queue with no entry carrying the removed id (11.10)', async () => {
    const { facilitator, storyAId, storyBId, storyCId } = await seedFinalizedStories();

    // Delete the finalized, active story A.
    handleStoryQueueRemove(facilitator, { roomId: ROOM, storyId: storyAId });
    await flush();

    const modKey = rooms.get(ROOM).moderatorKey;

    // A second facilitator socket joins, presenting the room's modKey.
    const joiningFacilitator = register(makeSocket('sock-fac2'));
    handleRoomJoin(joiningFacilitator, {
      roomId: ROOM,
      name: 'Mod2',
      modKey,
      clientId: 'client-fac2'
    });
    await flush();

    // A brand-new participant joins.
    const joiningParticipant = register(makeSocket('sock-p2'));
    handleRoomJoin(joiningParticipant, {
      roomId: ROOM,
      name: 'Bo',
      clientId: 'client-p2'
    });
    await flush();

    for (const sock of [joiningFacilitator, joiningParticipant]) {
      // The very FIRST state each socket ever receives already omits the
      // deleted entry: no further request was needed after the join.
      const first = roomStates(sock)[0];
      expect(first).toBeDefined();
      expect(first.storyQueue.some((s) => s.id === storyAId)).toBe(false);
      expect(first.storyQueue.map((s) => s.id)).toEqual([storyBId, storyCId]);
      expect(first.activeStoryId).toBeNull();
      expect(first.story.title).toBe(PLACEHOLDER_TITLE);
    }

    // Role is resolved per recipient, on that same first payload.
    expect(roomStates(joiningFacilitator)[0].youAreModerator).toBe(true);
    expect(roomStates(joiningParticipant)[0].youAreModerator).toBe(false);

    // Both joiners agree with each other on the surviving queue.
    expect(queueShape(roomStates(joiningParticipant)[0].storyQueue)).toEqual(
      queueShape(roomStates(joiningFacilitator)[0].storyQueue)
    );
  });
});

// ---------------------------------------------------------------------------
// 16.3 — Debounced persistence after a delete (Requirement 11.8)
//
// Persistence is armed only by server.js's live entry point, and the snapshot
// path comes from ROOMS_STATE_FILE. Both are set up here BEFORE a second,
// isolated evaluation of server.js: ROOMS_STATE_FILE points at a temp file (the
// repo's .rooms-state.json is never touched), PORT is 0 so the live branch binds
// an ephemeral port, and process.argv[1] is pointed at server.js just long
// enough for its main-module check to take the live branch. No production code
// is modified. Same approach as revote-integration.test.js's persistence block.
// ---------------------------------------------------------------------------

describe('Integration: debounced persistence after deleting a finalized story', () => {
  const SERVER_PATH = fileURLToPath(new URL('./server.js', import.meta.url));
  const REPO_STATE_FILE = path.join(path.dirname(SERVER_PATH), '.rooms-state.json');
  const PERSIST_ROOM = 'DELPERS9';
  /** Mirrors server.js's PERSIST_DEBOUNCE_MS, which is not exported. */
  const PERSIST_DEBOUNCE_MS = 1000;

  /** The persistence-enabled evaluation of server.js. */
  let live;
  let tmpFile;
  let prevArgv1;
  let prevPort;
  let prevStateFile;
  let addedSignalListeners = [];

  beforeAll(async () => {
    tmpFile = path.join(
      os.tmpdir(),
      `flaps-delete-state-${process.pid}-${Date.now()}.json`
    );
    expect(tmpFile).not.toBe(REPO_STATE_FILE);
    fs.rmSync(tmpFile, { force: true });

    prevStateFile = process.env.ROOMS_STATE_FILE;
    prevPort = process.env.PORT;
    prevArgv1 = process.argv[1];

    process.env.ROOMS_STATE_FILE = tmpFile;
    process.env.PORT = '0';
    process.argv[1] = SERVER_PATH;

    const signalsBefore = {
      SIGTERM: process.listeners('SIGTERM'),
      SIGINT: process.listeners('SIGINT')
    };

    vi.resetModules();
    live = await import('./server.js');

    // Restore argv immediately: only the import above needed the live branch.
    process.argv[1] = prevArgv1;

    // The live branch also installs SIGTERM/SIGINT handlers whose graceful
    // shutdown does a synchronous persist. Left in place, a signal delivered
    // during test-runner teardown would rewrite the temp file after cleanup has
    // deleted it. Drop only the listeners this import added.
    addedSignalListeners = [];
    for (const signal of ['SIGTERM', 'SIGINT']) {
      for (const listener of process.listeners(signal)) {
        if (!signalsBefore[signal].includes(listener)) {
          addedSignalListeners.push({ signal, listener });
          process.off(signal, listener);
        }
      }
    }
  });

  afterAll(async () => {
    live.stopRoomCleanup();
    live.rooms.clear();
    await new Promise((resolve) => {
      const guard = setTimeout(resolve, 1000);
      try {
        live.io.close(() => {
          clearTimeout(guard);
          resolve();
        });
      } catch {
        clearTimeout(guard);
        resolve();
      }
    });

    // A debounced write armed by the last mutation can still be in flight (the
    // timer nulls itself before an async fs.writeFile), which would recreate the
    // file after a single delete. Clear it, wait past the debounce window plus
    // the write itself, then clear whatever landed in the meantime.
    fs.rmSync(tmpFile, { force: true });
    await new Promise((resolve) => setTimeout(resolve, PERSIST_DEBOUNCE_MS + 500));
    fs.rmSync(tmpFile, { force: true });
    expect(fs.existsSync(tmpFile)).toBe(false);

    if (prevStateFile === undefined) delete process.env.ROOMS_STATE_FILE;
    else process.env.ROOMS_STATE_FILE = prevStateFile;
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    process.argv[1] = prevArgv1;

    vi.resetModules();
  });

  /** Read the temp snapshot, or `null` if it is absent or mid-write. */
  function readSnapshot() {
    try {
      return JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** Poll the temp snapshot until `predicate` accepts it. */
  async function waitForSnapshot(predicate, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const parsed = readSnapshot();
      if (parsed && predicate(parsed)) return parsed;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for the persisted snapshot at ${tmpFile}`);
  }

  const savedRoom = (snapshot) => snapshot.find((r) => r.roomId === PERSIST_ROOM);

  it(
    'the on-disk snapshot holds a queue without the deleted entry and the updated activeStoryId once the debounce window elapses (11.8)',
    async () => {
      // Sanity: this evaluation of server.js writes to the temp file only.
      expect(process.env.ROOMS_STATE_FILE).toBe(tmpFile);

      const facilitator = makeSocket('del-persist-fac', { clientId: 'del-persist-client' });
      live.handleRoomCreate(facilitator, {
        desiredRoomId: PERSIST_ROOM,
        name: 'Mod',
        clientId: 'del-persist-client'
      });

      const room = live.rooms.get(PERSIST_ROOM);
      const storyAId = 'del-persist-story-a';
      const storyBId = 'del-persist-story-b';
      room.storyQueue.push(
        { id: storyAId, number: 'JIRA-9', title: 'Doomed story', finalPoints: null },
        { id: storyBId, number: 'JIRA-10', title: 'Next story', finalPoints: null }
      );

      // Estimate A and finalize it. A stays the active story, so the delete
      // below also has to clear the active slot on disk.
      live.handleStoryQueueSetActive(facilitator, { roomId: PERSIST_ROOM, storyId: storyAId });
      live.handleStoryQueueFinalize(facilitator, {
        roomId: PERSIST_ROOM,
        storyId: storyAId,
        finalPoints: '5'
      });

      // Baseline snapshot: A finalized at 5 and active, B pending.
      const before = await waitForSnapshot(
        (snap) => savedRoom(snap)?.activeStoryId === storyAId
      );
      expect(savedRoom(before).storyQueue.map((s) => s.id)).toEqual([storyAId, storyBId]);
      expect(savedRoom(before).storyQueue.find((s) => s.id === storyAId).finalPoints).toBe('5');

      // Delete the finalized, active story A.
      const startedAt = Date.now();
      live.handleStoryQueueRemove(facilitator, { roomId: PERSIST_ROOM, storyId: storyAId });

      // The write is debounced: nothing has reached disk yet, so the snapshot
      // still shows the pre-delete state.
      const midFlight = savedRoom(readSnapshot());
      expect(midFlight.storyQueue.some((s) => s.id === storyAId)).toBe(true);
      expect(midFlight.activeStoryId).toBe(storyAId);

      // Advance past the debounce window (1000 ms) and read the new snapshot.
      const after = await waitForSnapshot(
        (snap) => savedRoom(snap)?.storyQueue.every((s) => s.id !== storyAId)
      );
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);

      const persisted = savedRoom(after);

      // 11.8 / 11.9: no entry carries the removed id, and the surviving entry
      // persisted unchanged.
      expect(persisted.storyQueue.some((s) => s.id === storyAId)).toBe(false);
      expect(persisted.storyQueue.map((s) => s.id)).toEqual([storyBId]);
      expect(persisted.storyQueue.find((s) => s.id === storyBId)).toMatchObject({
        id: storyBId,
        number: 'JIRA-10',
        title: 'Next story',
        finalPoints: null
      });

      // 11.8: the updated activeStoryId reached disk too, alongside the
      // placeholder story and the voting phase the reset wrote.
      expect(persisted.activeStoryId).toBeNull();
      expect(persisted.story).toEqual({
        number: '',
        title: PLACEHOLDER_TITLE,
        finalPoints: null
      });
      expect(persisted.phase).toBe('voting');
    },
    20000
  );
});
