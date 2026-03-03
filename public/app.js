/* global io */
const socket = io();

let currentRoom = null;
let modKey = null;
let lastState = null;

const el = (id) => document.getElementById(id);

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

function setPill(pill, text, kind = '') {
  pill.textContent = text;
  pill.classList.toggle('good', kind === 'good');
  pill.classList.toggle('warn', kind === 'warn');
}

function setShareLinks(roomId, mk) {
  const base = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
  const participant = base;
  const facilitator = `${base}?mod=${encodeURIComponent(mk)}`;

  el('shareBox').style.display = 'block';
  el('shareParticipant').textContent = participant;
  el('shareParticipant').href = participant;
  el('shareMod').textContent = facilitator;
  el('shareMod').href = facilitator;

  el('copyParticipantBtn').onclick = () => copyToClipboard(participant);
  el('copyModBtn').onclick = () => copyToClipboard(facilitator);
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t);
    t.select(); document.execCommand('copy'); t.remove();
  }
}

function parseFromUrl() {
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1]) currentRoom = parts[1].toUpperCase();
  modKey = url.searchParams.get('mod');
  if (currentRoom) el('roomId').value = currentRoom;
}
parseFromUrl();

const addToQueueBtn = el('addToQueueBtn');
const storyQueueList = el('storyQueueList');
const finalPointsSelect = el('finalPointsSelect');
const finalizeEstimateBtn = el('finalizeEstimateBtn');

el('createRoomBtn').onclick = () => {
  const desiredRoomId = el('roomId').value.trim();
  if (!desiredRoomId) return alert('Enter a Team Name.');
  const name = el('name').value.trim() || 'Facilitator';
  socket.emit('room:create', { desiredRoomId, name });
};

el('joinBtn').onclick = () => {
  const roomId = (el('roomId').value.trim() || '').toUpperCase();
  const name = el('name').value.trim();
  if (!roomId) return alert('Enter a Team Name or click Create Room.');
  if (!name) return alert('Enter your name.');
  currentRoom = roomId;
  socket.emit('room:join', { roomId, name, modKey });
};

el('setStoryBtn').onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  socket.emit('story:set', { roomId: currentRoom, story: {
    title: el('storyTitle').value,
    desc: el('storyDesc').value,
    link: el('storyLink').value
  }});
};

el('revealBtn').onclick = () => currentRoom && socket.emit('vote:reveal', { roomId: currentRoom });
el('clearBtn').onclick = () => currentRoom && socket.emit('vote:clear', { roomId: currentRoom });

addToQueueBtn.onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  const title = el('storyTitle').value.trim();
  if (!title) return alert('Enter a Story Title to add to the queue.');
  socket.emit('storyQueue:add', { roomId: currentRoom, story: {
    title,
    desc: el('storyDesc').value,
    link: el('storyLink').value
  }});
};

finalizeEstimateBtn.onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  if (!lastState?.activeStoryId) return alert('Set an active story first.');
  const pts = finalPointsSelect.value;
  if (!pts) return alert('Select final points.');
  socket.emit('storyQueue:finalize', { roomId: currentRoom, storyId: lastState.activeStoryId, finalPoints: pts });
};

function renderFinalPointsOptions(deck) {
  finalPointsSelect.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Final Points';
  finalPointsSelect.appendChild(ph);
  (deck || []).forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v; finalPointsSelect.appendChild(o);
  });
}

function renderDeck(deck) {
  const deckDiv = el('deck');
  deckDiv.innerHTML = '';
  (deck || []).forEach(v => {
    const b = document.createElement('button');
    b.className = 'deckBtn';
    b.textContent = v;
    b.onclick = () => currentRoom && socket.emit('vote:set', { roomId: currentRoom, vote: v });
    deckDiv.appendChild(b);
  });
}

function renderUsers(users, phase) {
  const list = el('users');
  list.innerHTML = '';
  const entries = Object.values(users || {});
  el('countPill').textContent = String(entries.length);
  entries.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  entries.forEach(u => {
    const li = document.createElement('li');
    const status = phase === 'revealed' ? (u.vote ?? '—') : (u.vote === 'selected' ? '✔ Selected' : '—');
    li.innerHTML = `<span class="uname">${escapeHtml(u.name)}</span><span class="ustatus">${escapeHtml(status)}</span>`;
    list.appendChild(li);
  });
}

function renderStory(story) {
  const view = el('storyView');
  const link = story?.link ? `<a href="${escapeAttr(normalizeUrl(story.link))}" target="_blank" rel="noreferrer">Open Link</a>` : '';
  const pts = story?.finalPoints ? `<span class="pointsBadge">Final: ${escapeHtml(story.finalPoints)}</span>` : '';
  view.innerHTML = `<div class="storyTitle">${escapeHtml(story?.title || '')} ${pts}</div><div class="storyDesc">${escapeHtml(story?.desc || '')}</div><div class="storyLink">${link}</div>`;
}

function renderResults(state) {
  const r = el('results');
  if (state.phase !== 'revealed') {
    r.innerHTML = '<div class="hint">Votes are hidden until the facilitator reveals.</div>';
    return;
  }
  const votes = Object.values(state.users || {})
    .map(u => u.vote)
    .filter(v => v != null && !Number.isNaN(Number(v)))
    .map(Number)
    .sort((a, b) => a - b);

  if (!votes.length) {
    r.innerHTML = '<div class="hint">No votes recorded.</div>';
    return;
  }

  const min = votes[0];
  const max = votes[votes.length - 1];
  const avg = (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1);
  const median = votes.length % 2 ? votes[(votes.length - 1) / 2] : ((votes[votes.length / 2 - 1] + votes[votes.length / 2]) / 2).toFixed(1);
  const final = state.story?.finalPoints ? `<div><b>Final</b>: ${escapeHtml(state.story.finalPoints)}</div>` : '';

  r.innerHTML = `<div class="summary">${final}<div><b>Min</b>: ${min}</div><div><b>Max</b>: ${max}</div><div><b>Avg</b>: ${avg}</div><div><b>Median</b>: ${median}</div></div>`;
}

function renderQueue(state) {
  const queue = Array.isArray(state.storyQueue) ? state.storyQueue : [];
  storyQueueList.innerHTML = '';

  if (!queue.length) {
    const li = document.createElement('li');
    li.className = 'queueItem';
    li.innerHTML = '<div class="queueLeft"><div class="queueTitleRow"><span class="queueTitle">No Stories In Queue</span></div></div>';
    storyQueueList.appendChild(li);
    return;
  }

  queue.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'queueItem' + (state.activeStoryId === s.id ? ' queueActive' : '');

    const ptsText = s.finalPoints ? `Final: ${s.finalPoints}` : 'Final: —';

    const left = document.createElement('div');
    left.className = 'queueLeft';
    left.innerHTML = `
      <div class="queueTitleRow">
        <span class="queueTitle">${escapeHtml(s.title)}</span>
        <span class="queuePoints">${escapeHtml(ptsText)}</span>
      </div>
      <div class="queueMeta">${state.activeStoryId === s.id ? 'Active Story' : ''}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'queueActions';

    if (s.link) {
      const a = document.createElement('a');
      a.className = 'queueBtn queueLinkBtn';
      a.textContent = '🔗';
      a.href = normalizeUrl(s.link);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.title = 'Open Link';
      actions.appendChild(a);
    }

    if (state.youAreModerator) {
      const setBtn = document.createElement('button');
      setBtn.className = 'queueBtn primary';
      setBtn.textContent = 'Set Active';
      setBtn.disabled = state.activeStoryId === s.id;
      setBtn.onclick = () => socket.emit('storyQueue:setActive', { roomId: currentRoom, storyId: s.id });

      const rmBtn = document.createElement('button');
      rmBtn.className = 'queueBtn';
      rmBtn.textContent = 'Remove';
      rmBtn.onclick = () => socket.emit('storyQueue:remove', { roomId: currentRoom, storyId: s.id });

      actions.appendChild(setBtn);
      actions.appendChild(rmBtn);
    }

    li.appendChild(left);
    li.appendChild(actions);
    storyQueueList.appendChild(li);
  });
}

socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  currentRoom = roomId;
  modKey = createdModKey;
  setShareLinks(roomId, createdModKey);
  window.history.replaceState({}, '', `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(createdModKey)}`);
  setPill(el('modePill'), 'Facilitator', 'good');
});

socket.on('room:state', (state) => {
  lastState = state;

  setPill(el('modePill'), state.youAreModerator ? 'Facilitator' : 'Participant', state.youAreModerator ? 'good' : '');
  setPill(el('phasePill'), state.phase === 'revealed' ? 'Revealed' : 'Voting', state.phase === 'revealed' ? 'warn' : '');

  if (state.youAreModerator && modKey) setShareLinks(state.roomId, modKey);

  el('setStoryBtn').disabled = !state.youAreModerator;
  el('revealBtn').disabled = !state.youAreModerator;
  el('clearBtn').disabled = !state.youAreModerator;
  addToQueueBtn.disabled = !state.youAreModerator;

  finalPointsSelect.disabled = !state.youAreModerator || state.phase !== 'revealed' || !state.activeStoryId;
  finalizeEstimateBtn.disabled = !state.youAreModerator || state.phase !== 'revealed' || !state.activeStoryId;

  renderDeck(state.deck);
  renderFinalPointsOptions(state.deck);
  renderUsers(state.users, state.phase);
  renderStory(state.story);
  renderResults(state);
  renderQueue(state);
});
