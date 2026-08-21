// @vitest-environment jsdom
/**
 * Supporting Unit Tests (Task 4) — CLIENT
 * Spec: session-persistence-on-tab-inactive
 *
 * Focused unit tests for the client half of the fix, complementing the
 * exploration (Property 1) tests. They verify the concrete client mechanics
 * described in design.md:
 *
 *   - The stable clientId is minted once and reused, and every reconnect
 *     re-emits room:join carrying that same clientId (Requirements 2.3, 2.4).
 *   - Transient disconnect / connect_error events do NOT produce repeated
 *     connection toasts, while a genuine, unrecoverable failure
 *     (reconnect_failed while not joined) DOES surface a single notification
 *     (Requirement 2.2).
 *
 * Follows the jsdom loading approach from public/app.exploration.test.js:
 * inject the real index.html body, set window.history to a participant URL,
 * mock globalThis.io with a controllable fake socket, and eval app.js into
 * this realm.
 *
 * Validates: Requirements 2.2, 2.3, 2.4
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOM = 'UNITCL1';

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

function roomJoinEmits() {
  return fakeSocket.sent.filter((m) => m.event === 'room:join');
}

beforeAll(async () => {
  // 1) Inject the real application DOM so app.js can wire up its handlers.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  const bodyInner = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
  document.body.innerHTML = bodyInner;

  // 2) Land on a participant room URL (no ?mod=) so the client treats us as a
  //    returning participant on connect.
  window.history.replaceState({}, '', `/room/${ROOM}`);

  // 3) Seed a prior joined session so handleParticipantReconnection engages and
  //    re-emits room:join on connect. Do NOT seed flaps_client_id — app.js must
  //    mint it on load.
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

describe('client clientId: minted once, reused, and resent on reconnect (Req 2.3, 2.4)', () => {
  beforeEach(() => {
    fakeSocket.sent = [];
    clearToasts();
  });

  it('mints a stable clientId on load and persists it in sessionStorage', () => {
    const stored = sessionStorage.getItem('flaps_client_id');
    expect(typeof stored).toBe('string');
    expect(stored.length).toBeGreaterThan(0);
  });

  it('re-emits room:join carrying the stored clientId on connect', () => {
    const stored = sessionStorage.getItem('flaps_client_id');

    fakeSocket.connected = true;
    fakeSocket.__trigger('connect');

    const joins = roomJoinEmits();
    expect(joins.length).toBeGreaterThanOrEqual(1);
    expect(joins[0].payload.clientId).toBe(stored);
  });

  it('reuses the same clientId across multiple reconnects (minted once)', () => {
    const stored = sessionStorage.getItem('flaps_client_id');

    fakeSocket.connected = true;
    fakeSocket.__trigger('connect');
    fakeSocket.__trigger('connect');

    const joins = roomJoinEmits();
    expect(joins.length).toBeGreaterThanOrEqual(2);
    const ids = joins.map((j) => j.payload.clientId);
    // Every reconnect resends the identical, stable clientId.
    for (const id of ids) {
      expect(id).toBe(stored);
    }
    // The stored value is unchanged after multiple connects (minted once).
    expect(sessionStorage.getItem('flaps_client_id')).toBe(stored);
  });
});

describe('client connection notifications: transient quiet, genuine failure loud (Req 2.2)', () => {
  beforeEach(() => {
    clearToasts();
    fakeSocket.sent = [];
  });

  it('a transient disconnect followed by repeated connect_error produces no toasts', () => {
    fakeSocket.connected = false;
    fakeSocket.__trigger('disconnect', 'transport close');
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));
    fakeSocket.__trigger('connect_error', new Error('xhr poll error'));

    // Transient, auto-recovering lapses are conveyed only via the quiet pill,
    // never repeated toasts.
    expect(toastMessages()).toHaveLength(0);
  });

  it('a genuine, unrecoverable failure (reconnect_failed while not joined) surfaces a single toast', () => {
    clearToasts();

    // Recovery has genuinely failed and the user has not (re)joined.
    fakeSocket.__trigger('reconnect_failed');

    const messages = toastMessages();
    expect(messages).toContain('Unable to rejoin. Please join manually.');
  });
});
