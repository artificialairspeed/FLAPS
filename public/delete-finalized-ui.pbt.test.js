// @vitest-environment jsdom
/**
 * Delete-on-finalized-card UI property tests — CLIENT
 * Spec: clear-revote-finalized-story (design.md "Correctness Properties")
 *
 * Covers Properties 23, 24, 25, 26, 33, 34, 35, 37 — one property-based test
 * each, 100 iterations each, per design.md "Property test rules".
 *
 * Harness (same shape as public/app.unit.test.js and public/repro-highlight.test.js):
 * inject index.html's body into document.body, land on a facilitator room URL,
 * stub globalThis.io with a fake socket, `await import('./app.js')`, then drive
 * renders with `fakeSocket.__trigger('room:state', state)` and assert on the
 * rendered DOM. The fake socket additionally RECORDS every emitted event name,
 * payload, and argument list, so single-emit counts, payload deep-equality, ack
 * presence, and event disjointness are all directly assertable.
 *
 * Deliberate deviations, recorded because they affect how the properties read:
 *
 *  1. Generators are defined locally rather than imported from
 *     public/story-revote.pbt.test.js. That file is itself a test file: importing
 *     it would collect its whole suite a second time inside this file (and it is
 *     not a jsdom file). Only the pure `isFinalizedValue` predicate is imported,
 *     from the production module public/story-revote.js.
 *  2. The export path (Property 35) has no exported entry point. It is driven
 *     through the real #exportMdBtn control and observed by capturing the Blob
 *     handed to URL.createObjectURL inside `downloadFile` — the document the user
 *     would receive, byte for byte.
 *  3. Property 25 needs the *stored* room id and active story id, which are
 *     module-private. They are read live through the finalize chip handler, which
 *     emits `{ roomId: <stored room id>, storyId: <stored active story id> }`, so
 *     the assertion compares the real client state before and after activation
 *     rather than a DOM stand-in for it.
 *  4. jsdom has no layout, so Property 37's "renders no story card" is asserted
 *     as "no story card inside a visible queue section" (both sections carry
 *     `hidden`), alongside the placeholder-visible and sections-hidden clauses.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFinalizedValue } from './story-revote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Iterations every property in this file runs at (design.md "Property test rules"). */
const NUM_RUNS = 100;

const ROOM = 'DELUI01';
const MOD_KEY = 'DELKEY';
const DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];
const FINALIZE_POINTS = ['1', '2', '3', '5', '8', '13'];
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

/** The Story_Placeholder the server writes when no story is active. */
const STORY_PLACEHOLDER = { number: '', title: 'Add Story to Queue', finalPoints: null };

/**
 * A recording stand-in for the Socket.IO client socket. Every `emit` is kept
 * with its event name, first payload, and full argument list so a test can
 * assert emit counts, payload equality, and whether an ack callback was passed.
 */
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
      this.emits.push({
        event,
        payload: args[0],
        args,
        hasAck: args.some((a) => typeof a === 'function'),
      });
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

/** Captured export payloads: the Blobs handed to URL.createObjectURL. */
let capturedBlobs = [];

beforeAll(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  document.body.innerHTML = html
    .replace(/[\s\S]*<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*/i, '');

  window.history.replaceState({}, '', `/room/${ROOM}?mod=${MOD_KEY}`);

  // Same localStorage polyfill public/repro-highlight.test.js uses: the jsdom
  // realm here has no usable localStorage, and app.js reads remembered defaults
  // on import.
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

  // Export observation: record the document handed to `new Blob([...])` inside
  // downloadFile, stub the object-URL calls jsdom does not implement, and keep
  // the anchor click inert so the download attempt never reaches jsdom's
  // unimplemented navigation. The recorded text is the exact export payload.
  const NativeBlob = globalThis.Blob;
  class RecordingBlob extends NativeBlob {
    constructor(parts = [], options = {}) {
      super(parts, options);
      capturedBlobs.push({ text: parts.map((p) => String(p)).join(''), type: options?.type ?? '' });
    }
  }
  globalThis.Blob = RecordingBlob;
  window.Blob = RecordingBlob;
  URL.createObjectURL = () => 'blob:delete-finalized-ui';
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function noopClick() {};

  fakeSocket = createRecordingSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  await import('./app.js');
});

beforeEach(() => {
  // Every property starts from: connected socket, stored room id === ROOM,
  // no toasts, empty emit log.
  fakeSocket.connected = true;
  setClientRoom(ROOM);
  clearToasts();
  capturedBlobs = [];
  fakeSocket.__reset();
});

/* ------------------------------- helpers -------------------------------- */

/**
 * Set the room id held in client state. `room:created` is the client's own
 * entry point for it, so this exercises no test-only seam.
 * @param {string|null|undefined} roomId
 */
function setClientRoom(roomId) {
  if (arguments.length === 0) fakeSocket.__trigger('room:created', {});
  else fakeSocket.__trigger('room:created', { roomId, modKey: MOD_KEY });
}

function clearToasts() {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
}

function toastTexts() {
  return Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent);
}

function broadcast(state) {
  fakeSocket.__trigger('room:state', state);
}

/**
 * A room:state payload with the shape app.js expects, overridable per test.
 * @param {object} [overrides]
 */
function roomState(overrides = {}) {
  return {
    roomId: ROOM,
    myId: 'me',
    mySocketId: 'me',
    youAreModerator: true,
    phase: 'voting',
    deck: DECK,
    users: {},
    story: { ...STORY_PLACEHOLDER },
    storyQueue: [],
    activeStoryId: null,
    ...overrides,
  };
}

const pendingList = () => document.getElementById('queuePendingList');
const doneList = () => document.getElementById('queueDoneList');
const pendingSection = () => document.querySelector('.queueSection[data-section="pending"]');
const doneSection = () => document.querySelector('.queueSection[data-section="done"]');
const emptyAll = () => document.getElementById('queueEmptyAll');

/** Every delete control rendered inside `list`. */
function deleteButtons(list) {
  return Array.from(list.querySelectorAll('button[aria-label="Delete story"]'));
}

/** Every Re-Vote control rendered inside `list`. */
function revoteButtons(list) {
  return Array.from(list.querySelectorAll('button[aria-label="Re-vote story"]'));
}

/** The `.queueNumber` label of every story card in `list`, in render order. */
function cardNumbers(list) {
  return Array.from(list.querySelectorAll('li.queueItem:not(.queueEmptySection) .queueNumber')).map(
    (n) => n.textContent,
  );
}

/** The `.queueNumber` label of every highlighted (active) card, both sections. */
function highlightedNumbers() {
  return Array.from(document.querySelectorAll('#queuePendingList .queueActive, #queueDoneList .queueActive')).map(
    (li) => li.querySelector('.queueNumber')?.textContent ?? '',
  );
}

/**
 * Activate a control the way a user would.
 * @param {HTMLElement} btn
 * @param {'pointer'|'Enter'|' '} method
 */
function activate(btn, method) {
  if (method === 'pointer') {
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return;
  }
  btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: method, bubbles: true, cancelable: true }));
}

/* ------------------------------ generators ------------------------------- */

/** Story ids that survive a trim, so an id is never confused with a blank one. */
function storyIdArb() {
  return fc
    .array(fc.constantFrom(...ID_ALPHABET), { minLength: 1, maxLength: 8 })
    .map((chars) => chars.join(''));
}

/** 1–3 whitespace characters — a blank-but-truthy `finalPoints` (Req 1.10). */
function whitespaceArb() {
  return fc
    .array(fc.constantFrom(' ', '\t', '\n', '\u00a0'), { minLength: 1, maxLength: 3 })
    .map((chars) => chars.join(''));
}

/** A fixed-width, collision-free Jira label so a card is identifiable by text. */
function jiraLabel(index) {
  return `JIRA-${String(index).padStart(3, '0')}`;
}

/**
 * A queue of entries with distinct ids and distinct, fixed-width labels.
 * `finalPointsArb` decides which entries are finalized.
 * @param {{minLength: number, maxLength: number, finalPointsArb: fc.Arbitrary<string|null>}} opts
 */
function queueArb({ minLength, maxLength, finalPointsArb }) {
  return fc
    .uniqueArray(storyIdArb(), { minLength, maxLength })
    .chain((ids) =>
      fc
        .array(finalPointsArb, { minLength: ids.length, maxLength: ids.length })
        .map((points) =>
          ids.map((id, i) => ({
            id,
            number: jiraLabel(i),
            title: `Story-${String(i).padStart(3, '0')}`,
            finalPoints: points[i],
          })),
        ),
    );
}

/** A queue whose every entry is finalized. */
function finalizedQueueArb(minLength, maxLength) {
  return queueArb({ minLength, maxLength, finalPointsArb: fc.constantFrom(...FINALIZE_POINTS) });
}

/**
 * A mixed queue guaranteed to hold at least one finalized entry and, when
 * `minPending` is 1, at least one pending entry.
 */
function mixedQueueArb({ minLength = 2, maxLength = 12, minPending = 1 } = {}) {
  return queueArb({
    minLength,
    maxLength,
    finalPointsArb: fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...FINALIZE_POINTS) },
      { weight: 2, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: whitespaceArb() },
    ),
  }).filter(
    (queue) =>
      queue.some((s) => isFinalizedValue(s.finalPoints)) &&
      (minPending === 0 || queue.some((s) => !isFinalizedValue(s.finalPoints))),
  );
}

/**
 * Read the room id and active story id held in client state.
 *
 * Both are module-private in app.js. The finalize chip handler emits
 * `{ roomId: <stored room id>, storyId: <stored active story id> }` straight
 * from those live variables, so activating an enabled chip is a read of them.
 * Requires the viewer to be the facilitator with `phase === 'revealed'`, a
 * non-null `activeStoryId`, and `story.finalPoints === null`.
 * @returns {{roomId: unknown, activeStoryId: unknown}|null}
 */
function readStoredClientState() {
  const chip = Array.from(document.querySelectorAll('#finalPointsChips .finalChip')).find((c) => !c.disabled);
  if (!chip) return null;
  fakeSocket.__reset();
  chip.click();
  const emit = fakeSocket.__of('storyQueue:finalize')[0];
  fakeSocket.__reset();
  return emit ? { roomId: emit.payload.roomId, activeStoryId: emit.payload.storyId } : null;
}

/* ------------------------------ properties ------------------------------- */

// Feature: clear-revote-finalized-story, Property 23: Delete activation emits exactly one request per activation, for its own card only
describe('Property 23: Delete activation emits exactly one request per activation, for its own card only', () => {
  it('emits one storyQueue:remove per activation for its own story id, ack-free, contained, and never disabled', () => {
    fc.assert(
      fc.property(
        finalizedQueueArb(2, 100),
        fc.nat(),
        fc.constantFrom('pointer', 'Enter', ' '),
        fc.integer({ min: 1, max: 10 }),
        (queue, offset, method, repeats) => {
          clearToasts();
          broadcast(roomState({ storyQueue: queue, activeStoryId: null }));

          const buttons = deleteButtons(doneList());
          expect(buttons.length).toBe(queue.length);

          const index = offset % queue.length;
          const target = queue[index];
          const btn = buttons[index];
          expect(btn.dataset.storyId).toBe(target.id);

          // Anything reaching the enclosing card would be a propagated activation.
          let cardActivations = 0;
          btn.closest('li.queueItem').addEventListener('click', () => {
            cardActivations += 1;
          });

          fakeSocket.__reset();
          for (let i = 0; i < repeats; i += 1) {
            const before = fakeSocket.emits.length;
            activate(btn, method);
            // Emitted synchronously within the activation: exactly one more event.
            expect(fakeSocket.emits.length).toBe(before + 1);
            expect(btn.disabled).toBe(false);
          }

          const emits = fakeSocket.emits;
          expect(emits.length).toBe(repeats);
          emits.forEach((m) => {
            expect(m.event).toBe('storyQueue:remove');
            expect(m.payload).toEqual({ roomId: ROOM, storyId: target.id });
            // No acknowledgement callback argument.
            expect(m.args.length).toBe(1);
            expect(m.hasAck).toBe(false);
          });

          expect(cardActivations).toBe(0);
          expect(toastTexts()).toEqual([]);
          expect(btn.disabled).toBe(false);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: clear-revote-finalized-story, Property 24: The finalized delete control is the pending delete control
describe('Property 24: The finalized delete control is the pending delete control', () => {
  it('emits an identical event name and payload from the finalized card and the pending card', () => {
    const storyIdVariants = fc.oneof(
      storyIdArb(),
      fc.constant(''),
      whitespaceArb(),
      fc.constantFrom('故事-7', 'ストーリー', 'id-🚀-42', 'Ünïcödé'),
    );

    fc.assert(
      fc.property(
        storyIdVariants,
        fc.boolean(),
        fc.constantFrom('valid', 'empty', 'null', 'absent'),
        fc.constantFrom(...FINALIZE_POINTS),
        (id, connected, roomVariant, points) => {
          // Same client state for both paths: same stored room id, same socket.
          if (roomVariant === 'valid') setClientRoom(ROOM);
          else if (roomVariant === 'empty') setClientRoom('');
          else if (roomVariant === 'null') setClientRoom(null);
          else setClientRoom();
          fakeSocket.connected = connected;

          // The same story id on a finalized entry and on a pending entry, so
          // both cards render in one pass under one client state.
          const queue = [
            { id, number: jiraLabel(0), title: 'Story-000', finalPoints: points },
            { id, number: jiraLabel(1), title: 'Story-001', finalPoints: null },
          ];
          broadcast(roomState({ storyQueue: queue, activeStoryId: null }));

          const finalizedBtn = deleteButtons(doneList())[0];
          const pendingBtn = deleteButtons(pendingList())[0];
          expect(finalizedBtn).toBeTruthy();
          expect(pendingBtn).toBeTruthy();

          clearToasts();
          fakeSocket.__reset();
          activate(finalizedBtn, 'pointer');
          const fromFinalized = fakeSocket.emits.slice();
          const toastsAfterFinalized = toastTexts();

          clearToasts();
          fakeSocket.__reset();
          activate(pendingBtn, 'pointer');
          const fromPending = fakeSocket.emits.slice();
          const toastsAfterPending = toastTexts();

          // One request each, no guard suppressing either path.
          expect(fromFinalized.length).toBe(1);
          expect(fromPending.length).toBe(1);

          // Deep-equal in event name and payload.
          expect(fromFinalized[0].event).toBe('storyQueue:remove');
          expect(fromFinalized[0].event).toBe(fromPending[0].event);
          expect(fromFinalized[0].payload).toEqual(fromPending[0].payload);
          expect(Object.keys(fromFinalized[0].payload).sort()).toEqual(['roomId', 'storyId']);

          // The story id passes through unchanged — no client-side validation.
          expect(fromFinalized[0].payload.storyId).toBe(id);
          expect(fromPending[0].payload.storyId).toBe(id);

          // No connectivity check, no room-id check, no ack, no toast either way.
          expect(fromFinalized[0].args.length).toBe(1);
          expect(fromPending[0].args.length).toBe(1);
          expect(toastsAfterFinalized).toEqual([]);
          expect(toastsAfterPending).toEqual([]);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // Leave the shared client state as the other properties expect it.
    fakeSocket.connected = true;
    setClientRoom(ROOM);
  });
});

// Feature: clear-revote-finalized-story, Property 25: Delete activation changes nothing on the client until the broadcast
describe('Property 25: Delete activation changes nothing on the client until the broadcast', () => {
  it('leaves both rendered sections, the stored room id, and the stored active story id untouched', () => {
    fc.assert(
      fc.property(mixedQueueArb({ minLength: 2, maxLength: 10 }), fc.nat(), (queue, offset) => {
        const finalized = queue.filter((s) => isFinalizedValue(s.finalPoints));
        const target = finalized[offset % finalized.length];
        // phase 'revealed' with a non-null active story makes the finalize chips
        // live, which is how the stored room id and active story id are read.
        const active = queue[offset % queue.length];
        broadcast(
          roomState({
            phase: 'revealed',
            storyQueue: queue,
            activeStoryId: active.id,
            story: { number: active.number, title: active.title, finalPoints: null },
          }),
        );

        const storedBefore = readStoredClientState();
        expect(storedBefore).not.toBeNull();
        const pendingBefore = pendingList().innerHTML;
        const doneBefore = doneList().innerHTML;
        const pendingCountBefore = document.getElementById('queuePendingCount').textContent;
        const doneCountBefore = document.getElementById('queueDoneCount').textContent;
        const doneCardsBefore = cardNumbers(doneList()).length;

        clearToasts();
        const btn = deleteButtons(doneList()).find((b) => b.dataset.storyId === target.id);
        expect(btn).toBeTruthy();
        activate(btn, 'pointer');

        // Nothing rendered changed, and no card was optimistically removed.
        expect(pendingList().innerHTML).toBe(pendingBefore);
        expect(doneList().innerHTML).toBe(doneBefore);
        expect(document.getElementById('queuePendingCount').textContent).toBe(pendingCountBefore);
        expect(document.getElementById('queueDoneCount').textContent).toBe(doneCountBefore);
        expect(cardNumbers(doneList()).length).toBe(doneCardsBefore);
        expect(cardNumbers(doneList())).toContain(target.number);

        // Stored room id and active story id are unchanged.
        const storedAfter = readStoredClientState();
        expect(storedAfter).toEqual(storedBefore);

        expect(toastTexts()).toEqual([]);
        expect(btn.disabled).toBe(false);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: clear-revote-finalized-story, Property 26: The two finalized controls emit disjoint events
describe('Property 26: The two finalized controls emit disjoint events', () => {
  it('delete emits only storyQueue:remove and Re-Vote emits only storyQueue:revote', () => {
    fc.assert(
      fc.property(finalizedQueueArb(1, 12), fc.nat(), (queue, offset) => {
        broadcast(roomState({ storyQueue: queue, activeStoryId: null }));

        const index = offset % queue.length;
        const target = queue[index];
        const delBtn = deleteButtons(doneList())[index];
        const revoteBtn = revoteButtons(doneList())[index];
        expect(delBtn.dataset.storyId).toBe(target.id);
        expect(revoteBtn.dataset.storyId).toBe(target.id);

        fakeSocket.__reset();
        activate(delBtn, 'pointer');
        expect(fakeSocket.__of('storyQueue:remove').length).toBe(1);
        expect(fakeSocket.__of('storyQueue:revote').length).toBe(0);
        expect(fakeSocket.emits.length).toBe(1);
        expect(fakeSocket.emits[0].hasAck).toBe(false);

        fakeSocket.__reset();
        activate(revoteBtn, 'pointer');
        expect(fakeSocket.__of('storyQueue:revote').length).toBe(1);
        expect(fakeSocket.__of('storyQueue:remove').length).toBe(0);
        expect(fakeSocket.emits.length).toBe(1);
        expect(fakeSocket.emits[0].payload).toEqual({ roomId: ROOM, storyId: target.id });
        expect(fakeSocket.emits[0].hasAck).toBe(true);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: clear-revote-finalized-story, Property 33: A deleted story disappears from both sections and leaves the rest of the render alone
describe('Property 33: A deleted story disappears from both sections and leaves the rest of the render alone', () => {
  it('drops the removed card from both sections and, for a non-active deletion, leaves Need Estimate identical', () => {
    fc.assert(
      fc.property(
        mixedQueueArb({ minLength: 2, maxLength: 12, minPending: 0 }),
        fc.nat(),
        fc.boolean(),
        fc.constantFrom('removedIsActive', 'otherIsActive', 'noneActive'),
        (queue, offset, youAreModerator, activeKind) => {
          const finalized = queue.filter((s) => isFinalizedValue(s.finalPoints));
          const removed = finalized[offset % finalized.length];
          const remaining = queue.filter((s) => s !== removed);
          expect(remaining.length).toBeGreaterThanOrEqual(1);

          const otherActive = remaining[offset % remaining.length];
          let activeStoryId = null;
          if (activeKind === 'removedIsActive') activeStoryId = removed.id;
          else if (activeKind === 'otherIsActive') activeStoryId = otherActive.id;

          const activeEntry = queue.find((s) => s.id === activeStoryId);
          broadcast(
            roomState({
              youAreModerator,
              storyQueue: queue,
              activeStoryId,
              story: activeEntry
                ? { number: activeEntry.number, title: activeEntry.title, finalPoints: activeEntry.finalPoints }
                : { ...STORY_PLACEHOLDER },
            }),
          );

          const pendingHtmlBefore = pendingList().innerHTML;
          const pendingNumbersBefore = cardNumbers(pendingList());
          const pendingCountBefore = document.getElementById('queuePendingCount').textContent;
          const highlightedBefore = highlightedNumbers();

          // The broadcast the server sends after the delete is applied.
          const removedWasActive = activeKind === 'removedIsActive';
          broadcast(
            roomState({
              youAreModerator,
              storyQueue: remaining,
              activeStoryId: removedWasActive ? null : activeStoryId,
              story: removedWasActive
                ? { ...STORY_PLACEHOLDER }
                : activeEntry
                  ? { number: activeEntry.number, title: activeEntry.title, finalPoints: activeEntry.finalPoints }
                  : { ...STORY_PLACEHOLDER },
            }),
          );

          // Asserted synchronously after the broadcast handler returned: no card
          // for the removed entry in either section, no user interaction, no reload.
          expect(cardNumbers(pendingList())).not.toContain(removed.number);
          expect(cardNumbers(doneList())).not.toContain(removed.number);
          expect(cardNumbers(pendingList()).length + cardNumbers(doneList()).length).toBe(remaining.length);

          if (!removedWasActive) {
            expect(cardNumbers(pendingList())).toEqual(pendingNumbersBefore);
            expect(pendingList().innerHTML).toBe(pendingHtmlBefore);
            expect(document.getElementById('queuePendingCount').textContent).toBe(pendingCountBefore);
            expect(highlightedNumbers()).toEqual(highlightedBefore);
          }
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: clear-revote-finalized-story, Property 34: Deleting the active story reopens the voting controls with nothing selected
describe('Property 34: Deleting the active story reopens the voting controls with nothing selected', () => {
  it('discards the stored deck and chip selections and reopens the voting controls with nothing selected', () => {
    const deckArb = fc
      .subarray(DECK, { minLength: 3, maxLength: DECK.length })
      .filter((deck) => deck.some((v) => v !== '?' && v !== '☕'));

    fc.assert(
      fc.property(
        deckArb,
        fc.nat(),
        fc.nat(),
        mixedQueueArb({ minLength: 2, maxLength: 8, minPending: 1 }),
        (deck, deckPick, chipPick, queue) => {
          const numericDeck = deck.filter((v) => v !== '?' && v !== '☕');
          const deckValue = deck[deckPick % deck.length];
          const chipValue = numericDeck[chipPick % numericDeck.length];

          // The active story is a pending entry, so voting is open on it.
          const active = queue.find((s) => !isFinalizedValue(s.finalPoints));
          const remaining = queue.filter((s) => s !== active);
          const me = { name: 'Me', emoji: '', isModerator: true, connected: true, vote: null };

          const votingState = (vote) =>
            roomState({
              deck,
              phase: 'voting',
              storyQueue: queue,
              activeStoryId: active.id,
              story: { number: active.number, title: active.title, finalPoints: null },
              users: { me: { ...me, vote } },
            });

          // 1) Seed a locally stored deck-card selection by voting.
          broadcast(votingState(null));
          const deckButtons = () => Array.from(document.querySelectorAll('#deck .deckBtn'));
          const votedBtn = deckButtons()[deckPick % deck.length];
          votedBtn.click();
          broadcast(votingState('selected'));
          expect(deckButtons()[deckPick % deck.length].classList.contains('active')).toBe(true);

          // 2) Seed a locally stored final-points chip selection.
          broadcast(
            roomState({
              deck,
              phase: 'revealed',
              storyQueue: queue,
              activeStoryId: active.id,
              story: { number: active.number, title: active.title, finalPoints: null },
              users: { me: { ...me, vote: deckValue } },
            }),
          );
          const chips = () => Array.from(document.querySelectorAll('#finalPointsChips .finalChip'));
          const chip = chips()[chipPick % numericDeck.length];
          expect(chip.textContent).toBe(chipValue);
          expect(chip.disabled).toBe(false);
          chip.click();
          expect(chips().some((c) => c.classList.contains('selected'))).toBe(true);

          // 3) The broadcast that follows deleting the active story.
          broadcast(
            roomState({
              deck,
              phase: 'voting',
              storyQueue: remaining,
              activeStoryId: null,
              story: { ...STORY_PLACEHOLDER },
              users: { me: { ...me, vote: null } },
            }),
          );

          // No active-story highlight in either section.
          expect(highlightedNumbers()).toEqual([]);
          // No cast-vote indicator on any user entry.
          Array.from(document.querySelectorAll('#usersList .ustatus')).forEach((s) => {
            expect(s.textContent).toBe('—');
          });
          // Every voting deck card is rendered DISABLED, and none is selected.
          // Deleting the active story leaves `activeStoryId === null`, so
          // `renderAllComponents` computes `hasActiveStory === false` and
          // `renderDeck` disables every card: there is no story left to vote on.
          // (Contrast with the re-vote case, where the re-voted story BECOMES the
          // active story and the deck therefore stays enabled — that reasoning
          // does not transfer to delete. Do not "fix" this back to enabled.)
          // The absent `active` class is what proves the locally stored deck-card
          // selection (`myVote`) was discarded.
          expect(deckButtons().length).toBe(deck.length);
          deckButtons().forEach((b) => {
            expect(b.disabled).toBe(true);
            expect(b.classList.contains('active')).toBe(false);
          });
          // No final-points chip is selected: the absent `selected` class and the
          // `aria-checked="false"` state prove the locally stored final-points
          // selection (`selectedFinalPoint`) was discarded too.
          chips().forEach((c) => {
            expect(c.classList.contains('selected')).toBe(false);
            expect(c.getAttribute('aria-checked')).toBe('false');
          });
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: clear-revote-finalized-story, Property 35: Export after a delete omits the deleted story and totals the rest
describe('Property 35: Export after a delete omits the deleted story and totals the rest', () => {
  it('omits the deleted entry and reports the sum of the remaining final points', () => {
    fc.assert(
      fc.property(mixedQueueArb({ minLength: 2, maxLength: 10, minPending: 0 }), fc.nat(), (queue, offset) => {
        const finalized = queue.filter((s) => isFinalizedValue(s.finalPoints));
        const removed = finalized[offset % finalized.length];
        const remaining = queue.filter((s) => s !== removed);

        broadcast(roomState({ storyQueue: queue, activeStoryId: null }));
        broadcast(roomState({ storyQueue: remaining, activeStoryId: null }));

        capturedBlobs = [];
        const mdBtn = document.getElementById('exportMdBtn');
        expect(mdBtn.disabled).toBe(false);
        mdBtn.click();

        expect(capturedBlobs.length).toBe(1);
        const text = capturedBlobs[0].text;

        // The deleted story appears nowhere in the export.
        expect(text).not.toContain(removed.number);
        expect(text).not.toContain(removed.title);

        // Every remaining story does, once each, and the row count matches.
        remaining.forEach((s) => {
          expect(text).toContain(s.number);
        });
        const rows = text.split('\n').filter((line) => /^\| \d+ \|/.test(line));
        expect(rows.length).toBe(remaining.length);

        // Points total: the sum over remaining entries with a non-blank,
        // numeric finalPoints, and 0 when there is none (Req 1.10, 11.4).
        const expectedTotal = remaining.reduce((sum, s) => {
          if (!isFinalizedValue(s.finalPoints)) return sum;
          const n = Number(s.finalPoints);
          return Number.isFinite(n) ? sum + n : sum;
        }, 0);
        const totalMatch = text.match(/\*\*Total Points:\*\*\s*([0-9.]+)/);
        expect(totalMatch).not.toBeNull();
        expect(Number(totalMatch[1])).toBe(expectedTotal);
        expect(text).toContain(`**Stories:** ${remaining.length}`);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: clear-revote-finalized-story, Property 37: Deleting the last entry renders the empty-queue placeholder
describe('Property 37: Deleting the last entry renders the empty-queue placeholder', () => {
  it('shows the whole-queue placeholder, hides both sections, and renders no story card', () => {
    fc.assert(
      fc.property(finalizedQueueArb(1, 1), fc.boolean(), fc.boolean(), (queue, youAreModerator, wasActive) => {
        const only = queue[0];
        broadcast(
          roomState({
            youAreModerator,
            storyQueue: queue,
            activeStoryId: wasActive ? only.id : null,
            story: wasActive
              ? { number: only.number, title: only.title, finalPoints: only.finalPoints }
              : { ...STORY_PLACEHOLDER },
          }),
        );
        expect(cardNumbers(doneList())).toEqual([only.number]);
        expect(emptyAll().hidden).toBe(true);

        // The broadcast after the last entry is deleted.
        broadcast(
          roomState({
            youAreModerator,
            storyQueue: [],
            activeStoryId: null,
            story: { ...STORY_PLACEHOLDER },
          }),
        );

        expect(emptyAll().hidden).toBe(false);
        expect(pendingSection().hidden).toBe(true);
        expect(doneSection().hidden).toBe(true);
        // jsdom has no layout, so "no story card" is read as no story card in a
        // visible section — both sections carry `hidden`.
        expect(document.querySelectorAll('.queueSection:not([hidden]) li.queueItem').length).toBe(0);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
