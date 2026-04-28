/**
 * Unit Tests: vote:clear handler and client rendering
 *
 * Feature: clear-revote-finalized-story
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------
// Extracted pure handler logic (mirrors server.js vote:clear mutation)
// ---------------------------------------------------------------------------

function handleVoteClear(room) {
  room.phase = 'voting';
  for (const id of Object.keys(room.users)) room.users[id].vote = null;

  if (room.activeStoryId && room.story.finalPoints !== null) {
    room.story.finalPoints = null;
    const queueEntry = room.storyQueue.find((s) => s.id === room.activeStoryId);
    if (queueEntry) queueEntry.finalPoints = null;
  }
}

// ---------------------------------------------------------------------------
// Room factory helpers
// ---------------------------------------------------------------------------

function makeRoom({ activeStoryId = null, finalPoints = null, users = {}, queueFinalPoints = null } = {}) {
  const storyQueue = activeStoryId
    ? [{ id: activeStoryId, title: 'Story A', desc: '', link: '', finalPoints: queueFinalPoints }]
    : [];

  return {
    phase: 'revealed',
    story: { title: 'Story A', desc: '', link: '', finalPoints },
    storyQueue,
    activeStoryId,
    users,
  };
}

// ---------------------------------------------------------------------------
// DOM rendering helpers (replicated from public/app.js for isolation)
// ---------------------------------------------------------------------------

function makeDocument() {
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

// ---------------------------------------------------------------------------
// Tests: vote:clear server logic
// ---------------------------------------------------------------------------

describe('vote:clear handler', () => {
  it('clears room.story.finalPoints when active story is finalized', () => {
    // Requirement 1.1
    const room = makeRoom({ activeStoryId: 'story-1', finalPoints: '5', queueFinalPoints: '5' });
    handleVoteClear(room);
    expect(room.story.finalPoints).toBe(null);
  });

  it('clears matching queue entry finalPoints when active story is finalized', () => {
    // Requirement 1.2
    const room = makeRoom({ activeStoryId: 'story-1', finalPoints: '8', queueFinalPoints: '8' });
    handleVoteClear(room);
    const entry = room.storyQueue.find((s) => s.id === 'story-1');
    expect(entry.finalPoints).toBe(null);
  });

  it('leaves room.story.finalPoints as null when story was not finalized (no regression)', () => {
    // Requirement 1.1 — no regression: already-null stays null
    const room = makeRoom({ activeStoryId: 'story-2', finalPoints: null, queueFinalPoints: null });
    handleVoteClear(room);
    expect(room.story.finalPoints).toBe(null);
  });

  it('resets phase to "voting" and clears all votes when no active story', () => {
    // Requirement 1.3, 1.4 — no active story edge case
    const room = makeRoom({
      activeStoryId: null,
      finalPoints: null,
      users: { 'u1': { name: 'Alice', vote: '5' }, 'u2': { name: 'Bob', vote: '3' } },
    });
    // Should not throw
    expect(() => handleVoteClear(room)).not.toThrow();
    expect(room.phase).toBe('voting');
    expect(room.users['u1'].vote).toBe(null);
    expect(room.users['u2'].vote).toBe(null);
  });

  it('resets phase to "voting" after clearing a finalized story', () => {
    // Requirement 1.3
    const room = makeRoom({ activeStoryId: 'story-3', finalPoints: '13', queueFinalPoints: '13' });
    handleVoteClear(room);
    expect(room.phase).toBe('voting');
  });

  it('clears all user votes after clearing a finalized story', () => {
    // Requirement 1.4
    const room = makeRoom({
      activeStoryId: 'story-4',
      finalPoints: '3',
      queueFinalPoints: '3',
      users: { 'u1': { name: 'Alice', vote: '3' }, 'u2': { name: 'Bob', vote: '5' } },
    });
    handleVoteClear(room);
    expect(room.users['u1'].vote).toBe(null);
    expect(room.users['u2'].vote).toBe(null);
  });

  it('is a no-op on queue when activeStoryId is not found in storyQueue', () => {
    // Defensive: queue entry missing — should not throw
    const room = {
      phase: 'revealed',
      story: { title: 'Ghost', desc: '', link: '', finalPoints: '5' },
      storyQueue: [], // empty — no matching entry
      activeStoryId: 'ghost-id',
      users: {},
    };
    expect(() => handleVoteClear(room)).not.toThrow();
    expect(room.story.finalPoints).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Tests: client rendering
// ---------------------------------------------------------------------------

describe('renderStory', () => {
  it('does not render a .pointsBadge element when finalPoints is null', () => {
    // Requirement 2.1
    const document = makeDocument();
    renderStory({ title: 'My Story', desc: '', link: '', finalPoints: null }, document);
    expect(document.querySelector('.pointsBadge')).toBe(null);
  });

  it('renders a .pointsBadge element when finalPoints is set', () => {
    // Sanity check: badge appears when finalPoints is truthy
    const document = makeDocument();
    renderStory({ title: 'My Story', desc: '', link: '', finalPoints: '8' }, document);
    const badge = document.querySelector('.pointsBadge');
    expect(badge).not.toBe(null);
    expect(badge.textContent).toBe('Final: 8');
  });
});

describe('renderQueue entry', () => {
  it('displays "Final: —" when finalPoints is null', () => {
    // Requirement 2.2
    const document = makeDocument();
    renderQueueEntry({ id: 'q1', title: 'Queue Story', desc: '', link: '', finalPoints: null }, document);
    const points = document.querySelector('.queuePoints');
    expect(points).not.toBe(null);
    expect(points.textContent).toBe('Final: —');
  });

  it('displays the final points value when finalPoints is set', () => {
    // Sanity check: value appears when finalPoints is truthy
    const document = makeDocument();
    renderQueueEntry({ id: 'q1', title: 'Queue Story', desc: '', link: '', finalPoints: '13' }, document);
    const points = document.querySelector('.queuePoints');
    expect(points).not.toBe(null);
    expect(points.textContent).toBe('Final: 13');
  });
});
