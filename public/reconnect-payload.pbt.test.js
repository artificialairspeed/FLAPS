/**
 * Property-Based Tests — Reconnect Re-emits a Complete Join Payload (Property 11)
 * Spec: create-join-flow-overhaul  (Task 5.7)
 * Tag: Feature: create-join-flow-overhaul, Property 11
 *
 * Property 11: Reconnect attempt re-emits a complete join payload.
 *
 *   For any reconnect attempt from DISCONNECTED, the Session_State_Machine
 *   transitions to RESUMING and re-emits `room:join` whose payload contains the
 *   durable `clientId` plus the room, name, emoji, and modKey needed for the
 *   server to resume the session (Req 8.2).
 *
 * Validates: Requirements 8.2
 *
 * Notes on the harness:
 *   This is a pure model test at the state-machine + emit level, mirroring how
 *   task 5.3 (join-guard.pbt.test.js) validated Property 6 without a brittle DOM
 *   harness. It composes the shipped, DOM-free pure units:
 *     - `transition(state, event)` from session-machine.js (the state table), and
 *     - `joinPayload(extra)` from session-identity.js (the emit builder that
 *       always attaches `getClientId()`).
 *
 *   `reconnect(state, { roomId, name, emoji, modKey }, emit)` mirrors the
 *   reconnect/foreground path wired into `public/app.js` (task 5.4): only from
 *   DISCONNECTED does it dispatch RECONNECT_ATTEMPT (→ RESUMING) and emit
 *   `room:join` built via `joinPayload({ roomId, name, emoji, modKey })`.
 *   Testing this path directly validates Req 8.2 deterministically without a DOM.
 *
 *   `joinPayload` reads the module-level clientId via `getClientId()`, which
 *   reads/writes the global `localStorage`. Each case installs a minimal
 *   in-memory `localStorage` stub on `globalThis` (as in the other
 *   session-identity tests) so identity resolution has a well-defined store.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { STATES, EVENTS, transition } from './session-machine.js';
import { joinPayload, getClientId } from './session-identity.js';

const NUM_RUNS = 100;

/** The complete set of known states as an array. */
const STATE_VALUES = Object.values(STATES);

/**
 * Minimal in-memory localStorage stub implementing the subset of the Web
 * Storage API that session-identity.js uses (getItem/setItem), plus
 * clear/removeItem for hygiene. Mirrors the helper in the other PBT suites.
 *
 * @param {Record<string,string>} [seed] - initial key/value pairs.
 * @returns {object} the stub.
 */
function makeLocalStorageStub(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
  };
}

/**
 * The reconnect/foreground handler, mirroring `public/app.js` (task 5.4).
 *
 * Only from DISCONNECTED does a reconnect attempt do anything: it dispatches
 * RECONNECT_ATTEMPT (→ RESUMING) and re-emits `room:join` with a full payload
 * built via `joinPayload` (Req 8.2). From any other state it is a no-op: no
 * transition and no emit.
 *
 * @param {string} state - the current Session_State
 * @param {{roomId: string, name: string, emoji: string, modKey: string}} ctx - resume fields
 * @param {(event: string, payload: object) => void} emit - the socket emit spy
 * @returns {string} the resulting Session_State
 */
function reconnect(state, { roomId, name, emoji, modKey }, emit) {
  if (state !== STATES.DISCONNECTED) return state;
  const next = transition(state, EVENTS.RECONNECT_ATTEMPT);
  emit('room:join', joinPayload({ roomId, name, emoji, modKey }));
  return next;
}

/** Generator for the resume fields carried on the re-emitted join payload. */
const resumeFieldsArb = fc.record({
  roomId: fc.string({ minLength: 1, maxLength: 24 }),
  name: fc.string({ minLength: 1, maxLength: 24 }),
  emoji: fc.string({ maxLength: 8 }),
  modKey: fc.oneof(fc.string({ maxLength: 24 }), fc.constant('')),
});

describe('Feature: create-join-flow-overhaul, Property 11 — reconnect re-emits a complete join payload', () => {
  // Core property: from DISCONNECTED, a reconnect attempt transitions to
  // RESUMING and re-emits `room:join` exactly once with a complete payload
  // (clientId + room, name, emoji, modKey).
  //
  // Validates: Requirements 8.2
  it('from DISCONNECTED transitions to RESUMING and re-emits a complete room:join', () => {
    fc.assert(
      fc.property(resumeFieldsArb, (fields) => {
        // Fresh, isolated store per case so getClientId resolves deterministically.
        globalThis.localStorage = makeLocalStorageStub();

        const emitted = [];
        const emit = (event, payload) => emitted.push({ event, payload });

        const next = reconnect(STATES.DISCONNECTED, fields, emit);

        // Transition to RESUMING (Req 8.2).
        expect(next).toBe(STATES.RESUMING);

        // Exactly one room:join re-emit occurred.
        expect(emitted).toHaveLength(1);
        expect(emitted[0].event).toBe('room:join');

        const { payload } = emitted[0];

        // Payload carries the durable clientId (Req 8.2 / 5.3).
        expect(payload.clientId).toBe(getClientId());
        expect(typeof payload.clientId).toBe('string');
        expect(payload.clientId.length).toBeGreaterThan(0);

        // Payload is complete: room, name, emoji, and modKey with provided values.
        expect(payload.roomId).toBe(fields.roomId);
        expect(payload.name).toBe(fields.name);
        expect(payload.emoji).toBe(fields.emoji);
        expect(payload.modKey).toBe(fields.modKey);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Negative counterpart: a reconnect attempt from any NON-DISCONNECTED state
  // is a no-op — no transition and no re-emit — so the machine only resumes
  // from a genuine disconnect (Req 8.2).
  it('is a no-op from any state other than DISCONNECTED', () => {
    const nonDisconnected = STATE_VALUES.filter((s) => s !== STATES.DISCONNECTED);
    fc.assert(
      fc.property(fc.constantFrom(...nonDisconnected), resumeFieldsArb, (state, fields) => {
        globalThis.localStorage = makeLocalStorageStub();

        const emitted = [];
        const emit = (event, payload) => emitted.push({ event, payload });

        const next = reconnect(state, fields, emit);

        // State unchanged and nothing emitted.
        expect(next).toBe(state);
        expect(emitted).toEqual([]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused example: a representative reconnect carries every expected field.
  it('re-emits a representative complete payload', () => {
    globalThis.localStorage = makeLocalStorageStub();
    const emitted = [];
    const emit = (event, payload) => emitted.push({ event, payload });

    const fields = { roomId: 'room-42', name: 'Ada', emoji: '🦊', modKey: 'secret' };
    const next = reconnect(STATES.DISCONNECTED, fields, emit);

    expect(next).toBe(STATES.RESUMING);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('room:join');
    expect(emitted[0].payload).toEqual({
      roomId: 'room-42',
      name: 'Ada',
      emoji: '🦊',
      modKey: 'secret',
      clientId: getClientId(),
    });
  });
});
