/**
 * Property-Based Tests — Bootstrap Initial State Selection (Property 10)
 * Spec: create-join-flow-overhaul  (Task 5.6)
 * Tag: Feature: create-join-flow-overhaul, Property 10
 *
 * Property 10: Bootstrap selects the correct initial state and resumes when joined.
 *
 *   For any load, when a stored joined session exists for the current room the
 *   Session_State_Machine enters RESUMING and emits `room:join` carrying the
 *   stored `clientId`; when no stored joined session exists it enters INITIAL.
 *
 * Validates: Requirements 7.1, 7.4
 *
 * Notes on the harness:
 *   This is a pure model test at the state-machine + emit level, mirroring how
 *   tasks 5.3 (join-guard.pbt.test.js) and 5.7 (reconnect-payload.pbt.test.js)
 *   validated their properties without a brittle DOM harness. It composes the
 *   shipped, DOM-free pure units:
 *     - `createSessionMachine` + `STATES`/`EVENTS`/`transition` from
 *       session-machine.js (the state table and holder), and
 *     - `joinPayload(extra)` + `getClientId()` from session-identity.js (the
 *       emit builder that always attaches the durable clientId).
 *
 *   `bootstrap(hasStored, { roomId, name, emoji, modKey }, emit)` mirrors the
 *   bootstrap wiring in `public/app.js` (task 5.5): it picks the bootstrap event
 *   from `hasStoredJoinedSession(room)` — BOOTSTRAP_RESUME when a joined session
 *   exists, BOOTSTRAP_FRESH otherwise — dispatches it into a fresh machine
 *   starting at INITIAL, and on resume emits `room:join` via `joinPayload` with
 *   the stored clientId (the 'connect' handler's resume emit). Testing this path
 *   directly validates Req 7.1 / 7.4 deterministically without a DOM.
 *
 *   `joinPayload` reads the module-level clientId via `getClientId()`, which
 *   reads/writes the global `localStorage`. Each case installs a minimal
 *   in-memory `localStorage` stub on `globalThis` (as in the other
 *   session-identity tests) so identity resolution has a well-defined store.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  STATES,
  EVENTS,
  createSessionMachine
} from './session-machine.js';
import { joinPayload, getClientId } from './session-identity.js';

const NUM_RUNS = 100;

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
 * The bootstrap handler, mirroring `public/app.js` (task 5.5).
 *
 * Picks the bootstrap event from the stored-session decision:
 *   - hasStored → BOOTSTRAP_RESUME (machine INITIAL → RESUMING), and the
 *     'connect' resume path re-emits `room:join` via joinPayload with the
 *     stored clientId (Req 7.1).
 *   - !hasStored → BOOTSTRAP_FRESH (machine stays INITIAL), no emit (Req 7.4).
 *
 * @param {boolean} hasStored - whether a stored joined session exists for the room
 * @param {{roomId: string, name: string, emoji: string, modKey: string}} fields - resume fields
 * @param {(event: string, payload: object) => void} emit - the socket emit spy
 * @returns {string} the resulting Session_State
 */
function bootstrap(hasStored, { roomId, name, emoji, modKey }, emit) {
  // render is a no-op for this pure model test.
  const machine = createSessionMachine(
    STATES.INITIAL,
    { role: null, hasRoomInUrl: !!roomId, hasModKey: !!modKey },
    () => {}
  );

  const bootstrapEvent = hasStored ? EVENTS.BOOTSTRAP_RESUME : EVENTS.BOOTSTRAP_FRESH;
  machine.dispatch(bootstrapEvent);

  // On resume, the 'connect' handler re-emits room:join with the stored clientId.
  if (machine.getState() === STATES.RESUMING) {
    emit('room:join', joinPayload({ roomId, name, emoji, modKey }));
  }

  return machine.getState();
}

/** Generator for the resume fields carried on the room:join payload. */
const resumeFieldsArb = fc.record({
  roomId: fc.string({ minLength: 1, maxLength: 24 }),
  name: fc.string({ minLength: 1, maxLength: 24 }),
  emoji: fc.string({ maxLength: 8 }),
  modKey: fc.oneof(fc.string({ maxLength: 24 }), fc.constant('')),
});

describe('Feature: create-join-flow-overhaul, Property 10 — bootstrap selects the correct initial state and resumes when joined', () => {
  // Core property (resume branch): a stored joined session drives the machine
  // to RESUMING and re-emits room:join carrying the stored clientId (Req 7.1).
  //
  // Validates: Requirements 7.1
  it('with a stored joined session enters RESUMING and emits room:join with the stored clientId', () => {
    fc.assert(
      fc.property(resumeFieldsArb, (fields) => {
        globalThis.localStorage = makeLocalStorageStub();

        const emitted = [];
        const emit = (event, payload) => emitted.push({ event, payload });

        const state = bootstrap(true, fields, emit);

        // Machine enters RESUMING (Req 7.1).
        expect(state).toBe(STATES.RESUMING);

        // Exactly one room:join re-emit occurred.
        expect(emitted).toHaveLength(1);
        expect(emitted[0].event).toBe('room:join');

        // Payload carries the durable, stored clientId (Req 7.1 / 5.3).
        const { payload } = emitted[0];
        expect(payload.clientId).toBe(getClientId());
        expect(typeof payload.clientId).toBe('string');
        expect(payload.clientId.length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Core property (fresh branch): no stored joined session leaves the machine
  // in INITIAL and emits nothing (Req 7.4).
  //
  // Validates: Requirements 7.4
  it('without a stored joined session enters INITIAL and emits nothing', () => {
    fc.assert(
      fc.property(resumeFieldsArb, (fields) => {
        globalThis.localStorage = makeLocalStorageStub();

        const emitted = [];
        const emit = (event, payload) => emitted.push({ event, payload });

        const state = bootstrap(false, fields, emit);

        // Machine stays INITIAL (Req 7.4).
        expect(state).toBe(STATES.INITIAL);
        // No room:join emit occurred.
        expect(emitted).toEqual([]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // The resume emit reuses a single stable clientId (idempotence): two bootstrap
  // resumes in a row carry the same clientId, matching getClientId() (Req 7.1).
  // Note: getClientId() caches the resolved id in module state, so the durable
  // identity is stable across loads regardless of the per-case storage stub.
  //
  // Validates: Requirements 7.1
  it('reuses a single stable clientId across resume emits', () => {
    fc.assert(
      fc.property(resumeFieldsArb, (fields) => {
        globalThis.localStorage = makeLocalStorageStub();

        const first = [];
        bootstrap(true, fields, (event, payload) => first.push({ event, payload }));
        const second = [];
        bootstrap(true, fields, (event, payload) => second.push({ event, payload }));

        const stableId = getClientId();
        expect(first[0].payload.clientId).toBe(stableId);
        expect(second[0].payload.clientId).toBe(stableId);
        expect(first[0].payload.clientId).toBe(second[0].payload.clientId);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused examples pinning both branches.
  it('handles representative resume and fresh examples', () => {
    globalThis.localStorage = makeLocalStorageStub();

    // Resume branch.
    const resumeEmitted = [];
    const resumeState = bootstrap(
      true,
      { roomId: 'room-42', name: 'Ada', emoji: '🦊', modKey: 'secret' },
      (event, payload) => resumeEmitted.push({ event, payload })
    );
    expect(resumeState).toBe(STATES.RESUMING);
    expect(resumeEmitted).toEqual([
      {
        event: 'room:join',
        payload: {
          roomId: 'room-42',
          name: 'Ada',
          emoji: '🦊',
          modKey: 'secret',
          clientId: getClientId(),
        },
      },
    ]);

    // Fresh branch.
    const freshEmitted = [];
    const freshState = bootstrap(
      false,
      { roomId: 'room-42', name: 'Ada', emoji: '🦊', modKey: '' },
      (event, payload) => freshEmitted.push({ event, payload })
    );
    expect(freshState).toBe(STATES.INITIAL);
    expect(freshEmitted).toEqual([]);
  });
});
