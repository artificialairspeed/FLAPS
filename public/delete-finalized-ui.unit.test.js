// @vitest-environment jsdom
/**
 * Delete-on-finalized-card unit tests — CLIENT
 * Spec: clear-revote-finalized-story (Task 16.1)
 *
 * Two concrete examples, deliberately few, covering the things a generator
 * cannot phrase well (design.md "Unit and integration tests"):
 *
 *  - The finalized delete control's rendered attributes, pinned literally:
 *    tagName, type, textContent, aria-label, both classes, and its position
 *    between the final estimate pill and the Re-Vote control
 *    (Requirements 1.11, 1.12).
 *  - The absence of a global call: a spy on `window.confirm` is never invoked
 *    during an activation (Requirement 9.3).
 *
 * Harness is the jsdom one from public/app.unit.test.js: inject index.html's
 * body, land on a facilitator room URL, stub `globalThis.io` with a fake
 * socket, `await import('./app.js')`, then drive a render with
 * `fakeSocket.__trigger('room:state', state)`.
 *
 * _Requirements: 1.11, 1.12, 9.3_
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOM = 'DELUNIT';
const MOD_KEY = 'DELUNITKEY';
const DECK = ['0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];

/** The Story_Placeholder the server writes when no story is active. */
const STORY_PLACEHOLDER = { number: '', title: 'Add Story to Queue', finalPoints: null };

/** A recording stand-in for the Socket.IO client socket. */
function createFakeSocket() {
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
      this.emits.push({ event, payload: args[0] });
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

  // Facilitator URL: ?mod= is what makes youAreModerator meaningful client-side.
  window.history.replaceState({}, '', `/room/${ROOM}?mod=${MOD_KEY}`);

  // app.js reads remembered defaults from localStorage on import, which this
  // jsdom realm does not provide.
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

  fakeSocket = createFakeSocket();
  globalThis.io = () => fakeSocket;
  window.io = globalThis.io;

  await import('./app.js');
});

beforeEach(() => {
  fakeSocket.connected = true;
  // `room:created` is the client's own entry point for the stored room id.
  fakeSocket.__trigger('room:created', { roomId: ROOM, modKey: MOD_KEY });
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  fakeSocket.__reset();
});

/* ------------------------------- helpers -------------------------------- */

const doneList = () => document.getElementById('queueDoneList');

/** A room:state payload with the shape app.js expects. */
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

/**
 * Render one finalized story for a facilitator and return its card.
 * @param {{id?: string, number?: string, title?: string, finalPoints?: string}} [story]
 */
function renderFinalizedCardAsFacilitator(story = {}) {
  const entry = {
    id: 'story-final-1',
    number: 'JIRA-77',
    title: 'Login flow',
    finalPoints: '5',
    ...story,
  };

  fakeSocket.__trigger(
    'room:state',
    roomState({ youAreModerator: true, storyQueue: [entry], activeStoryId: null }),
  );

  const card = doneList().querySelector('li.queueItem:not(.queueEmptySection)');
  expect(card).not.toBeNull();
  return { card, entry };
}

/* ------------------------------- 1.11, 1.12 ------------------------------- */

describe('finalized delete control: rendered attributes and position (Req 1.11, 1.12)', () => {
  it('renders exactly one enabled ❌ button named "Delete story", classed queueBtn + queueIconBtn, between the final pill and the Re-Vote control', () => {
    const { card, entry } = renderFinalizedCardAsFacilitator();

    const actions = card.querySelector('.queueActions');
    expect(actions).not.toBeNull();

    const deleteBtns = actions.querySelectorAll('button[aria-label="Delete story"]');
    expect(deleteBtns.length).toBe(1); // exactly one (Req 1.11)

    const del = deleteBtns[0];

    // Req 1.12 — element shape, literally.
    expect(del.tagName).toBe('BUTTON');
    expect(del.type).toBe('button');
    expect(del.textContent).toBe('❌');
    expect(del.getAttribute('aria-label')).toBe('Delete story');

    // Both classes: the shared queue button styling plus the square icon sizing
    // pending cards use.
    expect(del.classList.contains('queueBtn')).toBe(true);
    expect(del.classList.contains('queueIconBtn')).toBe(true);

    // Enabled state (Req 1.11).
    expect(del.disabled).toBe(false);
    expect(del.hasAttribute('disabled')).toBe(false);

    // It carries the id of the story whose card it sits on.
    expect(del.dataset.storyId).toBe(entry.id);

    // Req 1.11 — position: immediately after the final estimate pill and
    // immediately before the Re-Vote control, inside .queueActions.
    const pill = actions.querySelector('.queueFinalChip');
    const revote = actions.querySelector('.queueRevoteBtn');
    expect(pill).not.toBeNull();
    expect(revote).not.toBeNull();

    const order = Array.from(actions.children);
    expect(order.length).toBe(3);
    expect(order.indexOf(pill)).toBe(0);
    expect(order.indexOf(del)).toBe(1);
    expect(order.indexOf(revote)).toBe(2);
    expect(del.previousElementSibling).toBe(pill);
    expect(del.nextElementSibling).toBe(revote);
  });
});

/* ---------------------------------- 9.3 ---------------------------------- */

describe('finalized delete control: no confirmation prompt (Req 9.3)', () => {
  it('never calls window.confirm during an activation, and emits the single storyQueue:remove straight away', () => {
    const { entry } = renderFinalizedCardAsFacilitator({ id: 'story-no-confirm' });

    const del = doneList().querySelector('button[aria-label="Delete story"]');
    expect(del).not.toBeNull();

    // Spy on every prompting global the click path could reach. A stub that
    // returns false would suppress the emit, so the spy answers "yes": if the
    // control ever did prompt, the emit below would still happen and only the
    // call count would betray it.
    const confirmSpy = vi.fn(() => true);
    const alertSpy = vi.fn();
    const promptSpy = vi.fn(() => '');
    const prev = {
      confirm: window.confirm,
      alert: window.alert,
      prompt: window.prompt,
    };
    window.confirm = confirmSpy;
    window.alert = alertSpy;
    window.prompt = promptSpy;

    try {
      fakeSocket.__reset();
      del.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    } finally {
      window.confirm = prev.confirm;
      window.alert = prev.alert;
      window.prompt = prev.prompt;
    }

    // Req 9.3 — no confirmation prompt, dialog, or further user action.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();

    // The request went out on that single activation, with no ack required.
    const removes = fakeSocket.__of('storyQueue:remove');
    expect(removes.length).toBe(1);
    expect(removes[0].payload).toEqual({ roomId: ROOM, storyId: entry.id });

    // The control stays enabled and the card is still rendered: the client waits
    // for the next room:state rather than removing it locally.
    expect(del.disabled).toBe(false);
    expect(doneList().querySelectorAll('button[aria-label="Delete story"]').length).toBe(1);
  });
});
