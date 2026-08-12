// @vitest-environment jsdom
/**
 * Re-vote unit tests — concrete examples and pinned strings
 * Spec: clear-revote-finalized-story (Tasks 10.1, 10.2, 10.3)
 *
 * design.md "Testing Strategy > Unit and integration tests" keeps this file
 * small and literal. The property suites carry the universal claims; the three
 * things below are the ones a generator would phrase badly:
 *
 *   10.1  The exact toast text each `requestRevote` guard produces, asserted
 *         verbatim once each, together with the absence of any Re_Vote_Request
 *         (Requirements 2.3, 2.4, 2.8).
 *   10.2  The five `REVOTE_REASONS` values, pinned character-for-character, with
 *         `NOT_MODERATOR` checked against the literal `handleStoryQueueSetActive`
 *         acks with in server.js (Requirements 3.12, 4.1 – 4.5).
 *   10.3  One synchronous smoke test of the post-re-vote broadcast: both queue
 *         sections, the voting deck, and the Finalize_Controls are populated by
 *         the time the handler returns, with no further user action and no timer
 *         needing to fire (Requirement 6.11).
 *
 * Harness: the same one public/app.unit.test.js and public/revote-ui.pbt.test.js
 * use — inject index.html's body, land on a facilitator room URL, stub
 * `globalThis.io` with a controllable fake socket, `await import('./app.js')`,
 * then drive renders with `fakeSocket.__trigger('room:state', state)`. Nothing
 * below the socket boundary is mocked; every assertion is against DOM the
 * production render path built, or against the production module's own exports.
 *
 * server.js is read as TEXT rather than imported: importing it would start a
 * listener and a persistence timer inside this jsdom realm. A regex over the
 * source is side-effect free and still fails if the literal drifts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVOTE_REASONS } from './story-revote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOM = 'REVOTEU1';
const MOD_KEY = 'REVKEY';
const DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];
/** The deck values `renderFinalPointsChips` keeps as finalize options. */
const NUMERIC_DECK = DECK.filter((v) => v !== '?' && v !== '☕');

/** A recording stand-in for the Socket.IO client socket. */
function createRecordingSocket() {
  const handlers = {};
  return {
    connected: true,
    emits: [],
    on(event, cb) {
      (handlers[event] ||= []).push(cb);
    },
    off(event) {
      delete handlers[event];
    },
    emit(event, ...args) {
      this.emits.push({ event, payload: args[0], args });
      return this;
    },
    // test-only: simulate an incoming server event
    __trigger(event, ...args) {
      (handlers[event] || []).forEach((cb) => cb(...args));
    },
    __reset() {
      this.emits = [];
    },
    __of(event) {
      return this.emits.filter((m) => m.event === event);
    },
  };
}

let fakeSocket;

beforeAll(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  document.body.innerHTML = html
    .replace(/[\s\S]*<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*/i, '');

  window.history.replaceState({}, '', `/room/${ROOM}?mod=${MOD_KEY}`);

  // app.js reads Remembered_Defaults on import; this realm has no usable
  // localStorage of its own (same polyfill public/repro-highlight.test.js uses).
  if (!globalThis.localStorage) {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    };
    window.localStorage = globalThis.localStorage;
  }

  fakeSocket = createRecordingSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  await import('./app.js');
});

beforeEach(() => {
  fakeSocket.connected = true;
  setClientRoom(ROOM);
  clearToasts();
  fakeSocket.__reset();
});

afterEach(() => {
  // Leave the shared client state as every test here expects to find it.
  fakeSocket.connected = true;
  setClientRoom(ROOM);
  clearToasts();
});

/* -------------------------------- helpers -------------------------------- */

/**
 * Set the room id held in client state. `room:created` is the client's own
 * entry point for it, so this uses no test-only seam.
 * @param {string|null} [roomId]
 */
function setClientRoom(roomId) {
  fakeSocket.__trigger('room:created', { roomId, modKey: MOD_KEY });
}

function clearToasts() {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
}

/** Every rendered toast, in document order. */
const toasts = () => Array.from(document.querySelectorAll('.toast'));
const toastTexts = () => toasts().map((t) => t.textContent);

function broadcast(state) {
  fakeSocket.__trigger('room:state', state);
}

/** A `room:state` payload in the shape `makeRoomState` produces. */
function roomState(overrides = {}) {
  return {
    roomId: ROOM,
    myId: 'me',
    mySocketId: 'me',
    youAreModerator: true,
    phase: 'voting',
    deck: [...DECK],
    users: {},
    story: { number: '', title: 'Add Story to Queue', finalPoints: null },
    storyQueue: [],
    activeStoryId: null,
    ...overrides,
  };
}

const pendingList = () => document.getElementById('queuePendingList');
const doneList = () => document.getElementById('queueDoneList');

const revoteButtons = (root) =>
  Array.from(root.querySelectorAll('button[aria-label="Re-vote story"]'));

/** Story cards in a section, excluding the per-section empty-state row. */
const cardsIn = (list) =>
  Array.from(list.querySelectorAll('li.queueItem:not(.queueEmptySection)'));

const deckButtons = () => Array.from(document.querySelectorAll('#deck .deckBtn'));
const finalChips = () => Array.from(document.querySelectorAll('#finalPointsChips .finalChip'));

/**
 * Render one finalized story and hand back its Re-Vote control.
 * @param {string} storyId
 */
function renderFinalizedStory(storyId) {
  broadcast(
    roomState({
      storyQueue: [{ id: storyId, number: 'JIRA-001', title: 'Finalized story', finalPoints: '5' }],
      activeStoryId: null,
    }),
  );
  const buttons = revoteButtons(doneList());
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

/**
 * Assert exactly one toast, carrying `message` verbatim, and that the guard
 * emitted no Re_Vote_Request at all.
 * @param {string} message
 */
function expectGuardedBy(message) {
  expect(toastTexts()).toEqual([message]);

  const [toast] = toasts();
  expect(toast.classList.contains('toast')).toBe(true);
  expect(toast.getAttribute('role')).toBe('alert');
  expect(toast.parentElement).toBe(document.body);

  expect(fakeSocket.__of('storyQueue:revote')).toHaveLength(0);
  expect(fakeSocket.emits).toEqual([]);
}

/* ------------------------------- Task 10.1 ------------------------------- */

describe('requestRevote guards: each toast string, asserted verbatim (Req 2.3, 2.4, 2.8)', () => {
  it('shows "Could not identify the story to re-vote" and emits nothing when the card carries a blank story id', () => {
    // A finalized entry whose id normalizes to '' — the first guard in
    // requestRevote's id → room → connection order (Req 2.8).
    const btn = renderFinalizedStory('   ');
    expect(btn.dataset.storyId).toBe('   ');

    clearToasts();
    fakeSocket.__reset();
    btn.click();

    expectGuardedBy('Could not identify the story to re-vote');
  });

  it('shows "Join a room first" and emits nothing when no room id is held in client state', () => {
    const btn = renderFinalizedStory('story-room-guard');

    setClientRoom(null); // no room id in client state (Req 2.4)
    clearToasts();
    fakeSocket.__reset();
    btn.click();

    expectGuardedBy('Join a room first');
  });

  it('shows "Not connected to server" and emits nothing when the socket is disconnected', () => {
    const btn = renderFinalizedStory('story-conn-guard');

    fakeSocket.connected = false; // socket disconnected (Req 2.3)
    clearToasts();
    fakeSocket.__reset();
    btn.click();

    expectGuardedBy('Not connected to server');
  });
});

/* ------------------------------- Task 10.2 ------------------------------- */

describe('REVOTE_REASONS: the five rejection strings, pinned (Req 3.12, 4.1 – 4.5)', () => {
  it('holds exactly the five expected values, character for character', () => {
    expect(REVOTE_REASONS.NO_ROOM).toBe('Room not found');
    expect(REVOTE_REASONS.NOT_MODERATOR).toBe('Not facilitator / moderator');
    expect(REVOTE_REASONS.NO_STORY).toBe('Story not found in queue');
    expect(REVOTE_REASONS.NOT_FINALIZED).toBe('Story is not finalized');
    expect(REVOTE_REASONS.NOT_APPLIED).toBe('Re-vote was not applied');

    // No sixth reason, and the table is frozen.
    expect(Object.keys(REVOTE_REASONS).sort()).toEqual([
      'NOT_APPLIED',
      'NOT_FINALIZED',
      'NOT_MODERATOR',
      'NO_ROOM',
      'NO_STORY',
    ]);
    expect(Object.isFrozen(REVOTE_REASONS)).toBe(true);
  });

  it('keeps NOT_MODERATOR character-identical to the string handleStoryQueueSetActive acks with', () => {
    // The intent: a re-vote rejection must read exactly like its sibling
    // storyQueue:setActive rejection, so a facilitator sees one wording for
    // "you are not the facilitator" regardless of which request was refused.
    // server.js is read as source text — importing it would start a listener.
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    const setActive = source.slice(source.indexOf('function handleStoryQueueSetActive'));
    expect(setActive.startsWith('function handleStoryQueueSetActive')).toBe(true);

    const match = /!requireModerator\([\s\S]*?reason:\s*"([^"]*)"/.exec(setActive);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('Not facilitator / moderator');
    expect(REVOTE_REASONS.NOT_MODERATOR).toBe(match[1]);
  });
});

/* ------------------------------- Task 10.3 ------------------------------- */

describe('post-re-vote render is complete when the broadcast handler returns (Req 6.11)', () => {
  it('populates both queue sections, the voting deck, and the finalize chips synchronously, with no user action and no timer', () => {
    const revoted = { id: 'story-revoted', number: 'JIRA-001', title: 'Re-voted story', finalPoints: null };
    const stillDone = { id: 'story-done', number: 'JIRA-002', title: 'Still finalized', finalPoints: '8' };
    const otherPending = { id: 'story-pending', number: 'JIRA-003', title: 'Not estimated yet', finalPoints: null };

    // The state the server broadcasts after applyRevote: the previously
    // finalized story now carries finalPoints null, is the active story, the
    // room is back in the voting phase, and every vote is cleared.
    const postRevote = roomState({
      phase: 'voting',
      storyQueue: [revoted, stillDone, otherPending],
      activeStoryId: revoted.id,
      story: { number: revoted.number, title: revoted.title, finalPoints: null },
      users: {
        me: { name: 'Me', emoji: '', isModerator: true, connected: true, vote: null },
        ada: { name: 'Ada', emoji: '', isModerator: false, connected: true, vote: null },
      },
    });

    // Fake timers make "no timer fires" observable: nothing below is advanced,
    // so every assertion holds on the synchronous return of the handler alone.
    vi.useFakeTimers();
    try {
      const startedAt = performance.now();
      broadcast(postRevote);
      const elapsed = performance.now() - startedAt;

      // Need Estimate: the re-voted story first (it is the active story),
      // then the remaining pending entry in queue order.
      const pendingCards = cardsIn(pendingList());
      expect(pendingCards.map((li) => li.querySelector('.queueNumber').textContent)).toEqual([
        revoted.number,
        otherPending.number,
      ]);
      expect(document.getElementById('queuePendingCount').textContent).toBe('(2)');
      expect(pendingCards[0].querySelector('.queueFinalChip')).toBeNull();
      expect(revoteButtons(pendingList())).toHaveLength(0);

      // Estimate Done: the story that stayed finalized, with its pill and both
      // facilitator controls.
      const doneCards = cardsIn(doneList());
      expect(doneCards.map((li) => li.querySelector('.queueNumber').textContent)).toEqual([
        stillDone.number,
      ]);
      expect(document.getElementById('queueDoneCount').textContent).toBe('(1)');
      expect(doneCards[0].querySelector('.queueFinalChipValue').textContent).toBe('8');
      expect(revoteButtons(doneList())).toHaveLength(1);

      // Both sections are visible; the whole-queue placeholder is not.
      expect(document.querySelector('.queueSection[data-section="pending"]').hidden).toBe(false);
      expect(document.querySelector('.queueSection[data-section="done"]').hidden).toBe(false);
      expect(document.getElementById('queueEmptyAll').hidden).toBe(true);

      // Voting deck: one card per deck value, open for voting on the re-voted
      // story, with nothing selected.
      const cards = deckButtons();
      expect(cards).toHaveLength(DECK.length);
      cards.forEach((b) => {
        expect(b.disabled).toBe(false);
        expect(b.classList.contains('active')).toBe(false);
      });

      // Finalize_Controls: one chip per numeric deck value, none selected.
      const chips = finalChips();
      expect(chips.map((c) => c.textContent)).toEqual(NUMERIC_DECK);
      chips.forEach((c) => {
        expect(c.classList.contains('selected')).toBe(false);
        expect(c.getAttribute('aria-checked')).toBe('false');
      });

      // No cast-vote indicator on any user entry, and no toast: the render
      // needed no further user action.
      Array.from(document.querySelectorAll('#usersList .ustatus')).forEach((s) => {
        expect(s.textContent).toBe('—');
      });
      expect(toastTexts()).toEqual([]);

      // Well inside the 1000 ms budget, and no pending timer contributed.
      expect(elapsed).toBeLessThan(1000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
