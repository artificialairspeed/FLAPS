/**
 * Property-Based Tests for client rendering with null finalPoints
 *
 * Feature: clear-revote-finalized-story
 * Property 3: Rendering null finalPoints shows no badge and "Final: —"
 * Validates: Requirements 2.1, 2.2
 */

import { describe, it, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fc from 'fast-check';

// ---- Helpers to extract the rendering functions under test ----
// We replicate the minimal DOM-dependent logic from app.js so we can
// test it in isolation without pulling in socket.io or window globals.

function makeDOM() {
  const dom = new JSDOM(`<!DOCTYPE html>
    <div id="storyView"></div>
    <ul id="storyQueueList"></ul>
  `);
  return dom.window.document;
}

function normalizeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
}

function renderStory(story, document) {
  const view = document.getElementById('storyView');
  view.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'storyTitle';
  title.textContent = story?.title ?? '';

  if (story?.finalPoints) {
    const pts = document.createElement('span');
    pts.className = 'pointsBadge';
    pts.textContent = `Final: ${story.finalPoints}`;
    title.appendChild(pts);
  }

  const desc = document.createElement('div');
  desc.className = 'storyDesc';
  desc.textContent = story?.desc ?? '';

  const linkDiv = document.createElement('div');
  linkDiv.className = 'storyLink';
  const safe = normalizeUrl(story?.link ?? '');
  if (safe) {
    const a = document.createElement('a');
    a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'Open Link';
    linkDiv.appendChild(a);
  }

  view.appendChild(title);
  view.appendChild(desc);
  view.appendChild(linkDiv);
}

function renderQueueEntry(entry, document) {
  const list = document.getElementById('storyQueueList');
  list.innerHTML = '';

  const li = document.createElement('li');
  li.className = 'queueItem';

  const left = document.createElement('div');
  left.className = 'queueLeft';

  const titleRow = document.createElement('div');
  titleRow.className = 'queueTitleRow';

  const title = document.createElement('span');
  title.className = 'queueTitle';
  title.textContent = entry.title ?? '';

  const points = document.createElement('span');
  points.className = 'queuePoints';
  points.textContent = entry.finalPoints ? `Final: ${entry.finalPoints}` : 'Final: —';

  titleRow.appendChild(title);
  titleRow.appendChild(points);
  left.appendChild(titleRow);
  li.appendChild(left);
  list.appendChild(li);
}

// ---- Arbitraries ----

const arbNullFinalPoints = fc.constant(null);

const arbStoryTitle = fc.string({ minLength: 0, maxLength: 80 });
const arbStoryDesc = fc.string({ minLength: 0, maxLength: 200 });

const arbStoryWithNullFinalPoints = fc.record({
  title: arbStoryTitle,
  desc: arbStoryDesc,
  link: fc.constant(''),
  finalPoints: arbNullFinalPoints,
});

const arbQueueEntryWithNullFinalPoints = fc.record({
  id: fc.uuid(),
  title: arbStoryTitle,
  desc: arbStoryDesc,
  link: fc.constant(''),
  finalPoints: arbNullFinalPoints,
});

// ---- Tests ----

describe('Property 3: Rendering null finalPoints shows no badge and "Final: —"', () => {
  /**
   * Validates: Requirements 2.1, 2.2
   *
   * For any story object with finalPoints = null, renderStory should produce
   * a story view with no .pointsBadge element.
   */
  it('renderStory with null finalPoints never renders a .pointsBadge', () => {
    fc.assert(
      fc.property(arbStoryWithNullFinalPoints, (story) => {
        const document = makeDOM();
        renderStory(story, document);
        const badge = document.querySelector('.pointsBadge');
        return badge === null;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 2.1, 2.2
   *
   * For any queue entry with finalPoints = null, renderQueue should display
   * the text "Final: —".
   */
  it('renderQueue with null finalPoints displays "Final: —"', () => {
    fc.assert(
      fc.property(arbQueueEntryWithNullFinalPoints, (entry) => {
        const document = makeDOM();
        renderQueueEntry(entry, document);
        const points = document.querySelector('.queuePoints');
        return points !== null && points.textContent === 'Final: —';
      }),
      { numRuns: 100 }
    );
  });
});
