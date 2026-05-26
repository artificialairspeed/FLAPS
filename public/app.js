/* global io */

/** ---------- Config ---------- */
const SOCKET_URL = window.location.origin;

/** ---------- DOM helpers ---------- */
const el = (id) => document.getElementById(id);

/** Safely normalize a URL string to http/https only. Returns '' if invalid. */
function normalizeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    // Block javascript: and data: URLs for security
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
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

  // Show share button in header
  const shareBtn = el('shareParticipantBtn');
  if (shareBtn) {
    shareBtn.classList.remove('hidden');
    shareBtn.onclick = async () => {
      await copyToClipboard(participant);
      
      // Show feedback
      const feedback = el('shareFeedback');
      if (feedback) {
        feedback.classList.remove('hidden');
        setTimeout(() => {
          feedback.classList.add('hidden');
        }, 2000);
      }
    };
  }
}

/** ---- Small UI helpers ---- */
function show(id){ const n = el(id); if(n) n.classList.remove('hidden'); }
function hide(id){ const n = el(id); if(n) n.classList.add('hidden'); }
function setDisabled(id, v){ const n=el(id); if(n && 'disabled' in n) n.disabled = !!v; }

/** Toast notification system */
function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function setLoading(buttonId, loading) {
  const btn = el(buttonId);
  if (!btn) return;
  
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Loading...';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
    delete btn.dataset.originalText;
  }
}

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
  if (parts[0] === 'room' && parts[1]) currentRoom = decodeURIComponent(parts[1]).toUpperCase();
  modKey = url.searchParams.get('mod') ?? null;
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

/** ---------- Remember joined state ---------- */
function saveJoinedState(){
  try { 
    if (currentRoom) {
      sessionStorage.setItem('flaps_joined_' + currentRoom, 'true'); 
    }
  } catch {}
}
function isAlreadyJoined(){
  try { 
    if (currentRoom) {
      return sessionStorage.getItem('flaps_joined_' + currentRoom) === 'true';
    }
  } catch {}
  return false;
}

/** ---------- Initial View: layout & gating ---------- */
function applyInitialRoleView(){
  const hasRoomInUrl = !!currentRoom;
  const hasModKey = !!modKey;

  // Hide main content initially
  const mainContent = document.querySelector('main');
  if (mainContent) mainContent.style.display = 'none';

  // Disable name/join until a room exists (facilitator must create)
  if (!hasRoomInUrl) {
    hide('name'); hide('joinBtn');
    show('createRoomBtn');
    setDisabled('createRoomBtn', false);
    return;
  }

  // Check if user already joined this room
  if (isAlreadyJoined()) {
    joinButtonClicked = true;
    userJoined = true;
    setDisabled('name', true);
    setDisabled('joinBtn', true);
  }

  // On /room/:id
  if (hasModKey){
    // Facilitator deep link - show main content and mark as joined
    if (mainContent) mainContent.style.display = '';
    roomCreated = true;
    userJoined = true;
    
    // Show green "Room Created" button
    const createBtn = el('createRoomBtn');
    if (createBtn) {
      createBtn.textContent = 'Room Created';
      createBtn.classList.add('roomCreated');
      createBtn.disabled = true;
    }
    show('createRoomBtn');
    show('name'); show('joinBtn');
  } else {
    // Participant link: hide Create button, enable name/join, but keep main hidden until joined
    // Clear the name field for participants so they enter their own name
    const nameField = el('name');
    if (nameField && !isAlreadyJoined()) nameField.value = '';
    
    hide('createRoomBtn');
    show('name'); show('joinBtn');
    if (!isAlreadyJoined()) {
      setDisabled('name', false); 
      setDisabled('joinBtn', false);
    }
  }
}
applyInitialRoleView();

/** Allow Enter to trigger the appropriate action for convenience */
const nameField = el('name');
nameField?.addEventListener('keydown', (e)=>{
  if (e.key !== 'Enter') return;
  el('joinBtn').click();
});

/** Prevent special characters and numbers in name field */
nameField?.addEventListener('input', (e) => {
  const input = e.target;
  // Only allow letters and spaces
  input.value = input.value.replace(/[^A-Za-z\s]/g, '');
});

/** ---------- Socket.IO ---------- */
const socket = io(SOCKET_URL, {
  transports: ['websocket','polling'],
  withCredentials: false
});

socket.on('connect', () => {
  if (currentRoom && modKey) {
    // Facilitator: auto-rejoin
    const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
    socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
  } else if (socket.recovered === false && joinButtonClicked) {
    // Participant reconnect after disconnect: re-enable join button
    joinButtonClicked = false;
    setDisabled('joinBtn', false);
  }
  
  // Update connection status
  const modePill = el('modePill');
  if (modePill && modePill.textContent === 'Disconnected') {
    setPill(modePill, 'Reconnected', 'good');
    setTimeout(() => {
      if (lastState) {
        setPill(modePill, lastState.youAreModerator ? 'Facilitator' : 'Participant', lastState.youAreModerator ? 'good' : '');
      }
    }, 2000);
  }
});

socket.on('connect_error', (err) => {
  console.error('[socket] connect_error', err);
  showToast('Connection error. Retrying...', 'error');
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected', reason);
  const modePill = el('modePill');
  if (modePill) setPill(modePill, 'Disconnected', 'warn');
  showToast('Disconnected from server', 'warn');
});

socket.on('error', ({ message }) => {
  showToast(message || 'An error occurred', 'error');
});

/** ----- Server → Client events ----- */
socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  currentRoom = roomId; modKey = createdModKey;
  roomCreated = true;
  userJoined = true; // Mark as joined so functionality is enabled
  saveJoinedState(); // Save that facilitator has joined
  
  // Clear loading state
  setLoading('createRoomBtn', false);

  // Show main content now that room is created
  const mainContent = document.querySelector('main');
  if (mainContent) mainContent.style.display = '';

  setShareLinks(roomId, createdModKey);
  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(createdModKey)}`;
  window.history.replaceState({}, '', newUrl);

  setPill(el('modePill'), 'Facilitator', 'good');

  // Change Create Room button to green "Room Created"
  const createBtn = el('createRoomBtn');
  if (createBtn) {
    createBtn.textContent = 'Room Created';
    createBtn.classList.add('roomCreated');
    createBtn.disabled = true;
  }

  // Show Name + Join on row 2 (optional for facilitator)
  show('name'); show('joinBtn');
  setDisabled('name', false); setDisabled('joinBtn', false);
  
  // Auto-join the facilitator with their name or default
  const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
  socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
});

socket.on('room:state', (state) => {
  // Keep lastState for finalize usage
  lastState = state;
  
  // Clear loading states on successful join
  if (joinButtonClicked) {
    setLoading('joinBtn', false);
    // Keep both join button and name field disabled after successful join
    setDisabled('joinBtn', true);
    setDisabled('name', true);
  }

  // Show main content when user joins (receives first room state)
  if (!userJoined) {
    userJoined = true;
    saveJoinedState(); // Save that user has joined this room
    const mainContent = document.querySelector('main');
    if (mainContent) mainContent.style.display = '';
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
    const createBtn = el('createRoomBtn');
    if (createBtn && roomCreated) {
      createBtn.textContent = 'Room Created';
      createBtn.classList.add('roomCreated');
      createBtn.disabled = true;
    }
    show('createRoomBtn');
    // Keep name field disabled if already joined
    if (joinButtonClicked) {
      setDisabled('name', true);
      setDisabled('joinBtn', true);
    } else {
      setDisabled('name', false);
      setDisabled('joinBtn', false);
    }
  } else {
    hide('createRoomBtn');
    // Keep name field disabled if already joined
    if (joinButtonClicked) {
      setDisabled('name', true);
      setDisabled('joinBtn', true);
    } else {
      setDisabled('name', false);
      setDisabled('joinBtn', false);
    }
    const hint = el('modHint'); if (hint) hint.textContent = 'Facilitators manage rooms and stories.';
  }

  // Show/hide story form inputs based on moderator status (but keep queue visible)
  const storyNumber = el('storyNumber');
  const storyTitle = el('storyTitle');
  const storyNotes = el('storyNotes');
  const addToQueueBtn = el('addToQueueBtn');
  const storyNumberLabel = document.querySelector('label[for="storyNumber"]');
  const storyTitleLabel = document.querySelector('label[for="storyTitle"]');
  const storyNotesLabel = document.querySelector('label[for="storyNotes"]');
  const addStoryHeader = document.querySelector('.storyForm > .resultsTitle:first-child');
  const storyInputRow = document.querySelector('.storyInputRow');
  const storyQueueHeader = document.querySelectorAll('.storyForm > .resultsTitle')[1]; // Second header (Story Queue)
  
  if (state.youAreModerator) {
    // Show entire Add a Story section for facilitators
    if (addStoryHeader) addStoryHeader.style.display = '';
    if (storyInputRow) storyInputRow.style.display = '';
    if (storyNumber) storyNumber.style.display = '';
    if (storyTitle) storyTitle.style.display = '';
    if (storyNotes) storyNotes.style.display = '';
    if (addToQueueBtn) addToQueueBtn.style.display = '';
    if (storyNumberLabel) storyNumberLabel.style.display = '';
    if (storyTitleLabel) storyTitleLabel.style.display = '';
    if (storyNotesLabel) storyNotesLabel.style.display = '';
    // Reset Story Queue header margin for facilitators
    if (storyQueueHeader) storyQueueHeader.style.marginTop = '';
    // Show facilitator-only vote controls
    show('revealBtn'); show('clearBtn');
    const finalizeRow = document.querySelector('.finalizeRow');
    if (finalizeRow) finalizeRow.style.display = '';
  } else {
    // Hide entire Add a Story section for participants (but keep queue visible)
    if (addStoryHeader) addStoryHeader.style.display = 'none';
    if (storyInputRow) storyInputRow.style.display = 'none';
    if (storyNumber) storyNumber.style.display = 'none';
    if (storyTitle) storyTitle.style.display = 'none';
    if (storyNotes) storyNotes.style.display = 'none';
    if (addToQueueBtn) addToQueueBtn.style.display = 'none';
    if (storyNumberLabel) storyNumberLabel.style.display = 'none';
    if (storyTitleLabel) storyTitleLabel.style.display = 'none';
    if (storyNotesLabel) storyNotesLabel.style.display = 'none';
    // Add top margin to Story Queue header to match facilitator view alignment
    if (storyQueueHeader) storyQueueHeader.style.marginTop = '10px';
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
  renderStory(state.story, (state.storyQueue ?? []).length);
  renderResults(state);
  renderQueue(state);
});

/** ---------- UI → Server ---------- */
el('createRoomBtn').onclick = () => {
  const name = (el('name').value ?? '').trim() || 'Facilitator';
  saveName(name);
  setLoading('createRoomBtn', true);
  socket.emit('room:create', { name });
  
  // Reset loading state after timeout (in case of no response)
  setTimeout(() => setLoading('createRoomBtn', false), 5000);
};

el('joinBtn').onclick = () => {
  const name = (el('name').value ?? '').trim();
  if (!name) return showToast('Enter your name.', 'error');
  saveName(name);

  if (!currentRoom) return showToast('No room to join. Create a room first.', 'error');
  
  // Disable the join button and name field, show loading
  joinButtonClicked = true;
  setLoading('joinBtn', true);
  setDisabled('name', true);
  
  socket.emit('room:join', { roomId: currentRoom, name, modKey });
  
  // Reset loading state after timeout (in case of no response)
  setTimeout(() => {
    if (joinButtonClicked && !userJoined) {
      setLoading('joinBtn', false);
      setDisabled('name', false);
      joinButtonClicked = false;
    }
  }, 5000);
};

el('revealBtn').onclick = () => {
  if (!currentRoom) return;
  myVote = null;
  socket.emit('vote:reveal', { roomId: currentRoom });
};
el('clearBtn').onclick = () => { myVote = null; currentRoom && socket.emit('vote:clear', { roomId: currentRoom }); };

el('addToQueueBtn').onclick = () => {
  if (!currentRoom) return showToast('Join a room first', 'error');
  const title = (el('storyTitle').value ?? '').trim();
  if (!title) return showToast('Enter a Story Title to add to the queue.', 'error');

  socket.emit('storyQueue:add', {
    roomId: currentRoom,
    story: {
      number: el('storyNumber').value,
      title,
      desc: el('storyNotes').value
    }
  });

  el('storyNumber').value = '';
  el('storyTitle').value = '';
  el('storyNotes').value = '';
  el('storyTitle').focus();
};

el('finalizeEstimateBtn').onclick = () => {
  if (!currentRoom) return showToast('Join a room first', 'error');
  if (!lastState?.activeStoryId) return showToast('Set an active story first.', 'error');
  const pts = el('finalPointsSelect').value;
  if (!pts) return showToast('Select final points.', 'error');

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
      b.tabIndex = -1;
    } else {
      b.disabled = false;
      b.tabIndex = 0;
      const voteHandler = () => {
        if (currentRoom) {
          myVote = v;
          socket.emit('vote:set', { roomId: currentRoom, vote: v });
        }
      };
      b.onclick = voteHandler;
      
      // Keyboard support: Enter or Space to vote
      b.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          voteHandler();
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

    const nameContainer = document.createElement('div');
    nameContainer.className = 'unameContainer';

    // Add role icon
    const roleIcon = document.createElement('span');
    roleIcon.className = 'roleIcon';
    if (u.isModerator) {
      roleIcon.textContent = '👑';
      roleIcon.title = 'Facilitator';
      roleIcon.setAttribute('aria-label', 'Facilitator');
    } else {
      roleIcon.textContent = '👤';
      roleIcon.title = 'Participant';
      roleIcon.setAttribute('aria-label', 'Participant');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'uname';
    nameSpan.textContent = u.name ?? '';

    nameContainer.appendChild(roleIcon);
    nameContainer.appendChild(nameSpan);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'ustatus';
    if (phase === 'revealed') {
      statusSpan.textContent = (u.vote ?? '—');
    } else {
      statusSpan.textContent = (u.vote === 'selected' ? '✔ Selected' : '—');
    }

    li.appendChild(nameContainer);
    li.appendChild(statusSpan);
    frag.appendChild(li);
  });

  list.appendChild(frag);
}

function renderStory(story, queueLength) {
  const view = el('storyView');
  view.innerHTML = '';

  const titleRow = document.createElement('div');
  titleRow.className = 'storyTitleRow';

  const title = document.createElement('div');
  title.className = 'storyTitle';

  const isPlaceholder = !story?.desc && !story?.number && !story?.finalPoints;
  if (isPlaceholder && queueLength > 0) {
    title.textContent = 'Select a Story from the Queue to Estimate';
  } else {
    // Display story number and title together
    const displayText = story?.number 
      ? `${story.number} - ${story?.title ?? ''}` 
      : story?.title ?? '';
    title.textContent = displayText;
  }

  titleRow.appendChild(title);

  // Final pill (always visible on the right)
  if (!isPlaceholder) {
    const finalPill = document.createElement('span');
    finalPill.className = 'storyFinalPill';
    finalPill.textContent = story?.finalPoints ? `Final: ${story.finalPoints}` : 'Final: —';
    titleRow.appendChild(finalPill);
  }

  const desc = document.createElement('div');
  desc.className = 'storyDesc';
  desc.textContent = story?.desc ?? '';

  view.appendChild(titleRow);
  view.appendChild(desc);
}

function renderResults(state) {
  const r = el('results');

  if (state.phase !== 'revealed') {
    // Show placeholder metrics before reveal
    const summary = document.createElement('div');
    summary.className = 'summary';

    const placeholderMetrics = [
      { label: 'Final', value: '—' },
      { label: 'Min', value: '—' },
      { label: 'Max', value: '—' },
      { label: 'Avg', value: '—' },
      { label: 'Median', value: '—' }
    ];

    placeholderMetrics.forEach((m) => {
      const chip = document.createElement('div');
      chip.className = 'metricChip';

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
    // Show placeholder metrics when no votes
    const summary = document.createElement('div');
    summary.className = 'summary';

    const placeholderMetrics = [
      { label: 'Final', value: '—' },
      { label: 'Min', value: '—' },
      { label: 'Max', value: '—' },
      { label: 'Avg', value: '—' },
      { label: 'Median', value: '—' }
    ];

    placeholderMetrics.forEach((m) => {
      const chip = document.createElement('div');
      chip.className = 'metricChip';

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
  // Always add Final metric first (with value or placeholder)
  const finalValue = state.story?.finalPoints || '—';
  const isFinal = !!state.story?.finalPoints;
  metrics.push({ label: 'Final', value: finalValue, final: isFinal });
  
  // Add calculation metrics
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
    // Display story number and title together, limit to 30 characters
    const displayText = s.number ? `${s.number} - ${s.title}` : s.title;
    title.textContent = displayText.length > 30 ? displayText.substring(0, 30) + '...' : displayText;

    titleRow.appendChild(title);
    left.appendChild(titleRow);

    const meta = document.createElement('div');
    meta.className = 'queueMeta';
    meta.textContent = (state.activeStoryId === s.id ? 'Active Story' : '');
    left.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'queueActions';

    if (state.youAreModerator) {
      // Final pill button (always visible)
      const finalPill = document.createElement('button');
      finalPill.className = 'queueBtn finalPill';
      finalPill.type = 'button';
      finalPill.textContent = s.finalPoints ? `Final: ${s.finalPoints}` : 'Final: —';
      finalPill.disabled = true;

      const setBtn = document.createElement('button');
      setBtn.className = 'queueBtn primary';
      setBtn.type = 'button';
      setBtn.textContent = 'Estimate';
      setBtn.disabled = state.activeStoryId === s.id;
      setBtn.onclick = () => socket.emit('storyQueue:setActive', { roomId: currentRoom, storyId: s.id });

      const rmBtn = document.createElement('button');
      rmBtn.className = 'queueBtn';
      rmBtn.type = 'button';
      rmBtn.textContent = 'Remove';
      rmBtn.onclick = () => socket.emit('storyQueue:remove', { roomId: currentRoom, storyId: s.id });

      actions.appendChild(finalPill);
      actions.appendChild(setBtn);
      actions.appendChild(rmBtn);
    }

    li.appendChild(left);
    li.appendChild(actions);
    frag.appendChild(li);
  });

  list.appendChild(frag);
}
