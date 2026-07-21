// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOM = 'REPRO1';

function createFakeSocket() {
  const handlers = {};
  return {
    connected: true,
    sent: [],
    on(event, cb) { (handlers[event] ||= []).push(cb); },
    off(event) { delete handlers[event]; },
    emit(event, payload) { this.sent.push({ event, payload }); },
    __trigger(event, ...args) { (handlers[event] || []).forEach((cb) => cb(...args)); },
  };
}

let fakeSocket;

beforeAll(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  const bodyInner = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
  document.body.innerHTML = bodyInner;
  window.history.replaceState({}, '', `/room/${ROOM}?mod=KEY`);
  // localStorage polyfill
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

describe('finalized active story highlight', () => {
  it('keeps queueActive on the finalized story in the done section', () => {
    const state = {
      deck: ['1', '2', '3', '5', '8', '☕', '?'],
      phase: 'revealed',
      story: { number: 'X1', title: 'Story One', finalPoints: '5' },
      storyQueue: [
        { id: 'abc', number: 'X1', title: 'Story One', finalPoints: '5' },
        { id: 'def', number: 'X2', title: 'Story Two', finalPoints: null },
      ],
      activeStoryId: 'abc',
      users: {},
      youAreModerator: true,
      myId: 'me',
    };
    fakeSocket.__trigger('room:state', state);

    const doneList = document.getElementById('queueDoneList');
    const items = doneList.querySelectorAll('li');
    console.log('DONE ITEMS:', items.length);
    items.forEach((li) => console.log('  className:', li.className));

    const activeInDone = doneList.querySelector('.queueActive');
    console.log('activeInDone found:', !!activeInDone);
    expect(activeInDone).not.toBeNull();
  });
});
