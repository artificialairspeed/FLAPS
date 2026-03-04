/* global io */
/** ---------- Config ---------- */
const SOCKET_URL = 'https://flaps-production.up.railway.app';
try {
  if (typeof localStorage !== 'undefined' && localStorage.debug == null) {
    localStorage.debug = 'socket.io-client:*';
  }
} catch {}

/** ---------- DOM helpers ---------- */
const el = (id) => document.getElementById(id);
function show(id){ const n = el(id); if (n) n.classList.remove('hidden'); }
function hide(id){ const n = el(id); if (n) n.classList.add('hidden'); }
function setDisabled(id, v){ const n = el(id); if (n && 'disabled' in n) n.disabled = !!v; }

/** ---------- Utilities ---------- */
function normalizeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch {}
    t.remove();
  }
}
function setShareLinks(roomId, mk) {
  const base = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
  const participant = base;
  const facilitator = `${base}?mod=${encodeURIComponent(mk)}`;
  // visibility is controlled by role logic
  const p = el('shareParticipant');
  p.textContent = participant;
  p.href = participant;
  p.rel = 'noopener noreferrer';
  const m = el('shareMod');
  m.textContent = facilitator;
  m.href = facilitator;
  m.rel = 'noopener noreferrer';
  el('copyParticipantBtn').onclick = () => copyToClipboard(participant);
  el('copyModBtn').onclick = () => copyToClipboard(facilitator);
}

/** ---------- Deck normalization ----------
 * - Replace 0 with 0.5
 * - Remove 89
 * - Deduplicate values while preserving order
 */
function normalizeDeck(deck) {
  const src = Array.isArray(deck) ? deck : [];
  const out = [];
  const seen = new Set();
  for (const v of src) {
    const isEightyNine = (v === 89 || v === '89');
    if (isEightyNine) continue;
    const isZero = (v === 0 || v === '0');
    const nv = isZero ? 0.5 : v;
    const key = String(nv);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(nv);
  }
  return out;
}

/** ---------- URL params ---------- */
let currentRoom = null;
let modKey = null;
let lastState = null;
(function parseFromUrl() {
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1]) currentRoom = parts[1].toUpperCase();
  modKey = url.searchParams.get('mod') ?? null;
  if (currentRoom) el('roomId').value = currentRoom;
})();

/** ---------- Remember my name ---------- */
(function loadSavedName(){
  try {
    const saved = localStorage.getItem('flaps_name');
    if (saved) el('name').value = saved;
  } catch {}
})();
function saveName(name){
  try { if (name) localStorage.setItem('flaps_name', name); } catch {}
}

/** ---------- Initial View: layout & gating ---------- */
function applyInitialRoleView(){
  const hasRoomInUrl = !!currentRoom;
  const hasModKey = !!modKey;
  show('name'); show('joinBtn');
  if (!hasRoomInUrl) {
    setDisabled('name', true);
    setDisabled('joinBtn', true);
    show('roomId');
    show('createRoomBtn');
    setDisabled('roomId', false);
    setDisabled('createRoomBtn', false);
    return;
  }
  el('roomId').value = currentRoom;
  if (hasModKey){
    show('roomId'); show('createRoomBtn');
    setDisabled('roomId', true);
    setDisabled('createRoomBtn', true);
  } else {
    hide('createRoomBtn'); hide('roomId');
    setDisabled('name', false);
    setDisabled('joinBtn', false);
  }
}
applyInitialRoleView();

['roomId','name'].forEach(id => {
  const n = el(id);
  n?.addEventListener('keydown', (e) => { if (e.key === 'Enter') el('joinBtn').click(); });
});

/** ---------- Socket.IO ---------- */
const socket = io(SOCKET_URL, {
  transports: ['websocket','polling'],
  withCredentials: false
});
socket.on('connect', () => {
  if (currentRoom && modKey) {
    const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
    socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
  }
});
socket.on('connect_error', (err) => console.error('[socket] connect_error', err));
socket.on('disconnect', (reason) => console.warn('[socket] disconnected', reason));

/** ----- Server → Client events ----- */
socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  currentRoom = roomId;
  modKey = createdModKey;
  setShareLinks(roomId, createdModKey);
  show('shareBox'); // Facilitator only (creator)
  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(createdModKey)}`;
  window.history.replaceState({}, '', newUrl);
  setPill(el('modePill'), 'Facilitator', 'good');
  show('createRoomBtn'); show('roomId');
  setDisabled('createRoomBtn', true);
  setDisabled('roomId', true);
  setDisabled('name', false);
  setDisabled('joinBtn', false);
});

socket.on('room:state', (state) => {
  lastState = state;
  setPill(el('modePill'), state.youAreModerator ? 'Facilitator' : 'Participant', state.youAreModerator ? 'good' : '');
  setPill(el('phasePill'), state.phase === 'revealed' ? 'Revealed' : 'Voting', state.phase === 'revealed' ? 'warn' : '');

  if (state.youAreModerator && modKey) {
    setShareLinks(state.roomId, modKey);
    show('shareBox');
  } else {
    hide('shareBox');
  }

  // Moderator controls
  el('revealBtn').disabled = !state.youAreModerator;
  el('clearBtn').disabled = !state.youAreModerator;
  const canFinalize = state.youAreModerator && state.phase === 'revealed' && !!state.activeStoryId;
  el('finalPointsSelect').disabled = !canFinalize;
  el('finalizeEstimateBtn').disabled = !canFinalize;

  // Roombar behavior
  if (state.youAreModerator){
    show('createRoomBtn'); show('roomId');
    setDisabled('createRoomBtn', true);
    setDisabled('roomId', true);
    el('createRoomBtn').title = 'Room already created';
    el('roomId').title = 'Team name is locked for this session';
    setDisabled('name', false);
    setDisabled('joinBtn', false);
    show('shareBox');
  } else {
    hide('createRoomBtn'); hide('roomId');
    setDisabled('name', false);
    setDisabled('joinBtn', false);
    const hint = el('modHint');
    if (hint) hint.textContent = 'Facilitators manage rooms and stories.';
    hide('shareBox');
  }

  // Renders
  renderDeck(state.deck);
  renderFinalPointsOptions(state.deck);
  renderUsers(state.users, state.phase);
  renderStory(state.story);
  renderResults(state);
  renderQueue(state);
});

/** ---------- UI → Server ---------- */
el('createRoomBtn').onclick = () => {
  const desiredRoomId = (el('roomId').value ?? '').trim();
  if (!desiredRoomId) return alert('Enter a Team Name.');
  const name = (el('name').value ?? '').trim() || 'Facilitator';
  saveName(name);
  socket.emit('room:create', { desiredRoomId, name });
};

el('joinBtn').onclick = () => {
  const typedRoomId = ((el('roomId').value ?? '').trim() ?? '').toUpperCase();
  const name = (el('name').value ?? '').trim();
  if (!name) return alert('Enter your name.');
  saveName(name);
  if (!currentRoom && !typedRoomId) {
    return alert('Enter a Team Name or click Create Room.');
  }
  const idToUse = currentRoom ?? typedRoomId;
  currentRoom = idToUse;
  socket.emit('room:join', { roomId: idToUse, name, modKey });
};

el('revealBtn').onclick = () => currentRoom && socket.emit('vote:reveal', { roomId: currentRoom });
el('clearBtn').onclick = () => currentRoom && socket.emit('vote:clear', { roomId: currentRoom });

el('addToQueueBtn').onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  const title = (el('storyTitle').value ?? '').trim();
  if (!title) return alert('Enter a Story Title to add to the queue.');
  socket.emit('storyQueue:add', {
    roomId: currentRoom,
    story: { title, desc: el('storyDesc').value, link: el('storyLink').value }
  });
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
  socket.emit('storyQueue:finalize', { roomId: currentRoom, storyId: lastState.activeStoryId, finalPoints: Number(pts) });
};

/** ---------- Renderers ---------- */
function renderFinalPointsOptions(deck) {
  const d = normalizeDeck(deck);
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
  const d = normalizeDeck(deck);
  const deckDiv = el('deck');
  deckDiv.innerHTML = '';
  const frag = document.createDocumentFragment();
  d.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'deckBtn';
    b.type = 'button';
    b.textContent = v;
    b.setAttribute('aria-label', `Vote ${v}`);
    // Send numeric value so 0.5 is truly 0.5
    b.onclick = () => currentRoom && socket.emit('vote:set', { roomId: currentRoom, vote: Number(v) });
    frag.appendChild(b);
  });
  deckDiv.appendChild(frag);
}

function renderUsers(users, phase) {
  const list = el('users');
  list.innerHTML = '';
  const entries = Object.values(users ?? {});
  el('countPill').textContent = String(entries.length);
  entries.sort((a,b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const frag = document.createDocumentFragment();
  entries.forEach((u) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'uname';
    nameSpan.textContent = u.name ?? '';
    const statusSpan = document.createElement('span');
    statusSpan.className = 'ustatus';
    if (phase === 'revealed') {
      statusSpan.textContent = (u.vote ?? '—');
    } else {
      statusSpan.textContent = (u.vote === 'selected' ? '✔ Selected' : '—');
    }
    li.appendChild(nameSpan);
    li.appendChild(statusSpan);
    frag.appendChild(li);
  });
  list.appendChild(frag);
}

function renderStory(story) {
  const view = el('storyView');
  view.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'storyTitle';
  title.textContent = story?.title ?? '';
  if (story?.finalPoints != null) {
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
    a.href = safe;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Open Link';
    linkDiv.appendChild(a);
  }
  view.appendChild(title);
  view.appendChild(desc);
  view.appendChild(linkDiv);
}

function renderResults(state) {
  const r = el('results');
  if (state.phase !== 'revealed') {
    r.textContent = 'Votes are hidden until the facilitator reveals.';
    r.className = 'hint';
    return;
  }
  const votes = Object.values(state.users ?? {})
    .map((u) => u.vote)
    .filter((v) => v != null && !Number.isNaN(Number(v)))
    .map(Number)
    .sort((a,b) => a-b);
  if (!votes.length) {
    r.textContent = 'No votes recorded.';
    r.className = 'hint';
    return;
  }
  const min = votes[0];
  const max = votes[votes.length - 1];
  const avg = (votes.reduce((a,b) => a+b, 0) / votes.length).toFixed(1);
  const median = votes.length % 2
    ? votes[(votes.length - 1) / 2]
    : ((votes[votes.length/2 - 1] + votes[votes.length/2]) / 2).toFixed(1);
  const summary = document.createElement('div');
  summary.className = 'summary';
  if (state.story?.finalPoints != null) {
    const final = document.createElement('div');
    final.innerHTML = `<b>Final</b>: ${escapeHtml(state.story.finalPoints)}`;
    summary.appendChild(final);
  }
  const mins = document.createElement('div'); mins.innerHTML = `<b>Min</b>: ${min}`;
  const maxs = document.createElement('div'); maxs.innerHTML = `<b>Max</b>: ${max}`;
  const avgs = document.createElement('div'); avgs.innerHTML = `<b>Avg</b>: ${avg}`;
  const meds = document.createElement('div'); meds.innerHTML = `<b>Median</b>: ${median}`;
  summary.appendChild(mins);
  summary.appendChild(maxs);
  summary.appendChild(avgs);
  summary.appendChild(meds);
  r.className = '';
  r.innerHTML = '';
  r.appendChild(summary);
}

function renderQueue(state) {
  const queue = Array.isArray(state.storyQueue) ? state.storyQueue : [];
  const list = el('storyQueueList');
  list.innerHTML = '';
  if (!queue.length) {
    const li = document.createElement('li');
    li.className = 'queueItem';
    const left = document.createElement('div');
    left.className = 'queueLeft';
    const row = document.createElement('div');
    row.className = 'queueTitleRow';
    const title = document.createElement('span');
    title.className = 'queueTitle';
    title.textContent = 'No Stories In Queue';
    row.appendChild(title);
    left.appendChild(row);
    li.appendChild(left);
    list.appendChild(li);
    return;
  }
  const frag = document.createDocumentFragment();
  queue.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'queueItem' + (state.activeStoryId === s.id ? ' queueActive' : '');
    const left = document.createElement('div');
    left.className = 'queueLeft';
    const titleRow = document.createElement('div');
    titleRow.className = 'queueTitleRow';
    const title = document.createElement('span');
    title.className = 'queueTitle';
    title.textContent = s.title;
    const points = document.createElement('span');
    points.className = 'queuePoints';
    points.textContent = s.finalPoints ? `Final: ${s.finalPoints}` : 'Final: —';
    titleRow.appendChild(title);
    titleRow.appendChild(points);
    left.appendChild(titleRow);
    const meta = document.createElement('div');
    meta.className = 'queueMeta';
    meta.textContent = (state.activeStoryId === s.id ? 'Active Story' : '');
    left.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'queueActions';
    if (s.link) {
      const safe = normalizeUrl(s.link);
      if (safe) {
        const a = document.createElement('a');
        a.className = 'queueBtn queueLinkBtn';
        a.href = safe;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = 'Open Link';
        a.textContent = '🔗';
        actions.appendChild(a);
      }
    }
    if (state.youAreModerator) {
      const setBtn = document.createElement('button');
      setBtn.className = 'queueBtn primary';
      setBtn.type = 'button';
      setBtn.textContent = 'Set Active';
      setBtn.disabled = state.activeStoryId === s.id;
      setBtn.onclick = () => socket.emit('storyQueue:setActive', { roomId: currentRoom, storyId: s.id });
      const rmBtn = document.createElement('button');
      rmBtn.className = 'queueBtn';
      rmBtn.type = 'button';
      rmBtn.textContent = 'Remove';
      rmBtn.onclick = () => socket.emit('storyQueue:remove', { roomId: currentRoom, storyId: s.id });
      actions.appendChild(setBtn);
      actions.appendChild(rmBtn);
    }
    li.appendChild(left);
    li.appendChild(actions);
    frag.appendChild(li);
  });
  list.appendChild(frag);
}
