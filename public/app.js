/* global io */

/** ---------- Config ---------- */
const SOCKET_URL = window.location.origin;
try {
  // Only enable socket.io client debug if not already set
  if (typeof localStorage !== 'undefined' && localStorage.debug == null) {
    localStorage.debug = 'socket.io-client:*';
  }
} catch {}

/** ---------- DOM helpers ---------- */
const el = (id) => document.getElementById(id);

/** Safely normalize a URL string to http/https only. Returns '' if invalid. */
function normalizeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
}

/** Correct HTML escaping for text nodes. */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for attribute values (kept for consistency; textContent preferred). */
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

  // Use class toggling rather than inline style
  el('shareBox').classList.remove('hidden');

  const p = el('shareParticipant');
  p.textContent = participant; p.href = participant; p.rel = 'noopener noreferrer';

  const m = el('shareMod');
  m.textContent = facilitator; m.href = facilitator; m.rel = 'noopener noreferrer';

  el('copyParticipantBtn').onclick = () => copyToClipboard(participant);
  el('copyModBtn').onclick = () => copyToClipboard(facilitator);
}

/** ---- Small UI helpers ---- */
function show(id){ const n = el(id); if(n) n.classList.remove('hidden'); }
function hide(id){ const n = el(id); if(n) n.classList.add('hidden'); }
function setDisabled(id, v){ const n=el(id); if(n && 'disabled' in n) n.disabled = !!v; }

/** ---------- URL params ---------- */
let currentRoom = null;
let modKey = null;
let lastState = null;
let joinButtonClicked = false; // Track if Join button has been clicked
let roomCreated = false; // Track if room has been created
let userJoined = false; // Track if user has joined a room
let myVote = null; // Track this user's current vote locally

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
    const saved = sessionStorage.getItem('flaps_name');
    if (saved) el('name').value = saved;
  } catch {}
})();
function saveName(name){
  try { if (name) sessionStorage.setItem('flaps_name', name); } catch {}
}

/** ---------- Initial View: layout & gating ---------- */
function applyInitialRoleView(){
  const hasRoomInUrl = !!currentRoom;
  const hasModKey = !!modKey;

  show('name'); show('joinBtn');

  // Hide main content initially
  const mainContent = document.querySelector('main');
  if (mainContent) mainContent.style.display = 'none';

  // Disable name/join until a room exists (facilitator must create)
  if (!hasRoomInUrl) {
    setDisabled('name', true); setDisabled('joinBtn', true);
    show('roomId'); show('createRoomBtn');
    setDisabled('roomId', false); setDisabled('createRoomBtn', false);
    return;
  }

  // Show room name for any room URL (both facilitator and participant)
  const roomNameDisplay = el('roomNameDisplay');
  const roomNameText = el('roomNameText');
  if (roomNameDisplay && roomNameText && currentRoom) {
    roomNameText.textContent = currentRoom;
    roomNameDisplay.classList.remove('hidden');
  }

  // On /room/:id
  el('roomId').value = currentRoom;
  if (hasModKey){
    // Facilitator deep link - show main content and mark as joined
    if (mainContent) mainContent.style.display = '';
    roomCreated = true;
    userJoined = true;
    show('roomId'); show('createRoomBtn');
    setDisabled('roomId', true); setDisabled('createRoomBtn', true);
  } else {
    // Participant link: hide Create + Team Name, enable name/join, but keep main hidden until joined
    // Clear the name field for participants so they enter their own name
    const nameField = el('name');
    if (nameField) nameField.value = '';
    
    hide('createRoomBtn'); hide('roomId');
    setDisabled('name', false); setDisabled('joinBtn', false);
  }
}
applyInitialRoleView();

/** Allow Enter to trigger Join for convenience */
['roomId','name'].forEach(id=>{
  const n = el(id);
  n?.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') el('joinBtn').click();
  });
});

/** ---------- Socket.IO ---------- */
const socket = io(SOCKET_URL, {
  transports: ['websocket','polling'],
  withCredentials: false
});

socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
  if (currentRoom && modKey) {
    // Facilitator: auto-rejoin
    const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
    socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
  } else if (socket.recovered === false && joinButtonClicked) {
    // Participant reconnect after disconnect: re-enable join button
    joinButtonClicked = false;
    setDisabled('joinBtn', false);
  }
});
socket.on('connect_error', (err) => console.error('[socket] connect_error', err));
socket.on('disconnect', (reason) => console.warn('[socket] disconnected', reason));

/** ----- Server → Client events ----- */
socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  console.log('[socket] room:created', roomId);
  currentRoom = roomId; modKey = createdModKey;
  roomCreated = true;

  // Show main content now that room is created
  const mainContent = document.querySelector('main');
  if (mainContent) mainContent.style.display = '';

  // Show room name in header
  const roomNameDisplay = el('roomNameDisplay');
  const roomNameText = el('roomNameText');
  if (roomNameDisplay && roomNameText) {
    roomNameText.textContent = roomId;
    roomNameDisplay.classList.remove('hidden');
  }

  setShareLinks(roomId, createdModKey);
  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(createdModKey)}`;
  window.history.replaceState({}, '', newUrl);

  setPill(el('modePill'), 'Facilitator', 'good');

  // Lock Create + Team Name; enable Name + Join now
  show('createRoomBtn'); show('roomId');
  setDisabled('createRoomBtn', true); setDisabled('roomId', true);
  setDisabled('name', false); setDisabled('joinBtn', false);
});

socket.on('room:state', (state) => {
  // Keep lastState for finalize usage
  lastState = state;

  // Show main content when user joins (receives first room state)
  if (!userJoined) {
    userJoined = true;
    const mainContent = document.querySelector('main');
    if (mainContent) mainContent.style.display = '';
    
    // Show room name in header for participants
    const roomNameDisplay = el('roomNameDisplay');
    const roomNameText = el('roomNameText');
    if (roomNameDisplay && roomNameText && state.roomId) {
      roomNameText.textContent = state.roomId;
      roomNameDisplay.classList.remove('hidden');
    }
  }

  const modePill = el('modePill');
  if (modePill) setPill(modePill, state.youAreModerator ? 'Facilitator' : 'Participant', state.youAreModerator ? 'good' : '');
  
  const votePill = el('votePill');
  if (votePill) setPill(votePill, state.phase === 'revealed' ? 'Revealed' : 'Voting', state.phase === 'revealed' ? 'warn' : '');

  if (state.youAreModerator && modKey) setShareLinks(state.roomId, modKey);

  // Moderator controls
  const setStoryBtn = el('setStoryBtn');
  if (setStoryBtn) setStoryBtn.disabled = !state.youAreModerator;
  
  const hasActiveStory = !!state.activeStoryId;
  
  const revealBtn = el('revealBtn');
  if (revealBtn) {
    // Disable Reveal button when already revealed, enable when voting
    revealBtn.disabled = !state.youAreModerator || !hasActiveStory || state.phase === 'revealed';
  }
  
  const clearBtn = el('clearBtn');
  if (clearBtn) clearBtn.disabled = !state.youAreModerator || !hasActiveStory || !!state.story?.finalPoints;

  const canFinalize = state.youAreModerator && state.phase === 'revealed' && hasActiveStory;
  const finalPointsSelect = el('finalPointsSelect');
  if (finalPointsSelect) {
    finalPointsSelect.disabled = !canFinalize;
    
    // Add change listener to enable/disable finalize button based on selection
    finalPointsSelect.onchange = () => {
      const finalizeBtn = el('finalizeEstimateBtn');
      if (finalizeBtn) {
        finalizeBtn.disabled = !canFinalize || !finalPointsSelect.value;
      }
    };
  }
  
  const finalizeEstimateBtn = el('finalizeEstimateBtn');
  if (finalizeEstimateBtn) {
    // Disable if can't finalize OR no value selected in dropdown
    finalizeEstimateBtn.disabled = !canFinalize || !finalPointsSelect?.value;
  }

  // Roombar behavior
  if (state.youAreModerator){
    show('createRoomBtn'); show('roomId');
    setDisabled('createRoomBtn', true); setDisabled('roomId', true);
    el('createRoomBtn').title = 'Room already created';
    el('roomId').title = 'Team name is locked for this session';
    setDisabled('name', false); 
    // Keep Join button disabled if already clicked
    if (!joinButtonClicked) setDisabled('joinBtn', false);
  } else {
    hide('createRoomBtn'); hide('roomId');
    setDisabled('name', false); 
    // Keep Join button disabled if already clicked
    if (!joinButtonClicked) setDisabled('joinBtn', false);
    const hint = el('modHint'); if (hint) hint.textContent = 'Facilitators manage rooms and stories.';
  }

  // Show/hide story form inputs based on moderator status (but keep queue visible)
  console.log('[DEBUG] youAreModerator:', state.youAreModerator);
  
  const storyTitle = el('storyTitle');
  const storyDesc = el('storyDesc');
  const storyLink = el('storyLink');
  const addToQueueBtn = el('addToQueueBtn');
  const storyTitleLabel = document.querySelector('label[for="storyTitle"]');
  const storyDescLabel = document.querySelector('label[for="storyDesc"]');
  const storyLinkLabel = document.querySelector('label[for="storyLink"]');
  
  console.log('[DEBUG] Found elements:', {
    storyTitle: !!storyTitle,
    storyDesc: !!storyDesc,
    storyLink: !!storyLink,
    addToQueueBtn: !!addToQueueBtn
  });
  
  if (state.youAreModerator) {
    // Show form inputs for facilitators
    console.log('[DEBUG] Showing form inputs for facilitator');
    if (storyTitle) storyTitle.style.display = '';
    if (storyDesc) storyDesc.style.display = '';
    if (storyLink) storyLink.style.display = '';
    if (addToQueueBtn) addToQueueBtn.style.display = '';
    if (storyTitleLabel) storyTitleLabel.style.display = '';
    if (storyDescLabel) storyDescLabel.style.display = '';
    if (storyLinkLabel) storyLinkLabel.style.display = '';
    // Show facilitator-only vote controls
    show('revealBtn'); show('clearBtn');
    const finalizeRow = document.querySelector('.finalizeRow');
    if (finalizeRow) finalizeRow.style.display = '';
  } else {
    // Hide form inputs for participants (but keep queue visible)
    console.log('[DEBUG] Hiding form inputs for participant');
    if (storyTitle) storyTitle.style.display = 'none';
    if (storyDesc) storyDesc.style.display = 'none';
    if (storyLink) storyLink.style.display = 'none';
    if (addToQueueBtn) addToQueueBtn.style.display = 'none';
    if (storyTitleLabel) storyTitleLabel.style.display = 'none';
    if (storyDescLabel) storyDescLabel.style.display = 'none';
    if (storyLinkLabel) storyLinkLabel.style.display = 'none';
    // Hide facilitator-only vote controls
    hide('revealBtn'); hide('clearBtn');
    const finalizeRow = document.querySelector('.finalizeRow');
    if (finalizeRow) finalizeRow.style.display = 'none';
  }

  // If votes were cleared (phase is voting and our vote is null), deselect locally
  if (state.phase === 'voting') {
    const myEntry = state.mySocketId && state.users && state.users[state.mySocketId];
    if (!myEntry || myEntry.vote === null) {
      myVote = null;
    }
  }

  // Renders
  renderDeck(state.deck, state.phase, hasActiveStory);
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

  if (!currentRoom && !typedRoomId) return alert('Enter a Team Name or click Create Room.');

  const idToUse = currentRoom ?? typedRoomId;
  currentRoom = idToUse;
  
  // Disable the join button
  joinButtonClicked = true;
  setDisabled('joinBtn', true);
  
  socket.emit('room:join', { roomId: idToUse, name, modKey });
};

el('revealBtn').onclick = () => {
  if (!currentRoom) return;
  myVote = null;
  socket.emit('vote:reveal', { roomId: currentRoom });
};
el('clearBtn').onclick = () => { myVote = null; currentRoom && socket.emit('vote:clear', { roomId: currentRoom }); };

el('addToQueueBtn').onclick = () => {
  if (!currentRoom) return alert('Join a room first');
  const title = (el('storyTitle').value ?? '').trim();
  if (!title) return alert('Enter a Story Title to add to the queue.');

  socket.emit('storyQueue:add', {
    roomId: currentRoom,
    story: {
      title,
      desc: el('storyDesc').value,
      link: el('storyLink').value
    }
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

  socket.emit('storyQueue:finalize', {
    roomId: currentRoom,
    storyId: lastState.activeStoryId,
    finalPoints: pts
  });
  
  // Reset the dropdown and disable the button after finalizing
  el('finalPointsSelect').value = '';
  el('finalizeEstimateBtn').disabled = true;
};

/** ---------- Renderers ---------- */
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

function renderDeck(deck, phase, hasActiveStory) {
  const d = Array.isArray(deck) ? deck : [];
  const deckDiv = el('deck');
  deckDiv.innerHTML = '';
  const frag = document.createDocumentFragment();

  d.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'deckBtn';
    b.type = 'button';
    b.textContent = v;
    b.setAttribute('aria-label', `Vote ${v}`);
    
    // Disable voting cards when in revealed state OR when no active story
    if (phase === 'revealed' || !hasActiveStory) {
      b.disabled = true;
      b.onclick = null;
    } else {
      b.disabled = false;
      b.onclick = () => {
        if (currentRoom) {
          myVote = v;
          socket.emit('vote:set', { roomId: currentRoom, vote: v });
        }
      };
    }

    if (v === myVote && phase !== 'revealed') b.classList.add('active');
    
    frag.appendChild(b);
  });

  deckDiv.appendChild(frag);
}

function renderUsers(users, phase) {
  const list = el('usersList');
  if (!list) return;
  list.innerHTML = '';

  const entries = Object.values(users ?? {});
  const usersPill = el('usersPill');
  if (usersPill) usersPill.textContent = String(entries.length);

  entries.sort((a,b)=> (a.name ?? '').localeCompare(b.name ?? ''));

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

function renderResults(state) {
  const r = el('results');

  if (state.phase !== 'revealed') {
    r.textContent = 'Votes are hidden until the facilitator reveals.';
    r.className = 'hint';
    return;
  }

  const votes = Object.values(state.users ?? {})
    .map((u) => {
      const vote = u.vote;
      // Treat coffee cup as 0 for calculations
      if (vote === '☕') return 0;
      // Treat question mark as non-numeric (exclude from calculations)
      if (vote === '?') return null;
      return vote;
    })
    .filter((v) => v != null && !Number.isNaN(Number(v)))
    .map(Number)
    .sort((a,b) => a - b);

  if (!votes.length) {
    r.textContent = 'No votes recorded.';
    r.className = 'hint';
    return;
  }

  const min = votes[0];
  const max = votes[votes.length-1];
  const avg = (votes.reduce((a,b)=>a+b,0)/votes.length).toFixed(1);
  const median = votes.length % 2
    ? votes[(votes.length-1)/2]
    : ((votes[votes.length/2-1] + votes[votes.length/2]) / 2).toFixed(1);

  const summary = document.createElement('div');
  summary.className = 'summary';

  const metrics = [];
  if (state.story?.finalPoints) metrics.push({ label: 'Final', value: state.story.finalPoints, final: true });
  metrics.push(
    { label: 'Min',    value: min },
    { label: 'Max',    value: max },
    { label: 'Avg',    value: avg },
    { label: 'Median', value: median }
  );

  metrics.forEach((m) => {
    const chip = document.createElement('div');
    chip.className = 'metricChip' + (m.final ? ' isFinal' : '');

    const label = document.createElement('span');
    label.className = 'metricLabel';
    label.textContent = m.label;

    const value = document.createElement('span');
    value.className = 'metricValue';
    value.textContent = m.value;

    chip.appendChild(label);
    chip.appendChild(value);
    summary.appendChild(chip);
  });

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
