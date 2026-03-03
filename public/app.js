/* global io */

// ---------- Config ----------
const SOCKET_URL = 'https://flaps-production.up.railway.app';

// Optional: enable socket.io client debug logs (remove after verifying)
try { localStorage.debug = localStorage.debug || 'socket.io-client:*'; } catch {}

// ---------- DOM helpers ----------
const el = (id) => document.getElementById(id);

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function setPill(pillEl, text, kind = '') {
  pillEl.textContent = text;
  pillEl.classList.toggle('good', kind === 'good');
  pillEl.classList.toggle('warn', kind === 'warn');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
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

// ---------- URL params ----------
let currentRoom = null;
let modKey = null;
let lastState = null;

(function parseFromUrl() {
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1]) currentRoom = parts[1].toUpperCase();
  modKey = url.searchParams.get('mod') || null;
  if (currentRoom) el('roomId').value = currentRoom;
})();

// ---------- Socket.IO ----------
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: false
});

socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
  // auto-join if room is present in URL
  if (currentRoom) {
    const nameVal = (el('name').value || '').trim() || 'Facilitator';
    socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
  }
});

socket.on('connect_error', (err) => {
  console.error('[socket] connect_error', err);
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected', reason);
});

// ----- Server → Client events -----
socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  console.log('[socket] room:created', roomId);
  currentRoom = roomId;
  modKey = createdModKey;
  setShareLinks(roomId, createdModKey);

  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(createdModKey)}`;
  window.history.replaceState({}, '', newUrl);
  setPill(el('modePill'), 'Facilitator', 'good');
});

socket.on('room:state', (state) => {
  console.log('[socket] room:state', state);
  lastState = state;

  // Mode / phase display
  setPill(el('modePill'), state.youAreModerator ? 'Facilitator' : 'Participant', state.youAreModerator ? 'good' : '');
  setPill(el('phasePill'), state.phase === 'revealed' ? 'Revealed' : 'Voting', state.phase === 'revealed' ? 'warn' : '');

  // Share links (facilitator only)
  if (state.youAreModerator && modKey) setShareLinks(state.roomId, modKey);

  // Enable/disable controls
  el('setStoryBtn').disabled = !state.youAreModerator;
  el('revealBtn').disabled = !state.youAreModerator;
  el('clearBtn').disabled = !state.youAreModerator;

  const canFinalize = state.youAreModerator && state.phase === 'revealed' && !!state.activeStoryId;
  el('finalPointsSelect').disabled = !canFinalize;
  el('finalizeEstimateBtn').disabled = !canFinalize;

  // Render sections
  renderDeck(state.deck);
  renderFinalPointsOptions(state.deck);
  renderUsers(state.users, state.phase);
  renderStory(state.story);
  renderResults(state);
  renderQueue(state);
});

// ---------- UI → Server events ----------
el('createRoomBtn').onclick = () => {
  const desiredRoomId = (el('roomId').value || '').trim();
  if (!desiredRoomId) return alert('Enter a Team Name.');
  const name = (el('name').value || '').trim() || 'Facilitator';
  socket.emit('room:create', { desiredRoomId, name });
};

el('joinBtn').onclick = () => {
  const roomId = ((el('roomId').value || '').trim() || '').toUpperCase();
  const name = (el('name').value || '').trim();
  if (!roomId) return alert('Enter a Team Name or click Create Room.');
  if (!name) return alert('Enter your name.');
  currentRoom = roomId;
  socket.emit('room:join', { roomId, name, modKey });
};

el('setStoryBtn').onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  socket.emit('story:set', {
    roomId: currentRoom,
    story: {
      title: el('storyTitle').value,
      desc: el('storyDesc').value,
      link: el('storyLink').value
    }
  });
};

el('revealBtn').onclick = () => currentRoom && socket.emit('vote:reveal', { roomId: currentRoom });
el('clearBtn').onclick  = () => currentRoom && socket.emit('vote:clear',   { roomId: currentRoom });

el('addToQueueBtn').onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  const title = (el('storyTitle').value || '').trim();
  if (!title) return alert('Enter a Story Title to add to the queue.');
  socket.emit('storyQueue:add', {
    roomId: currentRoom,
    story: {
      title,
      desc: el('storyDesc').value,
      link: el('storyLink').value
    }
  });
  // reset inputs
  el('storyTitle').value = '';
  el('storyDesc').value = '';
  el('storyLink').value = '';
  el('storyTitle').focus();
};

el('finalizeEstimateBtn').onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  if (!lastState?.activeStoryId) return alert('Set an active story first.');
  const pts = el('finalPointsSelect').value;
  if (!pts) return alert('Select final points.');
  socket.emit('storyQueue:finalize', { roomId: currentRoom, storyId: lastState.activeStoryId, finalPoints: pts });
};

// ---------- Renderers ----------
function renderFinalPointsOptions(deck) {
  const d = Array.isArray(deck) ? deck : [];
  const sel = el('finalPointsSelect');
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Final Points';
  sel.appendChild(ph);
  d.forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}

function renderDeck(deck) {
  const d = Array.isArray(deck) ? deck : [];
  const deckDiv = el('deck');
  deckDiv.innerHTML = '';
  d.forEach((v) => {
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
  entries.forEach((u) => {
    const li = document.createElement('li');
    const status = phase === 'revealed'
      ? (u.vote ?? '—')
      : (u.vote === 'selected' ? '✔ Selected' : '—');
    li.innerHTML =
      `<span class="uname">${escapeHtml(u.name)}</span>` +
      `<span class="ustatus">${escapeHtml(String(status))}</span>`;
    list.appendChild(li);
  });
}

function renderStory(story) {
  const view = el('storyView');
  const linkHtml = story?.link
    ? `<a href="${escapeAttr(normalizeUrl(story.link))}" target="_blank" rel="noreferrer">Open Link</a>`
    : '';
  const pts = story?.finalPoints
    ? `<span class="pointsBadge">Final: ${escapeHtml(story.finalPoints)}</span>`
    : '';
  view.innerHTML =
    `<div class="storyTitle">${escapeHtml(story?.title || '')} ${pts}</div>` +
    `<div class="storyDesc">${escapeHtml(story?.desc || '')}</div>` +
    `<div class="storyLink">${linkHtml}</div>`;
}

function renderResults(state) {
  const r = el('results');
  if (state.phase !== 'revealed') {
    r.innerHTML = '<div class="hint">Votes are hidden until the facilitator reveals.</div>';
    return;
  }
  const votes = Object.values(state.users || {})
    .map((u) => u.vote)
    .filter((v) => v != null && !Number.isNaN(Number(v)))
    .map(Number)
    .sort((a, b) => a - b);
  if (!votes.length) {
    r.innerHTML = '<div class="hint">No votes recorded.</div>';
    return;
  }
  const min = votes[0];
  const max = votes[votes.length - 1];
  const avg = (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1);
  const median = votes.length % 2
    ? votes[(votes.length - 1) / 2]
    : ((votes[votes.length / 2 - 1] + votes[votes.length / 2]) / 2).toFixed(1);
  const final = state.story?.finalPoints
    ? `<div><b>Final</b>: ${escapeHtml(state.story.finalPoints)}</div>`
    : '';
  r.innerHTML =
    `<div class="summary">` +
      `${final}` +
      `<div><b>Min</b>: ${min}</div>` +
      `<div><b>Max</b>: ${max}</div>` +
      `<div><b>Avg</b>: ${avg}</div>` +
      `<div><b>Median</b>: ${median}</div>` +
    `</div>`;
}

function renderQueue(state) {
  const queue = Array.isArray(state.storyQueue) ? state.storyQueue : [];
  const list = el('storyQueueList');
  list.innerHTML = '';

  if (!queue.length) {
    const li = document.createElement('li');
    li.className = 'queueItem';
    li.innerHTML = '<div class="queueLeft"><div class="queueTitleRow"><span class="queueTitle">No Stories In Queue</span></div></div>';
    list.appendChild(li);
    return;
  }

  queue.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'queueItem' + (state.activeStoryId === s.id ? ' queueActive' : '');
    const ptsText = s.finalPoints ? `Final: ${s.finalPoints}` : 'Final: —';

    const left = document.createElement('div');
    left.className = 'queueLeft';
    left.innerHTML =
      `<div class="queueTitleRow">` +
        `<span class="queueTitle">${escapeHtml(s.title)}</span>` +
        `<span class="queuePoints">${escapeHtml(ptsText)}</span>` +
      `</div>` +
      `<div class="queueMeta">${state.activeStoryId === s.id ? 'Active Story' : ''}</div>`;

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
    list.appendChild(li);
  });
}
