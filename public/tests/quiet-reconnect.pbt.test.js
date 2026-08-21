// @vitest-environment jsdom
/**
 * Property-Based Tests — Quiet Reconnect Suppression (Property 12)
 * Spec: create-join-flow-overhaul  (Task 5.8)
 * Tag: Feature: create-join-flow-overhaul, Property 12
 *
 * Property 12: Repeated connection errors are suppressed during a transient lapse.
 *
 *   For any sequence of `connect_error`/`disconnect` events occurring while the
 *   Session_State is DISCONNECTED or RESUMING, no error toast is surfaced and
 *   the quiet status indicator (the mode pill) is set at most once — and only
 *   ever to "Disconnected".
 *
 * Validates: Requirements 8.4
 *
 * Approach (jsdom, exercising the REAL client handlers):
 *   This test loads the real `public/app.js` under jsdom — the same harness used
 *   by `create-join-flow.integration.test.js` and `app.unit.test.js`. It boots a
 *   participant client, drives it into the JOINED state via the real server
 *   `handleRoomJoin` + `makeRoomState` round-trip, then uses fast-check to fire
 *   arbitrary-length sequences of `connect_error`/`disconnect` transport events
 *   at the real socket handlers.
 *
 *   The client's shipped notification policy (app.js):
 *     - `disconnect`      -> sets the mode pill to a single quiet "Disconnected"
 *                            status; never toasts.
 *     - `connect_error`   -> logs to console only; never toasts.
 *     - `reconnect_failed` -> the ONLY escalation to a toast (not exercised here).
 *
 *   So for any lapse composed solely of `connect_error`/`disconnect`, the pill
 *   must read "Disconnected" (set at most once, idempotent across repeats) and
 *   zero `.toast` elements must appear.
 *
 *   Each fast-check case re-establishes JOINED (via a fresh `room:state`) so the
 *   sequence begins from a known in-session baseline, then asserts the policy.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  vi,
} from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rooms, makeRoomState, handleRoomJoin } from '../../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NUM_RUNS = 100;
const ROOM = 'QUIET1';
const CLIENT_ID = 'quiet-c1';

// ---------------------------------------------------------------------------
// Harness (mirrors create-join-flow.integration.test.js)
// ---------------------------------------------------------------------------

/** A minimal, controllable stand-in for the Socket.IO *client* socket. */
function createFakeClientSocket() {
  const handlers = {};
  return {
    connected: false,
    sent: [],
    on(event, cb) {
      (handlers[event] ||= []).push(cb);
    },
    off(event) {
      delete handlers[event];
    },
    emit(event, payload) {
      this.sent.push({ event, payload });
    },
    connect() {
      this.connected = true;
    },
    __trigger(event, ...args) {
      (handlers[event] || []).forEach((cb) => cb(...args));
    },
  };
}

/** A minimal fake Socket.IO *server* socket for the server-handler harness. */
function makeServerSocket(id, data = {}) {
  const emitted = [];
  return {
    id,
    data: { ...data },
    joinedRooms: new Set(),
    join(roomId) { this.joinedRooms.add(roomId); },
    leave(roomId) { this.joinedRooms.delete(roomId); },
    emit(event, payload) { emitted.push({ event, payload }); },
    emitted,
  };
}

/**
 * This jsdom build provides `sessionStorage` but not `localStorage`. app.js
 * persists durable identity/defaults in `localStorage`, so install a small
 * in-memory polyfill (as the integration suite does).
 */
function installLocalStorage() {
  if (globalThis.localStorage && typeof globalThis.localStorage.clear === 'function') return;
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  try {
    Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  } catch {
    // window may proxy to globalThis; the global definition above suffices.
  }
}

let fakeSocket;
let partSock;

const $ = (id) => document.getElementById(id);
const toastCount = () => document.querySelectorAll('.toast').length;
const clearToasts = () => document.querySelectorAll('.toast').forEach((t) => t.remove());

/** Type into the Name field and fire the live `input` gate. */
function typeName(value) {
  const nameField = $('name');
  nameField.value = value;
  nameField.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Push the real server's room state into the client's room:state handler. */
function pushRoomState() {
  fakeSocket.__trigger('room:state', makeRoomState(rooms.get(ROOM), partSock));
}

beforeAll(async () => {
  vi.resetModules();
  installLocalStorage();

  // 1) Inject the real app DOM.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  const bodyInner = html
    .replace(/[\s\S]*<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*/i, '');
  document.body.innerHTML = bodyInner;

  // 2) Participant room URL (no ?mod=).
  window.history.replaceState({}, '', `/room/${ROOM}`);

  // 3) Fresh storage.
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  // 4) Controllable fake client socket.
  fakeSocket = createFakeClientSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  // 5) Load the real client wiring (top-level wiring runs on import).
  await import('../app.js');

  // 6) Drive the client into JOINED as a participant, via the real server.
  rooms.clear();
  typeName('Bob');
  $('joinBtn').click();
  partSock = makeServerSocket('quiet-s1', { clientId: CLIENT_ID });
  handleRoomJoin(partSock, { roomId: ROOM, name: 'Bob', clientId: CLIENT_ID });
  pushRoomState();

  // Sanity: we are JOINED (in-session config) as a participant. The Join
  // button stays visible, relabelled to the green "Joined" state.
  expect($('name').classList.contains('hidden')).toBe(true);
  expect($('joinBtn').classList.contains('hidden')).toBe(false);
  expect($('joinBtn').textContent).toBe('Joined');
  expect($('modePill').textContent).toBe('Participant');
});

/**
 * Fire a sequence of transport events at the real client handlers, tracking how
 * many DISTINCT values the mode pill (the quiet status indicator) is set to.
 *
 * @param {Array<'connect_error'|'disconnect'>} events
 * @returns {{ statusValues: Set<string>, statusChanges: number }}
 */
function fireLapse(events) {
  const modePill = $('modePill');
  let prev = modePill.textContent;
  let statusChanges = 0;
  const statusValues = new Set();

  for (const ev of events) {
    if (ev === 'disconnect') {
      fakeSocket.connected = false;
      fakeSocket.__trigger('disconnect', 'transport close');
    } else {
      fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    }
    const cur = modePill.textContent;
    if (cur !== prev) {
      statusChanges += 1;
      statusValues.add(cur);
      prev = cur;
    }
  }
  return { statusValues, statusChanges };
}

/** Generator: arbitrary-length sequences of transient transport events. */
const lapseSequenceArb = fc.array(
  fc.constantFrom('connect_error', 'disconnect'),
  { minLength: 0, maxLength: 12 }
);

describe('Feature: create-join-flow-overhaul, Property 12 — quiet reconnect suppression', () => {
  // Core property: from an in-session (JOINED) baseline, any sequence of
  // connect_error/disconnect events (the transient-lapse alphabet) surfaces no
  // error toast and sets the quiet status indicator at most once, only ever to
  // "Disconnected".
  //
  // Validates: Requirements 8.4
  it('suppresses repeated connection errors: no toast, pill set at most once to "Disconnected"', () => {
    fc.assert(
      fc.property(lapseSequenceArb, (events) => {
        // Re-establish a known JOINED baseline (pill -> "Participant"), so each
        // case begins in-session and any lapse-status set is observable.
        pushRoomState();
        clearToasts();

        const { statusValues, statusChanges } = fireLapse(events);

        // (a) No error toast is surfaced for a purely transient lapse (Req 8.4).
        expect(toastCount()).toBe(0);

        // (b) The quiet status indicator is set at most once...
        expect(statusChanges).toBeLessThanOrEqual(1);

        // ...and only ever to "Disconnected" (a disconnect occurred iff the
        // pill moved off the JOINED "Participant" baseline).
        const sawDisconnect = events.includes('disconnect');
        if (sawDisconnect) {
          expect(statusChanges).toBe(1);
          expect([...statusValues]).toEqual(['Disconnected']);
        } else {
          // Only connect_error events never touch the status indicator at all.
          expect(statusChanges).toBe(0);
          expect(statusValues.size).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused example: a representative noisy lapse (many repeats, interleaved)
  // stays quiet — a single "Disconnected" pill and zero toasts.
  it('a representative interleaved burst stays quiet (single "Disconnected", no toasts)', () => {
    pushRoomState();
    clearToasts();

    const burst = [
      'disconnect', 'connect_error', 'connect_error', 'disconnect',
      'connect_error', 'connect_error', 'connect_error', 'disconnect',
    ];
    const { statusValues, statusChanges } = fireLapse(burst);

    expect(toastCount()).toBe(0);
    expect(statusChanges).toBe(1);
    expect([...statusValues]).toEqual(['Disconnected']);
    expect($('modePill').textContent).toBe('Disconnected');
  });
});
