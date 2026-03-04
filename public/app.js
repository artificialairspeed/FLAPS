/* global io */

/** ---------- DOM helpers ---------- */
const el = (id) => document.getElementById(id);
function show(id){ const n = el(id); if (n) n.classList.remove('hidden'); }
function hide(id){ const n = el(id); if (n) n.classList.add('hidden'); }
function setDisabled(id, v){ const n = el(id); if (n && 'disabled' in n) n.disabled = !!v; }

/** ---------- Utilities ---------- */
function normalizeUrl(raw){
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
}
function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function setPill(target, text, kind = ''){
  const pill = typeof target === 'string' ? el(target) : target;
  if (!pill) return;
  pill.textContent = text;
  pill.classList.toggle('good', kind === 'good');
  pill.classList.toggle('warn', kind === 'warn');
}
async function copyToClipboard(text){
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
function setShareLinks(roomId, mk){
  const base = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
  const participant = base;
  const facilitator = `${base}?mod=${encodeURIComponent(mk)}`;
  const p = el('shareParticipant');
  const m = el('shareMod');
  if (p) { p.textContent = participant; p.href = participant; }
  if (m) { m.textContent = facilitator; m.href = facilitator; }
  el('copyParticipantBtn')?.addEventListener('click', () => copyToClipboard(participant));
  el('copyModBtn')?.addEventListener('click', () => copyToClipboard(facilitator));
}

/** ---------- Deck normalization ----------
 * Rules:
 *  - Replace 0 with 0.5
 *  - Deduplicate while preserving order
 */
function normalizeDeck(deck){
  const src = Array.isArray(deck) ? deck : [];
  const out = [];
  const seen = new Set();
  for (const v of src){
    const nv = (v === 0 || v === '0') ? '0.5' : String(v);
    if (seen.has(nv)) continue;
    seen.add(nv);
    out.push(nv);
  }
  return out;
}

/** ---------- URL params ---------- */
let currentRoom = null;
let modKey = null;
let lastState = null;
(function parseFromUrl(){
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
  const hasMod = !!modKey;

  show('name');
  show('joinBtn');

  if (!hasRoomInUrl){
    show('roomId');
    show('createRoomBtn');
    setDisabled('roomId', false);
    setDisabled('createRoomBtn', false);
    return;
  }

  el('roomId').value = currentRoom;

  if (hasMod){
    show('roomId');
    show('createRoomBtn');
    setDisabled('roomId', true);
    setDisabled('createRoomBtn', true);
  } else {
    hide('roomId');
    hide('createRoomBtn');
  }
}
applyInitialRoleView();

// Enter key submits Join
['roomId','name'].forEach((id) => {
  el(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('joinBtn')?.click();
  });
});

/** ---------- Socket.IO (same-origin) ---------- */
const socket = io();

/** ---------- Client → Server actions ---------- */
el('createRoomBtn')?.addEventListener('click', () => {
  const desiredRoomId = (el('roomId').value ?? '').trim().toUpperCase();
  const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
  setPill('modePill', 'Creating room...', '');
  socket.emit('room:create', { desiredRoomId, name: nameVal });
});

el('joinBtn')?.addEventListener('click', () => {
  const roomId = ((el('roomId').value ?? '').trim().toUpperCase()) || currentRoom;
  const nameVal = (el('name').value ?? '').trim() || 'Anonymous';

  if (!roomId){
    setPill('modePill', 'Enter a Team Name', 'warn');
    el('roomId')?.focus();
    return;
  }

  saveName(nameVal);
  setPill('modePill', 'Joining...', '');
  socket.emit('room:join', { roomId, name: nameVal, modKey });
});

el('revealBtn')?.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('vote:reveal', { roomId: currentRoom });
});

el('clearBtn')?.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('vote:clear', { roomId: currentRoom });
});

el('addToQueueBtn')?.addEventListener('click', () => {
  if (!currentRoom) return;
  const title = (el('storyTitle')?.value ?? '').trim();
  const desc = (el('storyDesc')?.value ?? '').trim();
  const link = normalizeUrl((el('storyLink')?.value ?? '').trim());

  if (!title){
    setPill('modePill', 'Story title required', 'warn');
    el('storyTitle')?.focus();
    return;
  }

  socket.emit('storyQueue:add', { roomId: currentRoom, story: { title, desc, link } });
  el('storyTitle').value = '';
  el('storyDesc').value = '';
  el('storyLink').value = '';
});

el('finalizeEstimateBtn')?.addEventListener('click', () => {
  if (!currentRoom) return;
  const storyId = lastState?.activeStoryId;
  const finalPoints = el('finalPointsSelect')?.value;

  if (!storyId){
    setPill('modePill', 'Set an active story before finalizing', 'warn');
    return;
  }
  if (!finalPoints){
    setPill('modePill', 'Select final points', 'warn');
    return;
  }

  socket.emit('storyQueue:finalize', { roomId: currentRoom, storyId, finalPoints });
});

/** ---------- Server → Client events ---------- */
socket.on('connect', () => {
  setPill('modePill', 'Connected (not in room)', '');
  // Facilitator link: auto-join
  if (currentRoom && modKey){
    const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
    socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
  }
});

socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  currentRoom = roomId;
  modKey = createdModKey;

  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(modKey)}`;
  window.history.replaceState({}, '', newUrl);

  el('roomId').value = roomId;
  setShareLinks(roomId, modKey);
  show('shareBox');
  setPill('modePill', `Room ${roomId} created`, 'good');
  applyInitialRoleView();
});

socket.on('room:state', (state) => {
  lastState = state;
  currentRoom = state.roomId;

  setPill('modePill', state.youAreModerator ? 'Facilitator' : 'Participant', 'good');
  setPill('votePill', state.phase === 'revealed' ? 'Revealed' : 'Voting', state.phase === 'revealed' ? 'warn' : 'good');

  const hint = el('modHint');
  if (hint){
    hint.textContent = state.youAreModerator
      ? 'You are the facilitator. You can Reveal / Clear, manage queue, and finalize.'
      : 'Waiting for facilitator actions.';
  }

  if (state.youAreModerator && modKey){
    setShareLinks(state.roomId, modKey);
    show('shareBox');
  }

  // Users
  const usersArr = Object.values(state.users ?? {});
  if (el('usersPill')) el('usersPill').textContent = String(usersArr.length);
  const usersList = el('usersList');
  if (usersList){
    usersList.innerHTML = '';
    for (const u of usersArr){
      const li = document.createElement('li');
      li.innerHTML = `<span class="uname">${escapeHtml(u.name)}</span><span class="ustatus">${escapeHtml(u.vote ?? '')}</span>`;
      usersList.appendChild(li);
    }
  }

  // Story
  const storyView = el('storyView');
  if (storyView){
    const title = escapeHtml(state.story?.title ?? '');
    const desc = escapeHtml(state.story?.desc ?? '');
    const link = escapeHtml(state.story?.link ?? '');
    const fp = state.story?.finalPoints ? `<span class="pointsBadge">${escapeHtml(state.story.finalPoints)}</span>` : '';

    storyView.innerHTML = `
      <div class="storyTitle">${title}${fp}</div>
      <div class="storyDesc">${desc}</div>
      <div class="storyLink">${link ? `${link}${link}</a>` : ''}</div>
    `;
  }

  // Deck and finalize select
  renderDeck(state.deck ?? [], state.phase);
  populateFinalSelect(state.deck ?? []);

  // Queue
  renderQueue(state.storyQueue ?? [], state.activeStoryId, !!state.youAreModerator);

  // Role-based enable/disable
  setDisabled('revealBtn', !state.youAreModerator);
  setDisabled('clearBtn', !state.youAreModerator);
  setDisabled('addToQueueBtn', !state.youAreModerator);
  setDisabled('finalPointsSelect', !state.youAreModerator);
  setDisabled('finalizeEstimateBtn', !state.youAreModerator);
});

socket.on('connect_error', (err) => console.error('[socket] connect_error', err));
socket.on('disconnect', (reason) => setPill('modePill', `Disconnected (${reason})`, 'warn'));

/** ---------- Rendering helpers ---------- */
function renderDeck(deck, phase){
  const host = el('deck');
  if (!host) return;
  host.innerHTML = '';

  const normalized = normalizeDeck(deck);
  for (const v of normalized){
    const btn = document.createElement('button');
    btn.className = 'deckBtn';
    btn.type = 'button';
    btn.textContent = v;
    btn.disabled = !currentRoom || phase !== 'voting';

    btn.addEventListener('click', () => {
      if (!currentRoom) return;
      socket.emit('vote:set', { roomId: currentRoom, vote: v });
    });

    host.appendChild(btn);
  }
}

function populateFinalSelect(deck){
  const sel = el('finalPointsSelect');
  if (!sel) return;

  const normalized = normalizeDeck(deck);
  const current = sel.value;
  sel.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select final points…';
  sel.appendChild(placeholder);

  for (const v of normalized){
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }

  if (current && normalized.includes(current)) sel.value = current;
}

function renderQueue(queue, activeId, canManage){
  const ul = el('storyQueueList');
  if (!ul) return;
  ul.innerHTML = '';

  for (const item of queue){
    const li = document.createElement('li');
    li.className = 'queueItem' + (item.id === activeId ? ' queueActive' : '');

    const left = document.createElement('div');
    left.className = 'queueLeft';

    const titleRow = document.createElement('div');
    titleRow.className = 'queueTitleRow';

    const title = document.createElement('div');
    title.className = 'queueTitle';
    title.textContent = item.title;

    const badge = document.createElement('div');
    badge.className = 'queuePoints';
    badge.textContent = item.finalPoints ? `Final: ${item.finalPoints}` : '—';

    titleRow.appendChild(title);
    titleRow.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'queueMeta';
    meta.textContent = item.link ? item.link : '';

    left.appendChild(titleRow);
    left.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'queueActions';

    if (item.link){
      const a = document.createElement('a');
      a.className = 'queueBtn queueLinkBtn';
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '↗';
      actions.appendChild(a);
    }

    if (canManage){
      const setActive = document.createElement('button');
      setActive.className = 'queueBtn';
      setActive.type = 'button';
      setActive.textContent = 'Set Active';
      setActive.addEventListener('click', () => {
        socket.emit('storyQueue:setActive', { roomId: currentRoom, storyId: item.id });
      });

      const remove = document.createElement('button');
      remove.className = 'queueBtn';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        socket.emit('storyQueue:remove', { roomId: currentRoom, storyId: item.id });
      });

      actions.appendChild(setActive);
      actions.appendChild(remove);
    }

    li.appendChild(left);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}
