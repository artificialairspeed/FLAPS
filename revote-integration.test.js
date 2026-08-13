/**
 * Integration Tests — Clear/Re-Vote a Finalized Story
 * Spec: clear-revote-finalized-story (Task 11)
 *
 * These are concrete end-to-end examples, not property tests. They drive the
 * real exported server handlers through a whole flow — create room, queue two
 * stories, vote, reveal, finalize, re-vote — and assert on the actual
 * `room:state` payloads `broadcastRoom` delivers, using the `makeSocket`
 * fake-socket harness established in `server.exploration.test.js`.
 *
 * `io.in(roomId).fetchSockets()` is replaced with a stub that returns the fake
 * sockets which have "joined" that room, so the payloads asserted here are the
 * ones `makeRoomState` actually produces per recipient. No network, no real
 * Socket.IO transport.
 *
 * Covered:
 *  - 11.1 One end-to-end example: finalize a story, re-vote it, and assert the
 *    resulting `room:state` shows it pending (`finalPoints: null`) and active,
 *    with cleared votes and `phase === 'voting'`.
 *    _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10_
 *  - 11.2 A newly joining facilitator, a newly joining participant, and a
 *    rejoining participant each receive the re-voted story as pending and
 *    active, with no further re-vote request.
 *    _Requirements: 7.3_
 *  - 11.3 Debounced persistence: against a TEMP state file, a re-vote reaches
 *    disk with `finalPoints: null` and the new `activeStoryId`.
 *    _Requirements: 7.4_
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
  handleStoryQueueRevote,
  handleDisconnect
} from './server.js';

const ROOM = 'REVOTE1';

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

/** Drop a fake socket from the pool, as a real disconnect would. */
function unregister(socket) {
  pool = pool.filter((s) => s !== socket);
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
 * Drive the normal estimation flow up to a finalized story:
 * facilitator creates the room, a participant joins, two stories are queued,
 * story A is made active, both users vote, votes are revealed, then A is
 * finalized at 5. Story B is finalized at 8 and is never touched again.
 */
async function seedFinalizedStory() {
  const facilitator = register(makeSocket('sock-fac', { clientId: 'client-fac' }));
  handleRoomCreate(facilitator, { desiredRoomId: ROOM, name: 'Mod', clientId: 'client-fac' });
  await flush();

  const participant = register(makeSocket('sock-p1', { clientId: 'client-p1' }));
  handleRoomJoin(participant, { roomId: ROOM, name: 'Ada', clientId: 'client-p1' });
  await flush();

  // `storyQueue:add` is not part of server.js's test exports, so the queue is
  // seeded directly — the same convention the existing server integration tests
  // use. Everything after this point goes through the real handlers.
  const room = rooms.get(ROOM);
  const storyAId = 'story-a';
  const storyBId = 'story-b';
  room.storyQueue.push(
    { id: storyAId, number: 'JIRA-1', title: 'Login flow', finalPoints: null },
    { id: storyBId, number: 'JIRA-2', title: 'Signup flow', finalPoints: null }
  );

  handleStoryQueueSetActive(facilitator, { roomId: ROOM, storyId: storyAId });
  handleVoteSet(facilitator, { roomId: ROOM, vote: '5' });
  handleVoteSet(participant, { roomId: ROOM, vote: '8' });
  handleVoteReveal(facilitator, { roomId: ROOM });
  handleStoryQueueFinalize(facilitator, { roomId: ROOM, storyId: storyAId, finalPoints: '5' });
  handleStoryQueueFinalize(facilitator, { roomId: ROOM, storyId: storyBId, finalPoints: '8' });
  await flush();

  return { room, facilitator, participant, storyAId, storyBId };
}

// ---------------------------------------------------------------------------
// 11.1 — End-to-end example through the real handler
// ---------------------------------------------------------------------------

describe('Integration: finalize then re-vote through the real handler', () => {
  it('re-voting a finalized story broadcasts it as pending and active with cleared votes and phase "voting" (3.1, 3.2, 3.3, 3.4, 3.5, 3.10)', async () => {
    const { room, facilitator, participant, storyAId, storyBId } = await seedFinalizedStory();

    // Precondition: story A really is finalized, and the room is revealed with
    // two votes cast — the state a re-vote has to undo.
    expect(room.storyQueue[0].finalPoints).toBe('5');
    expect(room.story.finalPoints).toBe('5');
    expect(room.phase).toBe('revealed');
    expect(Object.values(room.users).map((u) => u.vote)).toEqual(['5', '8']);

    const facBefore = roomStates(facilitator).length;
    const partBefore = roomStates(participant).length;

    const acks = [];
    handleStoryQueueRevote(facilitator, { roomId: ROOM, storyId: storyAId }, (res) =>
      acks.push(res)
    );
    await flush();

    // 3.10: exactly one broadcast, delivered to every socket in the room.
    expect(acks).toEqual([{ ok: true }]);
    expect(roomStates(facilitator).length).toBe(facBefore + 1);
    expect(roomStates(participant).length).toBe(partBefore + 1);

    const state = lastRoomState(facilitator);
    const entryA = state.storyQueue.find((s) => s.id === storyAId);

    // 3.1: the re-voted entry is pending; no other estimate changed.
    expect(entryA.finalPoints).toBeNull();
    expect(state.storyQueue.find((s) => s.id === storyBId).finalPoints).toBe('8');

    // 3.2: it is the active story.
    expect(state.activeStoryId).toBe(storyAId);

    // 3.3: room.story is exactly { number, title, finalPoints: null }.
    expect(state.story).toEqual({
      number: 'JIRA-1',
      title: 'Login flow',
      finalPoints: null
    });
    expect(Object.keys(state.story)).toEqual(['number', 'title', 'finalPoints']);

    // 3.4: back to voting.
    expect(state.phase).toBe('voting');

    // 3.5: every vote is cleared, in the payload and in room state.
    expect(Object.values(state.users).map((u) => u.vote)).toEqual([null, null]);
    expect(Object.values(room.users).map((u) => u.vote)).toEqual([null, null]);

    // Queue identity, order, and the entry's own fields survive untouched.
    expect(state.storyQueue.map((s) => s.id)).toEqual([storyAId, storyBId]);
    expect(entryA.number).toBe('JIRA-1');
    expect(entryA.title).toBe('Login flow');

    // Every recipient saw the same story/queue/phase view.
    const participantState = lastRoomState(participant);
    expect(sharedView(participantState)).toEqual(sharedView(state));
    expect(state.youAreModerator).toBe(true);
    expect(participantState.youAreModerator).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11.2 — Join and rejoin after a re-vote
// ---------------------------------------------------------------------------

describe('Integration: joining and rejoining after a re-vote', () => {
  /** Assert a freshly received payload carries the re-voted story. */
  function expectRevotedView(payload, storyAId) {
    expect(payload).toBeDefined();
    const entry = payload.storyQueue.find((s) => s.id === storyAId);
    expect(entry).toBeDefined();
    expect(entry.finalPoints).toBeNull();
    expect(payload.activeStoryId).toBe(storyAId);
    expect(payload.story).toEqual({
      number: 'JIRA-1',
      title: 'Login flow',
      finalPoints: null
    });
    expect(payload.phase).toBe('voting');
  }

  it('a newly joining facilitator, a newly joining participant, and a rejoining participant each receive the re-voted story as pending and active with no further request (7.3)', async () => {
    const { facilitator, participant, storyAId } = await seedFinalizedStory();

    handleStoryQueueRevote(facilitator, { roomId: ROOM, storyId: storyAId }, () => {});
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

    // The original participant lapses and returns under a new socket id.
    handleDisconnect(participant);
    unregister(participant);
    await flush();
    const rejoiningParticipant = register(makeSocket('sock-p1b'));
    handleRoomJoin(rejoiningParticipant, {
      roomId: ROOM,
      name: 'Ada',
      clientId: 'client-p1'
    });
    await flush();

    // The very FIRST state each socket ever receives already carries the
    // re-voted story: no second re-vote request was made after the join.
    expectRevotedView(roomStates(joiningFacilitator)[0], storyAId);
    expectRevotedView(roomStates(joiningParticipant)[0], storyAId);
    expectRevotedView(roomStates(rejoiningParticipant)[0], storyAId);

    // Role is resolved per recipient, on that same first payload.
    expect(roomStates(joiningFacilitator)[0].youAreModerator).toBe(true);
    expect(roomStates(joiningParticipant)[0].youAreModerator).toBe(false);
    expect(roomStates(rejoiningParticipant)[0].youAreModerator).toBe(false);

    // Nobody arrives holding a stale vote from before the re-vote.
    for (const sock of [joiningFacilitator, joiningParticipant, rejoiningParticipant]) {
      const first = roomStates(sock)[0];
      expect(Object.values(first.users).every((u) => u.vote === null)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11.3 — Debounced persistence after a re-vote
//
// Persistence is armed only by server.js's live entry point, and the snapshot
// path comes from ROOMS_STATE_FILE. Both are set up here BEFORE a second,
// isolated evaluation of server.js: ROOMS_STATE_FILE points at a temp file (the
// repo's .rooms-state.json is never touched), PORT is 0 so the live branch binds
// an ephemeral port, and process.argv[1] is pointed at server.js just long
// enough for its main-module check to take the live branch. No production code
// is modified.
// ---------------------------------------------------------------------------

describe('Integration: debounced persistence after a re-vote', () => {
  const SERVER_PATH = fileURLToPath(new URL('./server.js', import.meta.url));
  const REPO_STATE_FILE = path.join(path.dirname(SERVER_PATH), '.rooms-state.json');
  const PERSIST_ROOM = 'PERSIST9';
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
      `flaps-revote-state-${process.pid}-${Date.now()}.json`
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
    'the on-disk snapshot holds finalPoints: null and the new activeStoryId once the debounce window elapses (7.4)',
    async () => {
      // Sanity: this evaluation of server.js writes to the temp file only.
      expect(process.env.ROOMS_STATE_FILE).toBe(tmpFile);

      const facilitator = makeSocket('persist-fac', { clientId: 'persist-client' });
      live.handleRoomCreate(facilitator, {
        desiredRoomId: PERSIST_ROOM,
        name: 'Mod',
        clientId: 'persist-client'
      });

      const room = live.rooms.get(PERSIST_ROOM);
      const storyAId = 'persist-story-a';
      const storyBId = 'persist-story-b';
      room.storyQueue.push(
        { id: storyAId, number: 'JIRA-9', title: 'Persisted story', finalPoints: null },
        { id: storyBId, number: 'JIRA-10', title: 'Next story', finalPoints: null }
      );

      // Estimate A, finalize it, then move the room on to B.
      live.handleStoryQueueSetActive(facilitator, { roomId: PERSIST_ROOM, storyId: storyAId });
      live.handleStoryQueueFinalize(facilitator, {
        roomId: PERSIST_ROOM,
        storyId: storyAId,
        finalPoints: '5'
      });
      live.handleStoryQueueSetActive(facilitator, { roomId: PERSIST_ROOM, storyId: storyBId });

      // Baseline snapshot: A finalized at 5, B active.
      const before = await waitForSnapshot(
        (snap) => savedRoom(snap)?.activeStoryId === storyBId
      );
      expect(savedRoom(before).storyQueue.find((s) => s.id === storyAId).finalPoints).toBe('5');

      // Re-vote A.
      const startedAt = Date.now();
      const acks = [];
      live.handleStoryQueueRevote(
        facilitator,
        { roomId: PERSIST_ROOM, storyId: storyAId },
        (res) => acks.push(res)
      );
      expect(acks).toEqual([{ ok: true }]);

      // The write is debounced: nothing has reached disk yet, so the snapshot
      // still shows the pre-re-vote state.
      expect(savedRoom(readSnapshot()).activeStoryId).toBe(storyBId);

      // Advance past the debounce window (1000 ms) and read the new snapshot.
      const after = await waitForSnapshot(
        (snap) => savedRoom(snap)?.activeStoryId === storyAId
      );
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);

      const persisted = savedRoom(after);
      expect(persisted.activeStoryId).toBe(storyAId);
      expect(persisted.storyQueue.find((s) => s.id === storyAId).finalPoints).toBeNull();
      expect(persisted.story).toEqual({
        number: 'JIRA-9',
        title: 'Persisted story',
        finalPoints: null
      });
      expect(persisted.phase).toBe('voting');

      // The rest of the queue persisted unchanged, in order.
      expect(persisted.storyQueue.map((s) => s.id)).toEqual([storyAId, storyBId]);
      expect(persisted.storyQueue.find((s) => s.id === storyBId).finalPoints).toBeNull();
    },
    20000
  );
});
