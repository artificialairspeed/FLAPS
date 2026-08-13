// @vitest-environment jsdom
/**
 * Property-Based Tests — queue render for re-vote / delete on finalized cards
 * Spec: clear-revote-finalized-story (Tasks 8.1 – 8.8)
 *
 * These eight properties drive the *real* client through the established jsdom
 * harness (`public/app.unit.test.js`, `public/repro-highlight.test.js`): inject
 * `index.html`'s body, stub `globalThis.io` with a controllable fake socket,
 * `await import('./app.js')`, then push generated room state in with
 * `fakeSocket.__trigger('room:state', state)` and assert on the rendered
 * `#queuePendingList` / `#queueDoneList`. Nothing is mocked below the socket
 * boundary — every assertion is against DOM the production render path built.
 *
 * Properties implemented here, one test each at 100 iterations:
 *   1  Finalized card action area is determined by viewer role
 *   2  One control per card, bound to its own story
 *   3  Role change is reflected in the same render pass
 *   4  A blank final estimate is not a finalized story
 *   13 A cleared story renders as pending on every client
 *   14 Pending order and active highlight follow the active story
 *   15 Section counts equal cards rendered
 *   22 Re-finalizing after a re-vote returns the story to done with the newest value
 *
 * Tasks 9.1 – 9.5 add five more to the same harness, driving *activation* and the
 * post-re-vote voting controls rather than the queue render alone:
 *   5  Activation emits exactly one request for the activated card
 *   6  Guarded activations emit nothing and change nothing
 *   7  No optimistic update, and a rejected request stays retryable
 *   16 A null final estimate reopens voting controls with nothing selected
 *   17 Export totals exclude re-voted stories
 *
 * Generators are defined locally rather than imported from
 * `public/story-revote.pbt.test.js`. That file is itself a test file: importing
 * it would re-register its ten generator self-check suites inside this jsdom
 * environment (duplicate runs, including two 400-sample coverage scans). The
 * generators below are also shaped for the render path specifically — string
 * `number`/`title` on every entry, and identity-bearing titles where a property
 * has to map a rendered card back to its queue entry.
 *
 * `isFinalizedValue` IS imported from the production module `./story-revote.js`,
 * so the tests and the renderer share one definition of "finalized".
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFinalizedValue } from './story-revote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOM = 'REVOTEUI';
const NUM_RUNS = 100;
const DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];
const POINTS = ['1', '2', '3', '5', '8', '13'];

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

function createFakeSocket() {
  const handlers = {};
  return {
    connected: true,
    sent: [],
    on(event, cb) { (handlers[event] ||= []).push(cb); },
    off(event) { delete handlers[event]; },
    emit(event, payload, ack) { this.sent.push({ event, payload, ack }); },
    __trigger(event, ...args) { (handlers[event] || []).forEach((cb) => cb(...args)); },
  };
}

let fakeSocket;

beforeAll(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  const bodyInner = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
  document.body.innerHTML = bodyInner;
  window.history.replaceState({}, '', `/room/${ROOM}?mod=KEY`);

  if (!globalThis.localStorage) {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    };
    window.localStorage = globalThis.localStorage;
  }

  fakeSocket = createFakeSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  await import('./app.js');
});

/* ------------------------------------------------------------------ *
 * Render helpers
 * ------------------------------------------------------------------ */

/** A `room:state` payload in the shape `makeRoomState` produces. */
function makeState(queue, { youAreModerator, activeStoryId = null, phase = 'voting' } = {}) {
  const active = queue.find((entry) => entry.id === activeStoryId) || null;
  return {
    deck: [...DECK],
    phase,
    story: active
      ? { number: active.number, title: active.title, finalPoints: active.finalPoints }
      : { number: '', title: 'Add Story to Queue', finalPoints: null },
    storyQueue: queue.map((entry) => ({ ...entry })),
    activeStoryId,
    users: {},
    youAreModerator,
    myId: 'me',
  };
}

/**
 * Push one broadcast through the real client. The lists are emptied first
 * because `renderQueue` returns early for a zero-length queue, which would
 * otherwise leave the previous iteration's cards standing.
 */
function render(state) {
  document.getElementById('queuePendingList').innerHTML = '';
  document.getElementById('queueDoneList').innerHTML = '';
  fakeSocket.__trigger('room:state', state);
}

/** The story cards in a section, excluding the per-section empty-state row. */
function cards(listId) {
  return [
    ...document
      .getElementById(listId)
      .querySelectorAll('li.queueItem:not(.queueEmptySection)'),
  ];
}

const pendingCards = () => cards('queuePendingList');
const doneCards = () => cards('queueDoneList');

const actionsOf = (li) => li.querySelector('.queueActions');
const titleRowOf = (li) => li.querySelector('.queueTitleRow');
const titleOf = (li) => li.querySelector('.queueTitle').textContent;

function buttonsWithText(root, text) {
  return [...root.querySelectorAll('button')].filter((b) => b.textContent === text);
}

const revoteControls = (root) => [...root.querySelectorAll('button.queueRevoteBtn')];
const deleteControls = (root) => buttonsWithText(root, '❌');
const editControls = (root) => buttonsWithText(root, '✏️');
const voteControls = (root) => buttonsWithText(root, 'Vote');
const pills = (root) => [...root.querySelectorAll('.queueFinalChip')];

const countText = (id) => document.getElementById(id).textContent;

/* ------------------------------------------------------------------ *
 * Generators
 * ------------------------------------------------------------------ */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function storyIdArb() {
  return fc
    .array(fc.constantFrom(...ID_ALPHABET), { minLength: 4, maxLength: 6 })
    .map((chars) => `s-${chars.join('')}`);
}

/** Truthy but not a finalized value (Requirement 1.10). */
function whitespaceArb() {
  return fc.constantFrom(' ', '  ', '\t', '\n', ' \t ', '\u00a0');
}

/** Blank final estimates: empty as well as whitespace-only (Requirement 1.10). */
function blankFinalPointsArb() {
  return fc.oneof(fc.constant(''), whitespaceArb());
}

function storyTextArb() {
  return fc.oneof(
    { weight: 3, arbitrary: fc.string({ maxLength: 20 }) },
    { weight: 1, arbitrary: fc.constant('') },
    {
      weight: 1,
      arbitrary: fc.constantFrom('ストーリー 42', 'Café ☕ flow', '  padded  ', '🚀 launch', 'Ω-1'),
    }
  );
}

function finalPointsArb() {
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(null) },
    { weight: 2, arbitrary: fc.constantFrom(...POINTS) },
    { weight: 1, arbitrary: blankFinalPointsArb() }
  );
}

function entryArb() {
  return fc.record({
    id: storyIdArb(),
    number: storyTextArb(),
    title: storyTextArb(),
    finalPoints: finalPointsArb(),
  });
}

/** A queue with unique ids. */
function queueArb({ minLength = 1, maxLength = 8 } = {}) {
  return fc.uniqueArray(entryArb(), {
    minLength,
    maxLength,
    selector: (entry) => entry.id,
  });
}

/**
 * A queue whose titles carry their own id, so a rendered card can be mapped
 * back to the entry it was built from.
 */
function titledQueueArb({ minLength = 1, maxLength = 8 } = {}) {
  return fc
    .uniqueArray(
      fc.record({ id: storyIdArb(), number: storyTextArb(), finalPoints: finalPointsArb() }),
      { minLength, maxLength, selector: (entry) => entry.id }
    )
    .map((entries) => entries.map((entry) => ({ ...entry, title: `T-${entry.id}` })));
}

const idFromTitle = (title) => title.slice(2);

/**
 * How a run picks `activeStoryId`: nothing active, an entry of the rendered
 * queue, or an id that matches no entry (Requirement 6.9).
 */
function activeSelectorArb() {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant({ kind: 'none' }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant('index'), pick: fc.nat({ max: 99 }) }) },
    { weight: 1, arbitrary: fc.constant({ kind: 'unknown' }) }
  );
}

function resolveActive(selector, queue) {
  if (selector.kind === 'none' || queue.length === 0) return null;
  if (selector.kind === 'unknown') return 's-matches-nothing';
  return queue[selector.pick % queue.length].id;
}

/** Force at least `n` finalized entries so a claim about finalized cards is not vacuous. */
function withFinalizedEntries(queue, n) {
  const result = queue.map((entry) => ({ ...entry }));
  let have = result.filter((entry) => isFinalizedValue(entry.finalPoints)).length;
  for (let i = 0; i < result.length && have < n; i += 1) {
    if (!isFinalizedValue(result[i].finalPoints)) {
      result[i].finalPoints = POINTS[i % POINTS.length];
      have += 1;
    }
  }
  return result;
}

/**
 * A base queue plus an optional index to delete from it. Rendering the base
 * queue and then the reduced queue makes the asserted render a *post-delete*
 * render, which is what carries Requirements 11.2 and 11.3 — the claim is the
 * same universal claim, applied to a queue that has just lost an entry.
 */
function withOptionalRemovalArb(queueArbitrary) {
  return queueArbitrary.chain((queue) =>
    fc.record({
      queue: fc.constant(queue),
      removeIndex: fc.option(fc.nat({ max: queue.length - 1 }), { nil: null }),
    })
  );
}

const dropIndex = (queue, index) =>
  index === null ? queue : queue.filter((_, i) => i !== index);

/* ------------------------------------------------------------------ *
 * Task 8.1
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 1: Finalized card action area is determined by viewer role
describe('Property 1: Finalized card action area is determined by viewer role', () => {
  it('renders [pill, Delete, Re-Vote] for a facilitator and [pill] for a participant, on any queue including one that has just had an entry deleted', () => {
    fc.assert(
      fc.property(
        // Two finalized entries in the base queue, so at least one survives
        // whichever index the removal step drops (Requirement 11.3 needs
        // 1..100 remaining finalized entries).
        withOptionalRemovalArb(queueArb({ minLength: 2, maxLength: 8 }).map((q) => withFinalizedEntries(q, 2))),
        fc.boolean(),
        activeSelectorArb(),
        ({ queue, removeIndex }, youAreModerator, activeSelector) => {
          const finalQueue = dropIndex(queue, removeIndex);
          const activeStoryId = resolveActive(activeSelector, finalQueue);

          // The post-delete case renders the pre-delete queue first, so the
          // asserted render is the one that follows a removal.
          if (removeIndex !== null) {
            render(makeState(queue, { youAreModerator, activeStoryId }));
          }
          render(makeState(finalQueue, { youAreModerator, activeStoryId }));

          const finalized = finalQueue.filter((entry) => isFinalizedValue(entry.finalPoints));
          const done = doneCards();
          expect(done.length).toBe(finalized.length);
          expect(done.length).toBeGreaterThanOrEqual(1);

          for (const li of done) {
            const actions = actionsOf(li);
            const children = [...actions.children];

            // No Vote and no edit control reaches a finalized card, either role.
            expect(voteControls(li)).toHaveLength(0);
            expect(editControls(li)).toHaveLength(0);

            // The final estimate chip leads the action row: exactly one per
            // finalized card, first in the action area and never in the title
            // row, for either role. It is formatted as the results-area "Final"
            // metric chip (.metricChip.isFinal).
            expect(pills(li)).toHaveLength(1);
            expect(pills(titleRowOf(li))).toHaveLength(0);
            const pill = pills(actions)[0];
            expect(pill).toBeDefined();
            expect(pill).toBe(children[0]);
            expect(pill.previousElementSibling).toBeNull();
            expect(pill.classList.contains('metricChip')).toBe(true);
            expect(pill.classList.contains('isFinal')).toBe(true);

            if (youAreModerator) {
              expect(children).toHaveLength(3);

              const del = children[1];
              expect(del.tagName).toBe('BUTTON');
              expect(del.type).toBe('button');
              expect(del.textContent).toBe('❌');
              expect(del.getAttribute('aria-label')).toBe('Delete story');
              expect(del.disabled).toBe(false);

              const revote = children[2];
              expect(revote.tagName).toBe('BUTTON');
              expect(revote.type).toBe('button');
              expect(revote.textContent).toBe('Re-Vote');
              expect(revote.getAttribute('aria-label')).toBe('Re-vote story');
              expect(revote.disabled).toBe(false);

              expect(deleteControls(li)).toHaveLength(1);
              expect(revoteControls(li)).toHaveLength(1);
            } else {
              // Participants get the chip only — no controls.
              expect(children).toHaveLength(1);
              expect(revoteControls(li)).toHaveLength(0);
              expect(deleteControls(li)).toHaveLength(0);
            }
          }

          // Pending cards carry no Re-Vote control and keep their existing set.
          for (const li of pendingCards()) {
            expect(revoteControls(li)).toHaveLength(0);
            const children = [...actionsOf(li).children];
            if (youAreModerator) {
              expect(children).toHaveLength(3);
              expect(children[0].textContent).toBe('❌');
              expect(children[1].textContent).toBe('✏️');
              expect(children[2].textContent).toBe('Vote');
            } else {
              expect(children).toHaveLength(0);
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.2
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 2: One control per card, bound to its own story
describe('Property 2: One control per card, bound to its own story', () => {
  it('renders one control per finalized card, each carrying the id of the entry on its own card', () => {
    fc.assert(
      fc.property(
        titledQueueArb({ minLength: 2, maxLength: 100 }).map((queue) =>
          // Every entry finalized, so the Estimate Done section holds 2..100 cards.
          queue.map((entry, i) => ({ ...entry, finalPoints: POINTS[i % POINTS.length] }))
        ),
        (queue) => {
          render(makeState(queue, { youAreModerator: true }));

          const done = doneCards();
          expect(done.length).toBe(queue.length);
          expect(done.length).toBeGreaterThanOrEqual(2);

          const list = document.getElementById('queueDoneList');
          expect(revoteControls(list)).toHaveLength(queue.length);
          expect(deleteControls(list)).toHaveLength(queue.length);

          for (const li of done) {
            const ownId = idFromTitle(titleOf(li));
            expect(queue.some((entry) => entry.id === ownId)).toBe(true);

            const revote = revoteControls(li);
            expect(revote).toHaveLength(1);
            expect(revote[0].dataset.storyId).toBe(ownId);

            const del = deleteControls(li);
            expect(del).toHaveLength(1);
            expect(del[0].dataset.storyId).toBe(ownId);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.3
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 3: Role change is reflected in the same render pass
describe('Property 3: Role change is reflected in the same render pass', () => {
  it('adds or removes both finalized controls on the broadcast that flips youAreModerator, with no page reload', () => {
    fc.assert(
      fc.property(
        queueArb({ minLength: 1, maxLength: 8 }).map((q) => withFinalizedEntries(q, 1)),
        fc.boolean(),
        activeSelectorArb(),
        (queue, startsAsModerator, activeSelector) => {
          const activeStoryId = resolveActive(activeSelector, queue);
          const finalizedCount = queue.filter((entry) => isFinalizedValue(entry.finalPoints)).length;
          expect(finalizedCount).toBeGreaterThanOrEqual(1);

          const list = document.getElementById('queueDoneList');
          const expectControls = (moderator) => {
            expect(revoteControls(list)).toHaveLength(moderator ? finalizedCount : 0);
            expect(deleteControls(list)).toHaveLength(moderator ? finalizedCount : 0);
            for (const li of doneCards()) {
              expect(revoteControls(li)).toHaveLength(moderator ? 1 : 0);
              expect(deleteControls(li)).toHaveLength(moderator ? 1 : 0);
            }
          };

          render(makeState(queue, { youAreModerator: startsAsModerator, activeStoryId }));
          expectControls(startsAsModerator);

          // A reload would blow this marker away along with the rest of the document.
          const marker = `pbt-${finalizedCount}-${startsAsModerator}`;
          document.body.dataset.revoteUiMarker = marker;

          render(makeState(queue, { youAreModerator: !startsAsModerator, activeStoryId }));
          expectControls(!startsAsModerator);
          expect(document.body.dataset.revoteUiMarker).toBe(marker);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.4
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 4: A blank final estimate is not a finalized story
describe('Property 4: A blank final estimate is not a finalized story', () => {
  it('renders an empty or whitespace-only finalPoints entry in Need Estimate with no pill and no Re-Vote control', () => {
    fc.assert(
      fc.property(
        titledQueueArb({ minLength: 1, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        fc.array(blankFinalPointsArb(), { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        activeSelectorArb(),
        (base, blankFlags, blankValues, youAreModerator, activeSelector) => {
          // At least one entry is forced blank so the claim is never vacuous.
          const queue = base.map((entry, i) => {
            const blank = i === 0 || blankFlags[i % blankFlags.length];
            return blank
              ? { ...entry, finalPoints: blankValues[i % blankValues.length] }
              : entry;
          });
          const blankIds = queue
            .filter((entry) => entry.finalPoints !== null && String(entry.finalPoints).trim() === '')
            .map((entry) => entry.id);
          expect(blankIds.length).toBeGreaterThanOrEqual(1);

          render(makeState(queue, { youAreModerator, activeStoryId: resolveActive(activeSelector, queue) }));

          const pendingIds = pendingCards().map((li) => idFromTitle(titleOf(li)));
          const doneIds = doneCards().map((li) => idFromTitle(titleOf(li)));

          for (const id of blankIds) {
            expect(pendingIds).toContain(id);
            expect(doneIds).not.toContain(id);

            const li = pendingCards().find((card) => idFromTitle(titleOf(card)) === id);
            expect(pills(li)).toHaveLength(0);
            expect(revoteControls(li)).toHaveLength(0);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.5
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 13: A cleared story renders as pending on every client
describe('Property 13: A cleared story renders as pending on every client', () => {
  it('moves a story whose finalPoints became null into Need Estimate, with no pill and no Re-Vote control, for either viewer role', () => {
    fc.assert(
      fc.property(
        titledQueueArb({ minLength: 1, maxLength: 8 }),
        fc.nat({ max: 99 }),
        fc.constantFrom(...POINTS),
        fc.boolean(),
        (base, pick, points, youAreModerator) => {
          const targetIndex = pick % base.length;
          const target = base[targetIndex];

          // Before: the target is finalized and sits in Estimate Done.
          const before = base.map((entry, i) =>
            i === targetIndex ? { ...entry, finalPoints: points } : entry
          );
          render(makeState(before, { youAreModerator, activeStoryId: target.id }));
          expect(doneCards().map((li) => idFromTitle(titleOf(li)))).toContain(target.id);

          // After: the re-vote broadcast clears finalPoints and makes it active.
          const after = base.map((entry, i) =>
            i === targetIndex ? { ...entry, finalPoints: null } : entry
          );
          render(makeState(after, { youAreModerator, activeStoryId: target.id }));

          const pendingIds = pendingCards().map((li) => idFromTitle(titleOf(li)));
          const doneIds = doneCards().map((li) => idFromTitle(titleOf(li)));
          expect(pendingIds).toContain(target.id);
          expect(doneIds).not.toContain(target.id);

          const li = pendingCards().find((card) => idFromTitle(titleOf(card)) === target.id);
          expect(pills(li)).toHaveLength(0);
          expect(revoteControls(li)).toHaveLength(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.6
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 14: Pending order and active highlight follow the active story
describe('Property 14: Pending order and active highlight follow the active story', () => {
  it('pins the active pending story first, highlights exactly that card and no card otherwise, and disables only its Vote control', () => {
    fc.assert(
      fc.property(
        titledQueueArb({ minLength: 1, maxLength: 10 }),
        fc.boolean(),
        activeSelectorArb(),
        (queue, youAreModerator, activeSelector) => {
          const activeStoryId = resolveActive(activeSelector, queue);
          render(makeState(queue, { youAreModerator, activeStoryId }));

          const pending = queue.filter((entry) => !isFinalizedValue(entry.finalPoints));
          const activePending = pending.find((entry) => entry.id === activeStoryId) || null;

          // Active story first when it is pending, otherwise pure queue order.
          const expectedOrder = activePending
            ? [activePending.id, ...pending.filter((e) => e.id !== activePending.id).map((e) => e.id)]
            : pending.map((e) => e.id);
          expect(pendingCards().map((li) => idFromTitle(titleOf(li)))).toEqual(expectedOrder);

          // Highlight: exactly the active pending card, and no card otherwise —
          // a finalized active story gets none (Requirement 6.9).
          const highlighted = [
            ...document.getElementById('queuePendingList').querySelectorAll('.queueActive'),
            ...document.getElementById('queueDoneList').querySelectorAll('.queueActive'),
          ];
          if (activePending) {
            expect(highlighted).toHaveLength(1);
            expect(idFromTitle(titleOf(highlighted[0]))).toBe(activePending.id);
          } else {
            expect(highlighted).toHaveLength(0);
          }

          // Vote controls exist for the facilitator only. The clause is over
          // Pending_Story cards, which the glossary defines as entries whose
          // finalPoints is null; blank-but-truthy values are Property 4's
          // subject and are excluded here.
          if (youAreModerator) {
            for (const li of pendingCards()) {
              const id = idFromTitle(titleOf(li));
              const entry = queue.find((e) => e.id === id);
              if (entry.finalPoints !== null) continue;
              const vote = voteControls(li);
              expect(vote).toHaveLength(1);
              expect(vote[0].disabled).toBe(id === activeStoryId);
            }
          } else {
            expect(voteControls(document.getElementById('queuePendingList'))).toHaveLength(0);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.7
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 15: Section counts equal cards rendered
describe('Property 15: Section counts equal cards rendered', () => {
  it('sets each section count to the number of story cards it rendered, on untouched queues and on queues that have just had an entry deleted', () => {
    fc.assert(
      fc.property(
        withOptionalRemovalArb(queueArb({ minLength: 2, maxLength: 10 })),
        fc.boolean(),
        activeSelectorArb(),
        ({ queue, removeIndex }, youAreModerator, activeSelector) => {
          const finalQueue = dropIndex(queue, removeIndex);
          const activeStoryId = resolveActive(activeSelector, finalQueue);

          if (removeIndex !== null) {
            render(makeState(queue, { youAreModerator, activeStoryId }));
          }
          render(makeState(finalQueue, { youAreModerator, activeStoryId }));

          const pendingRendered = pendingCards().length;
          const doneRendered = doneCards().length;

          expect(countText('queuePendingCount')).toBe(`(${pendingRendered})`);
          expect(countText('queueDoneCount')).toBe(`(${doneRendered})`);

          // The counts are integers, 0 when a section rendered no story cards.
          expect(Number.isInteger(pendingRendered)).toBe(true);
          expect(Number.isInteger(doneRendered)).toBe(true);
          expect(pendingRendered + doneRendered).toBe(finalQueue.length);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 8.8
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 22: Re-finalizing after a re-vote returns the story to done with the newest value
describe('Property 22: Re-finalizing after a re-vote returns the story to done with the newest value', () => {
  it('returns a re-finalized story to Estimate Done with a pill carrying the most recent points value', () => {
    fc.assert(
      fc.property(
        titledQueueArb({ minLength: 1, maxLength: 8 }),
        fc.nat({ max: 99 }),
        fc
          .tuple(fc.constantFrom(...POINTS), fc.constantFrom(...POINTS))
          .filter(([first, second]) => first !== second),
        fc.boolean(),
        (base, pick, [firstPoints, secondPoints], youAreModerator) => {
          const targetIndex = pick % base.length;
          const target = base[targetIndex];
          const withPoints = (points, activeStoryId) =>
            makeState(
              base.map((entry, i) => (i === targetIndex ? { ...entry, finalPoints: points } : entry)),
              { youAreModerator, activeStoryId, phase: points === null ? 'voting' : 'revealed' }
            );

          // finalize(first) -> re-vote -> finalize(second)
          render(withPoints(firstPoints, target.id));
          render(withPoints(null, target.id));
          expect(pendingCards().map((li) => idFromTitle(titleOf(li)))).toContain(target.id);

          render(withPoints(secondPoints, target.id));

          const doneIds = doneCards().map((li) => idFromTitle(titleOf(li)));
          const pendingIds = pendingCards().map((li) => idFromTitle(titleOf(li)));
          expect(doneIds).toContain(target.id);
          expect(pendingIds).not.toContain(target.id);

          const li = doneCards().find((card) => idFromTitle(titleOf(card)) === target.id);
          const chips = pills(li);
          expect(chips).toHaveLength(1);
          expect(chips[0].querySelector('.queueFinalChipValue').textContent).toBe(secondPoints);
          expect(chips[0].getAttribute('aria-label')).toBe(`Final estimate: ${secondPoints}`);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
/* ================================================================== *
 * Tasks 9.1 – 9.5: activation and voting-control properties
 *
 * These five reuse the harness above — same injected `index.html` body, same
 * fake socket, same single `await import('./app.js')` — and add only what
 * activation needs on top of it:
 *
 *  - The fake socket already keeps the ack callback (`emit(event, payload, ack)`
 *    pushes `{ event, payload, ack }`), so a rejection can be replayed by
 *    calling the captured `ack` with `{ ok: false, reason }`. `resetSent()` and
 *    `sentOf()` below are the only additions to it.
 *  - `probeStored()` reads the room id and active story id held in client
 *    state. Both are module-private in `app.js`; the finalize chip handler emits
 *    `{ roomId: <stored room id>, storyId: <stored active story id> }` straight
 *    from those live variables, so activating an enabled chip *is* a read of
 *    them. It needs the facilitator, `phase === 'revealed'`, a non-null
 *    `activeStoryId`, `story.finalPoints === null`, a truthy stored room id, and
 *    a connected socket — which is why Property 6 lifts its blocking condition
 *    before taking the second reading.
 *  - `setClientRoom()` goes through the client's own `room:created` entry point,
 *    so no test-only seam is used to change the stored room id.
 * ================================================================== */

const MOD_KEY = 'KEY'; // matches the `?mod=KEY` the harness lands on

/** The three guard toasts, character for character (Requirements 2.3, 2.4, 2.8). */
const TOAST_NO_ID = 'Could not identify the story to re-vote';
const TOAST_NO_ROOM = 'Join a room first';
const TOAST_NOT_CONNECTED = 'Not connected to server';

/** The fallback toast when a rejection carries no reason (Requirement 2.7). */
const TOAST_REVOTE_FAILED = 'Re-vote failed';

const resetSent = () => { fakeSocket.sent = []; };
const sentOf = (event) => fakeSocket.sent.filter((m) => m.event === event);

const clearToasts = () => { document.querySelectorAll('.toast').forEach((t) => t.remove()); };
const toastTexts = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent);

/** Set the room id held in client state through the client's own event. */
function setClientRoom(roomId) {
  fakeSocket.__trigger('room:created', { roomId, modKey: MOD_KEY });
}

/**
 * Activate a control the way a user would: a real pointer click, or Enter /
 * Space while it holds focus (Requirement 2.1).
 */
function activate(btn, method) {
  if (method === 'pointer') {
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return;
  }
  btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: method, bubbles: true, cancelable: true }));
}

/**
 * Read `{ roomId, storyId }` out of client state via the finalize chip handler.
 * Returns `null` when no enabled chip is rendered or the handler's own guards
 * stop it before the emit.
 */
function probeStored() {
  const chip = [...document.querySelectorAll('#finalPointsChips .finalChip')].find((c) => !c.disabled);
  if (!chip) return null;
  resetSent();
  chip.click();
  const emitted = sentOf('storyQueue:finalize')[0];
  resetSent();
  return emitted ? { roomId: emitted.payload.roomId, storyId: emitted.payload.storyId } : null;
}

/** A snapshot of everything the queue render produced. */
function queueSnapshot() {
  return {
    pending: document.getElementById('queuePendingList').innerHTML,
    done: document.getElementById('queueDoneList').innerHTML,
    pendingCount: countText('queuePendingCount'),
    doneCount: countText('queueDoneCount'),
  };
}

/** A fixed-width, collision-free Jira label, so a card is findable by text. */
const jiraLabel = (i) => `JIRA-${String(i).padStart(3, '0')}`;
const storyLabel = (i) => `Story-${String(i).padStart(3, '0')}`;

/**
 * A queue of entries with unique ids and distinct, fixed-width `number` /
 * `title` labels, so a rendered card maps back to its entry by label even when
 * the entry's id is blank (which Property 6 needs).
 */
function labelledQueueArb({ minLength = 1, maxLength = 8, finalPointsArb = fc.constantFrom(...POINTS) } = {}) {
  return fc.uniqueArray(storyIdArb(), { minLength, maxLength }).chain((ids) =>
    fc
      .array(finalPointsArb, { minLength: ids.length, maxLength: ids.length })
      .map((points) =>
        ids.map((id, i) => ({ id, number: jiraLabel(i), title: storyLabel(i), finalPoints: points[i] }))
      )
  );
}

/** The card in `listId` whose `.queueNumber` label is `number`. */
function cardByNumber(listId, number) {
  return cards(listId).find((li) => li.querySelector('.queueNumber')?.textContent === number);
}

/* ------------------------------------------------------------------ *
 * Task 9.1
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 5: Activation emits exactly one request for the activated card
// **Validates: Requirements 2.1, 2.2, 2.6**
describe('Property 5: Activation emits exactly one request for the activated card', () => {
  it('emits exactly one storyQueue:revote and no other socket event per activation, carrying the stored room id and that card\'s story id, synchronously and without propagating', () => {
    fc.assert(
      fc.property(
        labelledQueueArb({ minLength: 1, maxLength: 8 }),
        fc.nat({ max: 99 }),
        fc.constantFrom('pointer', 'Enter', ' '),
        fc.integer({ min: 1, max: 5 }),
        activeSelectorArb(),
        (queue, pick, method, repeats, activeSelector) => {
          fakeSocket.connected = true;
          setClientRoom(ROOM);
          clearToasts();

          render(makeState(queue, { youAreModerator: true, activeStoryId: resolveActive(activeSelector, queue) }));

          // Every entry is finalized, so every card carries a Re-Vote control.
          const done = doneCards();
          expect(done.length).toBe(queue.length);

          const index = pick % queue.length;
          const target = queue[index];
          const li = cardByNumber('queueDoneList', target.number);
          expect(li).toBeTruthy();
          const btn = revoteControls(li)[0];
          expect(btn.dataset.storyId).toBe(target.id);

          // Anything reaching the enclosing card is a propagated activation.
          let cardActivations = 0;
          li.addEventListener('click', () => { cardActivations += 1; });

          resetSent();
          for (let i = 0; i < repeats; i += 1) {
            const before = fakeSocket.sent.length;
            activate(btn, method);
            // Synchronously within the activation: exactly one more socket event.
            expect(fakeSocket.sent.length).toBe(before + 1);
          }

          expect(fakeSocket.sent).toHaveLength(repeats);
          for (const message of fakeSocket.sent) {
            // Exactly one request, and no other socket event of any name.
            expect(message.event).toBe('storyQueue:revote');
            expect(message.payload).toEqual({ roomId: ROOM, storyId: target.id });
            expect(Object.keys(message.payload).sort()).toEqual(['roomId', 'storyId']);
            // The request carries an ack callback (Requirement 2.7's channel).
            expect(typeof message.ack).toBe('function');
          }

          // Only the activated card's own id was requested, once per activation.
          expect(sentOf('storyQueue:revote')).toHaveLength(repeats);
          expect(cardActivations).toBe(0);
          expect(toastTexts()).toEqual([]);
          expect(btn.disabled).toBe(false);
          return true;
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 9.2
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 6: Guarded activations emit nothing and change nothing
// **Validates: Requirements 2.3, 2.4, 2.8**
describe('Property 6: Guarded activations emit nothing and change nothing', () => {
  it('emits no request, shows the toast matching the first failing guard, and leaves the rendered queue and the stored room and active story ids unchanged', () => {
    // `requestRevote` guards in the order id -> room -> connection, and each
    // returns before any emit, so when more than one condition holds the first
    // in that order is the one observed (Requirements 2.3, 2.4, 2.8).
    const conditionsArb = fc
      .record({
        blankId: fc.boolean(),
        blankRoom: fc.boolean(),
        disconnected: fc.boolean(),
      })
      .filter((c) => c.blankId || c.blankRoom || c.disconnected);

    fc.assert(
      fc.property(
        // A finalized target card plus one pending entry to be the active story,
        // which is what makes the stored-state reading possible.
        labelledQueueArb({ minLength: 2, maxLength: 6 }),
        fc.nat({ max: 99 }),
        conditionsArb,
        // Blank story ids on the card: absent as well as empty and whitespace-only.
        fc.oneof(fc.constant(undefined), fc.constant(null), fc.constant(''), whitespaceArb()),
        // "No room id in client state": empty, null, and absent alike.
        fc.oneof(fc.constant(''), fc.constant(null), fc.constant(undefined)),
        fc.constantFrom('pointer', 'Enter', ' '),
        (base, pick, conditions, blankId, blankRoom, method) => {
          fakeSocket.connected = true;
          setClientRoom(ROOM);
          clearToasts();

          // The last entry is pending, so it can be the active story with
          // `story.finalPoints === null` — the state the finalize chips need.
          const activeEntry = { ...base[base.length - 1], finalPoints: null };
          const finalized = base.slice(0, -1);
          const targetIndex = pick % finalized.length;
          const target = conditions.blankId
            ? { ...finalized[targetIndex], id: blankId }
            : finalized[targetIndex];
          const queue = [...finalized.slice(0, targetIndex), target, ...finalized.slice(targetIndex + 1), activeEntry];

          render(makeState(queue, { youAreModerator: true, activeStoryId: activeEntry.id, phase: 'revealed' }));

          const baseline = probeStored();
          expect(baseline).toEqual({ roomId: ROOM, storyId: activeEntry.id });

          // Apply the blocking conditions this run generated.
          if (conditions.blankRoom) setClientRoom(blankRoom);
          if (conditions.disconnected) fakeSocket.connected = false;

          const before = queueSnapshot();
          clearToasts();
          resetSent();

          const li = cardByNumber('queueDoneList', target.number);
          expect(li).toBeTruthy();
          const btn = revoteControls(li)[0];
          expect(btn).toBeTruthy();

          activate(btn, method);

          // No request of any kind left the client.
          expect(fakeSocket.sent).toEqual([]);

          // Exactly the toast for the first failing guard.
          const expectedToast = conditions.blankId
            ? TOAST_NO_ID
            : conditions.blankRoom
              ? TOAST_NO_ROOM
              : TOAST_NOT_CONNECTED;
          expect(toastTexts()).toEqual([expectedToast]);

          // The rendered queue is byte-identical, both sections and both counts.
          expect(queueSnapshot()).toEqual(before);
          expect(btn.disabled).toBe(false);

          // Lift the blocking condition — neither step re-renders the queue —
          // and read the stored room id and active story id again.
          fakeSocket.connected = true;
          if (conditions.blankRoom) setClientRoom(ROOM);
          expect(probeStored()).toEqual(baseline);
          expect(queueSnapshot()).toEqual(before);
          return true;
        }
      ),
      { numRuns: NUM_RUNS }
    );

    // Leave the shared client state as the rest of the file expects it.
    fakeSocket.connected = true;
    setClientRoom(ROOM);
  });
});

/* ------------------------------------------------------------------ *
 * Task 9.3
 * ------------------------------------------------------------------ */

// Feature: clear-revote-finalized-story, Property 7: No optimistic update, and a rejected request stays retryable
// **Validates: Requirements 2.5, 2.7**
describe('Property 7: No optimistic update, and a rejected request stays retryable', () => {
  it('leaves the queue and the active story untouched on activation, and on any error response shows a toast reporting the failure, changes nothing, and keeps the control enabled', () => {
    fc.assert(
      fc.property(
        labelledQueueArb({ minLength: 2, maxLength: 6 }),
        fc.nat({ max: 99 }),
        // Any error response: a server reason, an empty reason, and none at all.
        fc.oneof(
          fc.constantFrom(
            'Room not found',
            'Not facilitator / moderator',
            'Story not found in queue',
            'Story is not finalized',
            'Re-vote was not applied'
          ),
          fc.string({ minLength: 1, maxLength: 40 }),
          fc.constant(''),
          fc.constant(undefined)
        ),
        fc.constantFrom('pointer', 'Enter', ' '),
        (base, pick, reason, method) => {
          fakeSocket.connected = true;
          setClientRoom(ROOM);
          clearToasts();

          const activeEntry = { ...base[base.length - 1], finalPoints: null };
          const finalized = base.slice(0, -1);
          const target = finalized[pick % finalized.length];
          const queue = [...finalized, activeEntry];

          render(makeState(queue, { youAreModerator: true, activeStoryId: activeEntry.id, phase: 'revealed' }));

          const baseline = probeStored();
          expect(baseline).toEqual({ roomId: ROOM, storyId: activeEntry.id });
          const before = queueSnapshot();

          const li = cardByNumber('queueDoneList', target.number);
          const btn = revoteControls(li)[0];

          clearToasts();
          resetSent();
          activate(btn, method);

          // The request went out, and nothing on the client moved with it: no
          // optimistic removal, no toast, the active story untouched.
          const request = sentOf('storyQueue:revote');
          expect(request).toHaveLength(1);
          expect(request[0].payload).toEqual({ roomId: ROOM, storyId: target.id });
          expect(toastTexts()).toEqual([]);
          expect(queueSnapshot()).toEqual(before);
          expect(probeStored()).toEqual(baseline);
          expect(queueSnapshot()).toEqual(before);

          // The server rejects it. `requestRevote` passes the ack as the third
          // argument to `socket.emit`, so replaying the rejection is a call to
          // the captured callback.
          const ack = request[0].ack;
          expect(typeof ack).toBe('function');
          clearToasts();
          ack(reason === undefined ? { ok: false } : { ok: false, reason });

          // A toast reporting that failure, the queue unchanged, the control
          // still enabled — so the facilitator can simply activate it again.
          expect(toastTexts()).toEqual([reason || TOAST_REVOTE_FAILED]);
          expect(queueSnapshot()).toEqual(before);
          expect(btn.disabled).toBe(false);

          // Retry: the same control, still bound to the same story, emits again.
          clearToasts();
          resetSent();
          activate(btn, method);
          const retry = sentOf('storyQueue:revote');
          expect(retry).toHaveLength(1);
          expect(retry[0].payload).toEqual({ roomId: ROOM, storyId: target.id });
          expect(toastTexts()).toEqual([]);
          expect(queueSnapshot()).toEqual(before);
          expect(btn.disabled).toBe(false);
          return true;
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 9.4
 * ------------------------------------------------------------------ */

/** `makeState` plus per-run overrides for the fields it fixes (`deck`, `users`). */
const stateWith = (queue, opts, extra) => ({ ...makeState(queue, opts), ...extra });

const deckButtons = () => [...document.querySelectorAll('#deck .deckBtn')];
const finalChips = () => [...document.querySelectorAll('#finalPointsChips .finalChip')];
const userStatuses = () => [...document.querySelectorAll('#usersList .ustatus')];

// Feature: clear-revote-finalized-story, Property 16: A null final estimate reopens voting controls with nothing selected
// **Validates: Requirements 6.5, 6.6, 6.7, 6.10**
describe('Property 16: A null final estimate reopens voting controls with nothing selected', () => {
  /**
   * Two broadcasts, deliberately.
   *
   * `renderFinalPointsChips` derives `canFinalize` from
   * `state.youAreModerator && state.phase === 'revealed' && hasActiveStory`, so
   * the chip-enabled clause is only meaningful on a `phase: 'revealed'`
   * broadcast; the deck-enabled clause is stated for `phase: 'voting'` and
   * `renderDeck` disables every card once the phase is `'revealed'`. One
   * broadcast cannot carry both clauses, so each is asserted under the phase
   * that makes it meaningful: the post-re-vote `'voting'` broadcast for the deck,
   * the cast-vote indicators and the "nothing selected" clauses, and the
   * `'revealed'` broadcast that follows it for chip enablement by role.
   *
   * This is the RE-VOTE case: the re-voted story *becomes* the active story, so
   * `hasActiveStory` is true and the deck is correctly ENABLED. Property 34 in
   * public/delete-finalized-ui.pbt.test.js asserts a DISABLED deck for delete,
   * where `activeStoryId` becomes `null`. Both are right; do not "fix" either
   * one into the other.
   *
   * Prior selections are seeded first — a deck vote, and a final-points chip
   * clicked while the socket is disconnected so `selectedFinalPoint` survives the
   * handler's own reset — so "nothing selected" is a claim about state that was
   * really set, not about state that was never touched.
   */
  it('reopens the deck enabled with nothing selected, renders numeric chips enabled for the facilitator and disabled for a participant with none selected, and shows no cast-vote indicator', () => {
    const deckArb = fc
      .subarray(DECK, { minLength: 3, maxLength: DECK.length })
      .filter((deck) => deck.some((v) => v !== '?' && v !== '☕'));

    const userArb = fc.record({
      name: fc.string({ maxLength: 8 }),
      emoji: fc.constantFrom('', '🙂', '🚀'),
      isModerator: fc.boolean(),
      connected: fc.boolean(),
      vote: fc.constant(null),
    });

    const usersArb = fc
      .array(userArb, { maxLength: 8 })
      .map((list) => Object.fromEntries(list.map((user, i) => [`u${i}`, user])));

    fc.assert(
      fc.property(
        deckArb,
        usersArb,
        fc.boolean(),
        labelledQueueArb({ minLength: 1, maxLength: 6, finalPointsArb: finalPointsArb() }),
        fc.nat({ max: 99 }),
        fc.nat({ max: 99 }),
        (deck, users, youAreModerator, base, deckPick, chipPick) => {
          const numericDeck = deck.filter((v) => v !== '?' && v !== '☕');
          expect(numericDeck.length).toBeGreaterThanOrEqual(1);
          const deckIndex = deckPick % deck.length;
          const deckValue = deck[deckIndex];
          const chipIndex = chipPick % numericDeck.length;
          const chipValue = numericDeck[chipIndex];

          // The re-voted story: `finalPoints` cleared to null, and active.
          const active = { ...base[base.length - 1], finalPoints: null };
          const queue = [...base.slice(0, -1), active];

          fakeSocket.connected = true;
          setClientRoom(ROOM);
          clearToasts();

          const me = { name: 'Me', emoji: '', isModerator: true, connected: true, vote: null };
          const seedOpts = { youAreModerator: true, activeStoryId: active.id };

          // 1) Seed a deck-card selection by voting, then confirm it renders.
          render(stateWith(queue, { ...seedOpts, phase: 'voting' }, { deck, users: { me: { ...me } } }));
          deckButtons()[deckIndex].click();
          render(stateWith(queue, { ...seedOpts, phase: 'voting' }, { deck, users: { me: { ...me, vote: 'selected' } } }));
          expect(deckButtons()[deckIndex].classList.contains('active')).toBe(true);

          // 2) Seed a final-points chip selection. The click is made while the
          // socket is disconnected, so the handler's connection guard returns
          // after the selection is recorded and `selectedFinalPoint` persists.
          render(stateWith(queue, { ...seedOpts, phase: 'revealed' }, { deck, users: { me: { ...me, vote: deckValue } } }));
          const seedChip = finalChips()[chipIndex];
          expect(seedChip.textContent).toBe(chipValue);
          expect(seedChip.disabled).toBe(false);
          fakeSocket.connected = false;
          resetSent();
          seedChip.click();
          // The connection guard returned before the emit, which is what leaves
          // `selectedFinalPoint` set going into the broadcasts below.
          expect(sentOf('storyQueue:finalize')).toHaveLength(0);
          fakeSocket.connected = true;
          expect(finalChips()[chipIndex].classList.contains('selected')).toBe(true);
          clearToasts();

          // 3) The post-re-vote broadcast: phase 'voting', the re-voted story
          // active with `finalPoints` null, every user record carrying a null vote.
          render(stateWith(queue, { youAreModerator, activeStoryId: active.id, phase: 'voting' }, { deck, users }));

          // Every voting deck card enabled, and none selected.
          expect(deckButtons()).toHaveLength(deck.length);
          for (const b of deckButtons()) {
            expect(b.disabled).toBe(false);
            expect(b.classList.contains('active')).toBe(false);
          }

          // No finalize chip selected.
          expect(finalChips()).toHaveLength(numericDeck.length);
          for (const chip of finalChips()) {
            expect(chip.classList.contains('selected')).toBe(false);
            expect(chip.getAttribute('aria-checked')).toBe('false');
          }

          // No cast-vote indicator on any user entry.
          expect(userStatuses()).toHaveLength(Object.keys(users).length);
          for (const status of userStatuses()) expect(status.textContent).toBe('—');

          // 4) The reveal that follows, still with `finalPoints` null: numeric
          // chips enabled for the facilitator, disabled for a participant, none
          // selected, and still no cast-vote indicator.
          render(stateWith(queue, { youAreModerator, activeStoryId: active.id, phase: 'revealed' }, { deck, users }));

          expect(finalChips()).toHaveLength(numericDeck.length);
          finalChips().forEach((chip, i) => {
            expect(chip.textContent).toBe(numericDeck[i]);
            expect(chip.disabled).toBe(!youAreModerator);
            expect(chip.classList.contains('selected')).toBe(false);
            expect(chip.getAttribute('aria-checked')).toBe('false');
          });
          for (const status of userStatuses()) expect(status.textContent).toBe('—');
          return true;
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ *
 * Task 9.5
 * ------------------------------------------------------------------ */

/** Documents handed to `new Blob([...])` inside `downloadFile`. */
let capturedExports = [];

// Feature: clear-revote-finalized-story, Property 17: Export totals exclude re-voted stories
// **Validates: Requirements 6.8**
describe('Property 17: Export totals exclude re-voted stories', () => {
  // The export has no exported entry point, so it is driven through the real
  // #exportMdBtn control and observed by capturing the Blob `downloadFile`
  // builds — the document the facilitator would receive, byte for byte. jsdom
  // implements neither `URL.createObjectURL` nor anchor navigation, so both are
  // stubbed here rather than changing production code.
  beforeAll(() => {
    const NativeBlob = globalThis.Blob;
    class RecordingBlob extends NativeBlob {
      constructor(parts = [], options = {}) {
        super(parts, options);
        capturedExports.push({ text: parts.map((p) => String(p)).join(''), type: options?.type ?? '' });
      }
    }
    globalThis.Blob = RecordingBlob;
    window.Blob = RecordingBlob;
    URL.createObjectURL = () => 'blob:revote-ui';
    URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function noopClick() {};
  });

  it('lists the cleared entry as not finalized and totals only the entries whose finalPoints is non-null', () => {
    fc.assert(
      fc.property(
        labelledQueueArb({
          minLength: 2,
          maxLength: 10,
          finalPointsArb: fc.oneof(
            { weight: 3, arbitrary: fc.constantFrom(...POINTS) },
            { weight: 1, arbitrary: fc.constant(null) }
          ),
        }).map((queue) =>
          // At least two finalized entries, so clearing one still leaves a total
          // to check rather than a trivially empty sum.
          queue.map((entry, i) =>
            i < 2 && entry.finalPoints === null ? { ...entry, finalPoints: POINTS[i % POINTS.length] } : entry
          )
        ),
        fc.nat({ max: 99 }),
        (queue, pick) => {
          fakeSocket.connected = true;
          setClientRoom(ROOM);
          clearToasts();

          const finalized = queue.filter((entry) => isFinalizedValue(entry.finalPoints));
          const target = finalized[pick % finalized.length];

          // Before: the target is finalized. After: the re-vote broadcast has
          // cleared its `finalPoints` and made it the active story.
          render(makeState(queue, { youAreModerator: true, activeStoryId: null, phase: 'revealed' }));
          const cleared = queue.map((entry) =>
            entry.id === target.id ? { ...entry, finalPoints: null } : entry
          );
          render(makeState(cleared, { youAreModerator: true, activeStoryId: target.id }));

          capturedExports = [];
          const mdBtn = document.getElementById('exportMdBtn');
          expect(mdBtn.disabled).toBe(false);
          mdBtn.click();

          expect(capturedExports).toHaveLength(1);
          const text = capturedExports[0].text;

          // The re-voted story is still listed, but as not finalized: its row
          // carries the not-estimated dash in the Final Points column.
          const rows = text.split('\n').filter((line) => /^\| \d+ \|/.test(line));
          expect(rows).toHaveLength(cleared.length);
          const targetRow = rows.find((row) => row.includes(target.number));
          expect(targetRow).toBeTruthy();
          expect(targetRow.endsWith('| — |')).toBe(true);
          expect(targetRow).toContain(target.title);

          // Every entry with a non-null `finalPoints` still shows its value.
          for (const entry of cleared) {
            const row = rows.find((r) => r.includes(entry.number));
            expect(row.endsWith(entry.finalPoints === null ? '| — |' : `| ${entry.finalPoints} |`)).toBe(true);
          }

          // The points total is the sum over the entries whose `finalPoints` is
          // non-null, which excludes the re-voted story.
          const expectedTotal = cleared.reduce(
            (sum, entry) => (entry.finalPoints === null ? sum : sum + Number(entry.finalPoints)),
            0
          );
          const expectedFinalized = cleared.filter((entry) => entry.finalPoints !== null).length;
          expect(expectedFinalized).toBe(finalized.length - 1);

          const totalMatch = text.match(/\*\*Total Points:\*\*\s*([0-9.]+)/);
          expect(totalMatch).not.toBeNull();
          expect(Number(totalMatch[1])).toBe(expectedTotal);
          expect(text).toContain(`**Stories:** ${cleared.length}`);
          expect(text).toContain(`**Estimated:** ${expectedFinalized}`);
          return true;
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
