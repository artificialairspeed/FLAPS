/**
 * Supporting Unit Tests (Task 4) — SERVER
 * Spec: session-persistence-on-tab-inactive
 *
 * Targeted, example-based unit tests for the server half of the fix. These
 * complement the exploration (Property 1) and preservation (Property 2) tests
 * with focused assertions on the concrete mechanics described in design.md:
 *
 *   - handleDisconnect marks the user disconnected and arms a grace timer
 *     instead of deleting immediately; grace expiry deletes and broadcasts.
 *   - handleRoomJoin with an existing clientId resumes the session (role, vote,
 *     membership) and cancels the pending grace timer; with a new clientId it
 *     creates a fresh user (unchanged first-time behavior).
 *   - makeRoomState exposes the stable identity (clientId as myId) and role
 *     correctly for both facilitator and participant.
 *
 * Validates: Requirements 2.1, 2.3, 2.4, 3.2, 3.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rooms,
  makeRoomState,
  handleRoomCreate,
  handleRoomJoin,
  handleVoteSet,
  handleDisconnect,
  DISCONNECT_GRACE_MS,
} from './server.js';

/**
 * Minimal fake Socket.IO socket that drives the server handlers. Mirrors the
 * harness used by server.exploration.test.js: an object with id, data, join(),
 * leave(), and emit() that records emitted events.
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

const ROOM = 'UNIT1';

beforeEach(() => {
  rooms.clear();
});

describe('handleDisconnect — grace period instead of immediate deletion (Req 2.1, 3.2)', () => {
  it('marks the user disconnected and arms a grace timer rather than deleting', () => {
    const clientId = 'client-disc';
    const socket = makeSocket('sock-a', { clientId });
    handleRoomJoin(socket, { roomId: ROOM, name: 'Ada', clientId });

    const room = rooms.get(ROOM);
    expect(Object.keys(room.users)).toHaveLength(1);

    handleDisconnect(socket);

    // The user record is retained (not deleted) and flagged disconnected.
    const user = room.users[clientId];
    expect(user).toBeDefined();
    expect(user.connected).toBe(false);
    expect(typeof user.disconnectedAt).toBe('number');
    // A grace timer is armed for later removal.
    expect(user.graceTimer).toBeTruthy();

    // Clean up the pending timer so it does not fire after the test.
    clearTimeout(user.graceTimer);
  });

  it('deletes the user when the grace period elapses without a reconnect', () => {
    vi.useFakeTimers();
    try {
      const clientId = 'client-expire';
      const socket = makeSocket('sock-b', { clientId });
      handleRoomJoin(socket, { roomId: ROOM, name: 'Grace', clientId });

      const room = rooms.get(ROOM);
      handleDisconnect(socket);

      // Still present immediately after disconnect (held through grace window).
      expect(room.users[clientId]).toBeDefined();

      // Advance just short of the grace window: still present.
      vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 1);
      expect(room.users[clientId]).toBeDefined();

      // Cross the grace boundary: the disconnected user is removed.
      vi.advanceTimersByTime(1);
      expect(room.users[clientId]).toBeUndefined();
      expect(Object.keys(room.users)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('handleRoomJoin — resume vs. fresh join (Req 2.3, 2.4, 3.3)', () => {
  it('resumes an existing session (role, vote, membership) and cancels the grace timer', () => {
    vi.useFakeTimers();
    try {
      const clientId = 'client-resume';

      // Active session with a cast vote.
      const first = makeSocket('sock-c1', { clientId });
      handleRoomJoin(first, { roomId: ROOM, name: 'Lin', clientId });
      handleVoteSet(first, { roomId: ROOM, vote: '8' });

      const room = rooms.get(ROOM);
      expect(room.users[clientId].vote).toBe('8');

      // Background lapse -> disconnect arms a grace timer.
      handleDisconnect(first);
      const armedTimer = room.users[clientId].graceTimer;
      expect(armedTimer).toBeTruthy();

      // Returns within grace under a NEW socket.id, same clientId.
      const second = makeSocket('sock-c2', { clientId });
      handleRoomJoin(second, { roomId: ROOM, name: 'Lin', clientId });

      const resumed = room.users[clientId];
      // Membership preserved: exactly one user, same record.
      expect(Object.keys(room.users)).toHaveLength(1);
      // Vote preserved across the lapse.
      expect(resumed.vote).toBe('8');
      // Reconnected and re-attached to the live socket.
      expect(resumed.connected).toBe(true);
      expect(resumed.disconnectedAt).toBeNull();
      expect(resumed.socketId).toBe('sock-c2');
      // Grace timer was cancelled so it will not remove the resumed user.
      expect(resumed.graceTimer).toBeNull();

      // Confirm the previously-armed timer no longer removes the user.
      vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 10);
      expect(room.users[clientId]).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores facilitator role on resume when the modKey is re-sent', () => {
    const clientId = 'client-fac';
    const creator = makeSocket('sock-f1', { clientId });
    handleRoomCreate(creator, { desiredRoomId: ROOM, name: 'Mod', clientId });

    const room = rooms.get(ROOM);
    const modKey = room.moderatorKey;
    expect(room.users[clientId].isModerator).toBe(true);

    handleDisconnect(creator);

    const back = makeSocket('sock-f2', { clientId, modKey });
    handleRoomJoin(back, { roomId: ROOM, name: 'Mod', modKey, clientId });

    const resumed = room.users[clientId];
    expect(resumed.isModerator).toBe(true);
    expect(Object.keys(room.users)).toHaveLength(1);
  });

  it('creates a fresh user for a new clientId (unchanged first-time behavior)', () => {
    const firstClient = 'client-existing';
    const first = makeSocket('sock-e1', { clientId: firstClient });
    handleRoomJoin(first, { roomId: ROOM, name: 'Ada', clientId: firstClient });

    const secondClient = 'client-new';
    const second = makeSocket('sock-e2', { clientId: secondClient });
    handleRoomJoin(second, { roomId: ROOM, name: 'Bo', clientId: secondClient });

    const room = rooms.get(ROOM);
    // Two distinct users keyed by their stable clientId.
    expect(Object.keys(room.users)).toHaveLength(2);
    expect(room.users[firstClient]).toBeDefined();
    expect(room.users[secondClient]).toBeDefined();

    // A brand-new participant is a non-moderator with no vote yet.
    const fresh = room.users[secondClient];
    expect(fresh.name).toBe('Bo');
    expect(fresh.isModerator).toBe(false);
    expect(fresh.vote).toBeNull();
    expect(fresh.connected).toBe(true);
    expect(fresh.socketId).toBe('sock-e2');
  });
});

describe('makeRoomState — stable identity + role marker (Req 2.4, 3.3)', () => {
  it('reports the facilitator identity (clientId as myId) and youAreModerator = true', () => {
    const clientId = 'client-state-fac';
    const creator = makeSocket('sock-s1', { clientId });
    handleRoomCreate(creator, { desiredRoomId: ROOM, name: 'Mod', clientId });

    const room = rooms.get(ROOM);
    const state = makeRoomState(room, creator);

    // Stable identity marker is the durable clientId, not the transient socket.id.
    expect(state.myId).toBe(clientId);
    expect(state.youAreModerator).toBe(true);
    // The user is present in the broadcast keyed by clientId and marked moderator.
    expect(state.users[clientId]).toBeDefined();
    expect(state.users[clientId].isModerator).toBe(true);
  });

  it('reports the participant identity and youAreModerator = false', () => {
    const clientId = 'client-state-part';
    const socket = makeSocket('sock-s2', { clientId });
    handleRoomJoin(socket, { roomId: ROOM, name: 'Pat', clientId });

    const room = rooms.get(ROOM);
    const state = makeRoomState(room, socket);

    expect(state.myId).toBe(clientId);
    expect(state.youAreModerator).toBe(false);
    expect(state.users[clientId]).toBeDefined();
    expect(state.users[clientId].isModerator).toBe(false);
  });
});
