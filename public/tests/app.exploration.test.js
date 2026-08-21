// @vitest-environment jsdom
/**
 * Bug Condition Exploration Tests (Property 1) — CLIENT
 * Spec: session-persistence-on-tab-inactive
 *
 * Encodes the CLIENT half of Property 1 (Seamless Session Persistence on
 * Return). Written BEFORE the fix; EXPECTED TO FAIL on the unfixed client.
 *
 * Confirms the hypothesized client-side root causes:
 *   - A hard RECONNECTION_TIMEOUT_MS (5s) timer calls handleReconnectionFailure,
 *     which clears session storage and forces a manual re-join
 *     (requiredManualRejoin should be FALSE on a mere background lapse).
 *   - connect_error / disconnect handlers unconditionally call showToast, so a
 *     single transient lapse surfaces repeated connection toasts
 *     (repeatedConnectionErrorsShown should be FALSE).
 *
 * Validates: Requirements 1.2, 1.3
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOM = 'PERSIST1';

/** A minimal stand-in for the Socket.IO client socket. */
function createFakeSocket() {
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
      // client -> server send; record for inspection
      this.sent.push({ event, payload });
    },
    // test-only: simulate an incoming (server/transport) event
    __trigger(event, ...args) {
      (handlers[event] || []).forEach((cb) => cb(...args));
    },
  };
}

let fakeSocket;

function clearToasts() {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
}

function toastMessages() {
  return Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent);
}

beforeAll(async () => {
  // 1) Inject the real application DOM so app.js can wire up its handlers.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  const bodyInner = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
  document.body.innerHTML = bodyInner;

  // 2) Land on a participant room URL (no ?mod=) so the client treats us as a
  //    returning participant on connect.
  window.history.replaceState({}, '', `/room/${ROOM}`);

  // 3) Seed a prior joined session so handleParticipantReconnection engages.
  sessionStorage.setItem('flaps_room_id', ROOM);
  sessionStorage.setItem(`flaps_joined_${ROOM}`, 'true');
  sessionStorage.setItem('flaps_user_name', 'Ada');

  // 4) Mock the Socket.IO factory to return our controllable fake socket.
  fakeSocket = createFakeSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  // 5) Load the real client code. app.js is now an ES module (it imports the
  //    session state machine), so load it via dynamic import AFTER the DOM,
  //    URL, storage, and io globals above are in place. Its top-level wiring
  //    runs on import, just as the previous eval did.
  await import('../app.js');
});

describe('Property 1 (client): no repeated connection error notifications', () => {
  beforeEach(() => {
    clearToasts();
  });

  it('a single transient lapse must not surface repeated connection toasts (repeatedConnectionErrorsShown = false)', () => {
    // A single backgrounding-induced lapse typically emits several retry events.
    fakeSocket.connected = false;
    fakeSocket.__trigger('disconnect', 'transport close');
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));

    const messages = toastMessages();

    // EXPECTED: at most one quiet notification for a transient, auto-recovering
    // lapse. UNFIXED: every disconnect/connect_error calls showToast -> many.
    expect(messages.length).toBeLessThanOrEqual(1);
  });
});

describe('Property 1 (client): background lapse must not force a manual re-join', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
    // Restore the joined-session seed (a prior test/failure may have cleared it).
    sessionStorage.setItem('flaps_room_id', ROOM);
    sessionStorage.setItem(`flaps_joined_${ROOM}`, 'true');
    sessionStorage.setItem('flaps_user_name', 'Ada');
    fakeSocket.sent = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handleReconnectionFailure is NOT invoked on a backgrounding disconnect (requiredManualRejoin = false)', () => {
    // Returning participant reconnects; the transport reports connect.
    fakeSocket.connected = true;
    fakeSocket.__trigger('connect');

    // The client re-emits room:join to resume (this part is desirable).
    expect(fakeSocket.sent.some((m) => m.event === 'room:join')).toBe(true);

    // Simulate the server taking slightly longer than the hard 5s timeout to
    // confirm (exactly the backgrounded-socket case). No manual action taken.
    vi.advanceTimersByTime(6000);

    // EXPECTED: the session is NOT torn down and no manual-rejoin toast appears.
    // UNFIXED: the 5s RECONNECTION_TIMEOUT_MS fires handleReconnectionFailure,
    // which clears session storage and shows "Unable to rejoin...".
    expect(sessionStorage.getItem('flaps_room_id')).toBe(ROOM);
    expect(toastMessages()).not.toContain('Unable to rejoin. Please join manually.');
  });
});
