/* global io */

/** ---------- Config ---------- */
const SOCKET_URL = window.location.origin;

/** ---------- DOM helpers ---------- */
const el = (id) => document.getElementById(id);

/** ---------- Cached DOM elements ---------- */
// Cache frequently accessed elements for performance
let cachedElements = {};

function initializeCachedElements() {
  cachedElements = {
    name: el('name'),
    emoji: el('emoji'),
    main: document.querySelector('main'),
    footer: document.querySelector('footer'),
    createRoomBtn: el('createRoomBtn'),
    modePill: el('modePill'),
    jiraNumber: el('jiraNumber'),
    storyTitle: el('storyTitle'),
    storyDesc: el('storyDesc'),
    deck: el('deck')
  };
}

// Initialize cached elements when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCachedElements);
} else {
  initializeCachedElements();
}

function setPill(pillEl, text, kind = '') {
  pillEl.textContent = text;
  pillEl.classList.toggle('good', kind === 'good');
  pillEl.classList.toggle('warn', kind === 'warn');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard API failed, fall back to legacy method
  }
  
  // Fallback: use temporary textarea with execCommand
  const t = document.createElement('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  try { 
    document.execCommand('copy'); 
  } catch {
    // execCommand also failed, silently ignore
  }
  t.remove();
}

function setShareLinks(roomId) {
  const base = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
  const participant = base;

  // Show share button in header
  const shareBtn = el('shareParticipantBtn');
  if (shareBtn) {
    shareBtn.classList.remove('hidden');
    shareBtn.onclick = async () => {
      await copyToClipboard(participant);
      showToast('✓ Link copied to clipboard!', 'success');
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
  
  // Stack toasts vertically in the center
  const existingToasts = document.querySelectorAll('.toast.show');
  let offset = 0;
  existingToasts.forEach((t) => {
    const toastHeight = t.offsetHeight;
    offset += toastHeight + 10; // 10px gap between toasts
  });
  
  // Adjust top position for stacking (centered vertically with offset)
  if (offset > 0) {
    toast.style.top = `calc(50% + ${offset}px)`;
  }
  
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
let selectedFinalPoint = null; // Track selected final point for finalization
const RECONNECTION_TIMEOUT_MS = 5000; // Timeout for automatic reconnection attempts

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
    const nameField = cachedElements.name || el('name');
    if (saved && nameField) nameField.value = saved;
  } catch {}
})();
function saveName(name){
  try { if (name) sessionStorage.setItem('flaps_name', name); } catch {}
}

/** ---------- Remember my emoji ---------- */
(function loadSavedEmoji(){
  try {
    const saved = sessionStorage.getItem('flaps_emoji');
    const emojiField = cachedElements.emoji || el('emoji');
    if (saved && emojiField) emojiField.value = saved;
  } catch {}
})();
function saveEmoji(emoji){
  try { sessionStorage.setItem('flaps_emoji', emoji ?? ''); } catch {}
}
/** Read the currently selected emoji from the selector */
function getSelectedEmoji(){
  const emojiField = cachedElements.emoji || el('emoji');
  return (emojiField?.value ?? '').trim();
}
/** Retrieve stored emoji from sessionStorage for automatic reconnection */
function getStoredEmoji(){
  return getStoredValue('flaps_emoji', (val) => (typeof val === 'string' ? val : null)) || '';
}

/** ---------- Remember joined state ---------- */
function saveJoinedState(){
  try { 
    if (currentRoom) {
      // Trim and validate room ID before storing
      const roomIdToStore = currentRoom.trim();
      if (!roomIdToStore) {
        console.warn('Cannot save session state: invalid room ID');
        return;
      }
      
      // Store joined flag for backward compatibility
      sessionStorage.setItem('flaps_joined_' + roomIdToStore, 'true');
      
      // Store room ID for automatic reconnection
      sessionStorage.setItem('flaps_room_id', roomIdToStore);
      
      // Store user name for automatic reconnection
      const nameField = cachedElements.name || el('name');
      const userName = (nameField?.value ?? '').trim();
      if (userName) {
        sessionStorage.setItem('flaps_user_name', userName);
      }
    }
  } catch (err) {
    // Handle sessionStorage errors gracefully (quota exceeded, unavailable)
    console.warn('Failed to save session state:', err);
  }
}
function isAlreadyJoined(){
  try { 
    if (currentRoom) {
      return sessionStorage.getItem('flaps_joined_' + currentRoom) === 'true';
    }
  } catch {}
  return false;
}

/** Helper function to retrieve and validate stored value from sessionStorage */
function getStoredValue(key, validator = (val) => val){
  try {
    const value = sessionStorage.getItem(key);
    // Apply validator function to check if value is acceptable
    if (value && validator(value)) {
      return validator(value);
    }
  } catch (err) {
    // Handle sessionStorage errors gracefully (unavailable, corrupted data)
    console.warn(`Failed to retrieve stored ${key}:`, err);
  }
  return null;
}

/** Retrieve stored room ID from sessionStorage for automatic reconnection */
function getStoredRoomId(){
  return getStoredValue('flaps_room_id', (val) => val || null);
}

/** Retrieve stored user name from sessionStorage for automatic reconnection */
function getStoredUserName(){
  return getStoredValue('flaps_user_name', (val) => {
    // Validate that the stored value is a non-empty string
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
    return null;
  });
}

/** Clear session data for a clean join */
function clearSessionData(){
  try {
    sessionStorage.removeItem('flaps_room_id');
    sessionStorage.removeItem('flaps_user_name');
    if (currentRoom) {
      sessionStorage.removeItem('flaps_joined_' + currentRoom);
    }
  } catch (err) {
    console.warn('Failed to clear session data:', err);
  }
}

/** Handle failed automatic reconnection attempts */
function handleReconnectionFailure(){
  clearSessionData();
  joinButtonClicked = false;
  setDisabled('joinBtn', false);
  setDisabled('name', false);
  // Re-show name field and Join button so the user can join manually
  show('name'); show('joinBtn'); show('emoji');
  showToast('Unable to rejoin. Please join manually.', 'warn');
}

/** Helper function to set create room button to "Room Created" state */
function setRoomCreatedButton(){
  const createBtn = el('createRoomBtn');
  if (createBtn) {
    createBtn.textContent = 'Room Created';
    createBtn.classList.add('roomCreated');
    createBtn.disabled = true;
  }
}

/** ---------- Initial View: layout & gating ---------- */
function applyInitialRoleView(){
  const hasRoomInUrl = !!currentRoom;
  const hasModKey = !!modKey;

  // Cache main and footer elements
  const mainContent = cachedElements.main || document.querySelector('main');
  const footer = cachedElements.footer || document.querySelector('footer');

  // Hide main content and footer initially
  if (mainContent) mainContent.style.display = 'none';
  if (footer) footer.style.display = 'none';

  // Disable name/join until a room exists (facilitator must create).
  // Hide the emoji selector for the facilitator until the room is created;
  // it is revealed alongside the name field in the room:created handler.
  if (!hasRoomInUrl) {
    hide('name'); hide('joinBtn'); hide('emoji');
    setDisabled('emoji', false);
    show('createRoomBtn');
    setDisabled('createRoomBtn', false);
    return;
  }

  // Check if user already joined this room
  // Note: Don't set userJoined=true here - that should only be set when server confirms via room:state
  // The automatic reconnection logic in socket.on('connect') will handle rejoining
  if (isAlreadyJoined()) {
    joinButtonClicked = true;
    setDisabled('name', true);
    setDisabled('joinBtn', true);
    // Hide name field and Join button once joined
    hide('name'); hide('joinBtn'); hide('emoji');
  }

  // On /room/:id
  if (hasModKey){
    // Facilitator deep link - show main content, footer, and mark as joined
    if (mainContent) mainContent.style.display = '';
    if (footer) footer.style.display = 'flex';
    roomCreated = true;
    userJoined = true;
    
    // Show green "Room Created" button
    const createBtn = cachedElements.createRoomBtn || el('createRoomBtn');
    if (createBtn) {
      setRoomCreatedButton();
    }
    show('createRoomBtn');
    show('name'); show('joinBtn'); show('emoji');
  } else {
    // Participant link: hide Create button, enable name/join, but keep main and footer hidden until joined
    // Clear the name field for participants so they enter their own name
    const nameField = cachedElements.name || el('name');
    if (nameField && !isAlreadyJoined()) nameField.value = '';
    
    hide('createRoomBtn');
    if (!isAlreadyJoined()) {
      show('name'); show('joinBtn'); show('emoji');
      setDisabled('name', false); 
      setDisabled('joinBtn', false);
      // Auto-focus the name field for participants to start typing immediately
      if (nameField) {
        setTimeout(() => nameField.focus(), 100);
      }
    } else {
      // Already joined, hide name/Join and show footer
      hide('name'); hide('joinBtn'); hide('emoji');
      if (footer) footer.style.display = 'flex';
    }
  }
}
applyInitialRoleView();

/** Handle participant reconnection logic */
function handleParticipantReconnection() {
  const storedRoomId = getStoredRoomId();
  const storedUserName = getStoredUserName();
  const wasJoined = storedRoomId === currentRoom && isAlreadyJoined();
  
  // Early return if we don't have the necessary data
  if (!storedUserName || !wasJoined) {
    // No stored session data or doesn't match current room - re-enable controls
    joinButtonClicked = false;
    setDisabled('joinBtn', false);
    setDisabled('name', false);
    show('name'); show('joinBtn'); show('emoji');
    return;
  }
  
  // Attempt automatic reconnection for participant
  joinButtonClicked = true;
  setDisabled('joinBtn', true);
  setDisabled('name', true);
  
  // Emit room:join event to rejoin with stored identity
  socket.emit('room:join', { 
    roomId: currentRoom, 
    name: storedUserName, 
    emoji: getStoredEmoji(),
    modKey: null 
  });
  
  // Set timeout to detect reconnection failure
  setTimeout(() => {
    if (!userJoined) {
      handleReconnectionFailure();
    }
  }, RECONNECTION_TIMEOUT_MS);
}

/** Update connection status pill after reconnection */
function updateReconnectionStatus() {
  const modePill = cachedElements.modePill || el('modePill');
  if (!modePill || modePill.textContent !== 'Disconnected') {
    return;
  }
  
  setPill(modePill, 'Reconnected', 'good');
  setTimeout(() => {
    if (lastState) {
      setPill(modePill, lastState.youAreModerator ? 'Facilitator' : 'Participant', lastState.youAreModerator ? 'good' : '');
    }
  }, 2000);
}

/** ---------- Socket.IO ---------- */
const socket = io(SOCKET_URL, {
  transports: ['websocket','polling'],
  withCredentials: false
});

socket.on('connect', () => {
  const nameField = cachedElements.name || el('name');
  
  if (currentRoom && modKey) {
    // Facilitator: auto-rejoin
    const nameVal = (nameField?.value ?? '').trim() || 'Facilitator';
    socket.emit('room:join', { roomId: currentRoom, name: nameVal, emoji: getSelectedEmoji() || getStoredEmoji(), modKey });
  } else if (currentRoom) {
    // Participant automatic reconnection logic
    handleParticipantReconnection();
  }
  
  // Update connection status
  updateReconnectionStatus();
});

socket.on('connect_error', (err) => {
  console.error('[socket] connect_error', err);
  showToast('Connection error. Retrying...', 'error');
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected', reason);
  const modePill = cachedElements.modePill || el('modePill');
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

  // Show main content and footer now that room is created
  const mainContent = cachedElements.main || document.querySelector('main');
  if (mainContent) mainContent.style.display = '';
  
  const footer = cachedElements.footer || document.querySelector('footer');
  if (footer) footer.style.display = 'flex';

  setShareLinks(roomId);
  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(createdModKey)}`;
  window.history.replaceState({}, '', newUrl);

  const modePill = cachedElements.modePill || el('modePill');
  setPill(modePill, 'Facilitator', 'good');

  // Change Create Room button to green "Room Created"
  setRoomCreatedButton();

  // Show Name + Join on row 2 (optional for facilitator)
  show('name'); show('joinBtn'); show('emoji');
  setDisabled('name', false); setDisabled('joinBtn', false);
  
  // Auto-join the facilitator with their name or default
  const nameField = cachedElements.name || el('name');
  const nameVal = (nameField?.value ?? '').trim() || 'Facilitator';
  socket.emit('room:join', { roomId: currentRoom, name: nameVal, emoji: getSelectedEmoji(), modKey });
  
  // Focus the name field so user can type immediately
  if (nameField) {
    setTimeout(() => nameField.focus(), 100);
  }
});

// Helper function to update UI pills
function updatePills(state, modKey) {
  const modePill = cachedElements.modePill || el('modePill');
  if (modePill) setPill(modePill, state.youAreModerator ? 'Facilitator' : 'Participant', state.youAreModerator ? 'good' : '');
  
  const votePill = el('votePill');
  if (votePill) setPill(votePill, state.phase === 'revealed' ? 'Revealed' : 'Voting', state.phase === 'revealed' ? 'warn' : '');

  if (state.youAreModerator && modKey) setShareLinks(state.roomId);
}

// Helper function to update button states
function updateButtonStates(state) {
  const setStoryBtn = el('setStoryBtn');
  if (setStoryBtn) setStoryBtn.disabled = !state.youAreModerator;
  
  const hasActiveStory = !!state.activeStoryId;
  const hasVotes = Object.values(state.users ?? {}).some(u => u.vote && u.vote !== null);
  
  const revealBtn = el('revealBtn');
  if (revealBtn) {
    revealBtn.disabled = !state.youAreModerator || !hasActiveStory || state.phase === 'revealed' || !hasVotes;
  }
  
  const clearBtn = el('clearBtn');
  if (clearBtn) {
    clearBtn.disabled = !state.youAreModerator || !hasActiveStory || !!state.story?.finalPoints || !hasVotes;
  }
}

// Helper function to update roombar UI
function updateRoombar(state) {
  if (state.youAreModerator){
    const createBtn = cachedElements.createRoomBtn || el('createRoomBtn');
    if (createBtn && roomCreated) {
      setRoomCreatedButton();
    }
    show('createRoomBtn');
    // Keep name field disabled and hidden if already joined
    if (joinButtonClicked) {
      setDisabled('name', true);
      setDisabled('joinBtn', true);
      hide('name'); hide('joinBtn'); hide('emoji');
    } else {
      setDisabled('name', false);
      setDisabled('joinBtn', false);
      show('name'); show('joinBtn'); show('emoji');
    }
  } else {
    hide('createRoomBtn');
    // Keep name field disabled and hidden if already joined
    if (joinButtonClicked) {
      setDisabled('name', true);
      setDisabled('joinBtn', true);
      hide('name'); hide('joinBtn'); hide('emoji');
    } else {
      setDisabled('name', false);
      setDisabled('joinBtn', false);
      show('name'); show('joinBtn'); show('emoji');
    }
  }
}

// Helper function to show/hide story form based on moderator status
function updateStoryFormVisibility(state) {
  const jiraNumber = cachedElements.jiraNumber || el('jiraNumber');
  const storyTitle = cachedElements.storyTitle || el('storyTitle');
  const storyDesc = cachedElements.storyDesc || el('storyDesc');
  const addToQueueBtn = el('addToQueueBtn');
  const jiraNumberLabel = document.querySelector('label[for="jiraNumber"]');
  const storyTitleLabel = document.querySelector('label[for="storyTitle"]');
  const storyDescLabel = document.querySelector('label[for="storyDesc"]');
  const addStoryHeader = document.querySelector('.storyForm > .resultsTitle:first-child');
  const storyInputCol = document.querySelector('.storyInputCol');
  const storyQueueHeader = document.querySelectorAll('.storyForm > .resultsTitle')[1];
  
  if (state.youAreModerator) {
    // Show entire Add a Story section for facilitators
    if (addStoryHeader) addStoryHeader.style.display = '';
    if (storyInputCol) storyInputCol.style.display = '';
    if (jiraNumber) jiraNumber.style.display = '';
    if (storyTitle) storyTitle.style.display = '';
    if (storyDesc) storyDesc.style.display = '';
    if (addToQueueBtn) addToQueueBtn.style.display = '';
    if (jiraNumberLabel) jiraNumberLabel.style.display = '';
    if (storyTitleLabel) storyTitleLabel.style.display = '';
    if (storyDescLabel) storyDescLabel.style.display = '';
    if (storyQueueHeader) storyQueueHeader.style.marginTop = '';
    show('revealBtn'); show('clearBtn');
    const finalizeSection = document.querySelector('.voteBottom');
    if (finalizeSection) finalizeSection.style.display = '';
    const deck = cachedElements.deck || el('deck');
    if (deck) deck.style.marginBottom = '';
    const resultsTitle = document.querySelector('.resultsSection > .resultsTitle');
    if (resultsTitle) resultsTitle.style.marginBottom = '';
    if (addToQueueBtn) addToQueueBtn.style.marginBottom = '10px';
  } else {
    // Hide entire Add a Story section for participants
    if (addStoryHeader) addStoryHeader.style.display = 'none';
    if (storyInputCol) storyInputCol.style.display = 'none';
    if (jiraNumber) jiraNumber.style.display = 'none';
    if (storyTitle) storyTitle.style.display = 'none';
    if (storyDesc) storyDesc.style.display = 'none';
    if (addToQueueBtn) addToQueueBtn.style.display = 'none';
    if (jiraNumberLabel) jiraNumberLabel.style.display = 'none';
    if (storyTitleLabel) storyTitleLabel.style.display = 'none';
    if (storyDescLabel) storyDescLabel.style.display = 'none';
    if (storyQueueHeader) storyQueueHeader.style.marginTop = '21px';
    hide('revealBtn'); hide('clearBtn');
    const finalizeSection = document.querySelector('.voteBottom');
    if (finalizeSection) finalizeSection.style.display = 'none';
    const deck = cachedElements.deck || el('deck');
    if (deck) deck.style.marginBottom = '0px';
    const resultsTitle = document.querySelector('.resultsSection > .resultsTitle');
    if (resultsTitle) resultsTitle.style.marginBottom = '16px';
  }
}

// Helper function to render all UI components
function renderAllComponents(state, canFinalize) {
  const hasActiveStory = !!state.activeStoryId;
  renderDeck(state.deck, state.phase, hasActiveStory);
  renderFinalPointsChips(state.deck, canFinalize);
  renderUsers(state.users, state.phase);
  renderResults(state);
  renderQueue(state);
}

socket.on('room:state', (state) => {
  // Keep lastState for finalize usage
  lastState = state;
  
  // Clear loading states on successful join
  if (joinButtonClicked) {
    setLoading('joinBtn', false);
    // Keep both join button and name field disabled after successful join
    setDisabled('joinBtn', true);
    setDisabled('name', true);
    // Hide name field and Join button once joined
    hide('name'); hide('joinBtn'); hide('emoji');
  }

  // Show main content when user joins (receives first room state)
  if (!userJoined) {
    userJoined = true;
    saveJoinedState(); // Save that user has joined this room
    const mainContent = cachedElements.main || document.querySelector('main');
    if (mainContent) mainContent.style.display = '';
    
    const footer = cachedElements.footer || document.querySelector('footer');
    if (footer) footer.style.display = 'flex';
  }

  updatePills(state, modKey);
  updateButtonStates(state);
  updateRoombar(state);
  updateStoryFormVisibility(state);

  const hasActiveStory = !!state.activeStoryId;
  const canFinalize = state.youAreModerator && state.phase === 'revealed' && hasActiveStory;

  // If votes were cleared (phase is voting and our vote is null), deselect locally
  if (state.phase === 'voting') {
    const myEntry = state.mySocketId && state.users && state.users[state.mySocketId];
    if (!myEntry || myEntry.vote === null) {
      myVote = null;
    }
  }

  renderAllComponents(state, canFinalize);
  
  // Reset selection when phase changes or story changes
  if (state.phase !== 'revealed' || !state.activeStoryId) {
    selectedFinalPoint = null;
  }
});

/** ---------- UI → Server ---------- */
const createRoomBtnElement = el('createRoomBtn');

if (!createRoomBtnElement) {
  console.error('createRoomBtn element not found!');
}

el('createRoomBtn').onclick = () => {
  const nameField = cachedElements.name || el('name');
  const name = (nameField?.value ?? '').trim() || 'Facilitator';
  saveName(name);
  const emoji = getSelectedEmoji();
  saveEmoji(emoji);
  setLoading('createRoomBtn', true);
  socket.emit('room:create', { name, emoji });
  
  // Reset loading state after timeout (in case of no response)
  // Only re-enable if room wasn't created
  setTimeout(() => {
    if (!roomCreated) {
      setLoading('createRoomBtn', false);
    }
  }, 5000);
};

el('joinBtn').onclick = () => {
  const nameField = cachedElements.name || el('name');
  const name = (nameField?.value ?? '').trim();
  if (!name) return showToast('Enter your name.', 'error');
  saveName(name);
  const emoji = getSelectedEmoji();
  saveEmoji(emoji);

  if (!currentRoom) return showToast('No room to join. Create a room first.', 'error');
  
  // Clear old session data before joining new room
  clearSessionData();
  
  // Disable the join button and name field, show loading
  joinButtonClicked = true;
  setLoading('joinBtn', true);
  setDisabled('name', true);
  
  socket.emit('room:join', { roomId: currentRoom, name, emoji, modKey });
  
  // Reset loading state after timeout (in case of no response)
  setTimeout(() => {
    if (joinButtonClicked && !userJoined) {
      setLoading('joinBtn', false);
      setDisabled('name', false);
      show('name'); show('joinBtn'); show('emoji');
      joinButtonClicked = false;
    }
  }, RECONNECTION_TIMEOUT_MS);
};

// Enable Enter key in the name field to trigger join
el('name').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const joinBtn = el('joinBtn');
    if (joinBtn && !joinBtn.disabled) {
      joinBtn.click();
    }
  }
};

// Name field allows any characters (including special characters).
// Values are rendered via textContent, so this is XSS-safe.

el('revealBtn').onclick = () => {
  if (!currentRoom) return;
  myVote = null;
  socket.emit('vote:reveal', { roomId: currentRoom });
};
el('clearBtn').onclick = () => { myVote = null; currentRoom && socket.emit('vote:clear', { roomId: currentRoom }); };

// Auto-capitalize Jira # field with input validation.
// Story Title and Story Description allow any characters (no filtering).
const jiraInput = cachedElements.jiraNumber || el('jiraNumber');

if (jiraInput) {
  jiraInput.addEventListener('input', (e) => {
    const field = e.target;
    const caret = field.selectionStart;
    const original = field.value;
    // Count disallowed characters before the caret so we can adjust it
    // correctly when characters are stripped mid-string (not just appended).
    const beforeCaret = original.slice(0, caret);
    const removedBeforeCaret = beforeCaret.length - beforeCaret.replace(/[^A-Za-z0-9\-]/g, '').length;
    // Allow only alphanumeric and dashes for Jira #
    field.value = original.replace(/[^A-Za-z0-9\-]/g, '').toUpperCase();
    const newCaret = caret - removedBeforeCaret;
    field.setSelectionRange(newCaret, newCaret);
  });
}

el('addToQueueBtn').onclick = () => {
  if (!currentRoom) return showToast('Join a room first', 'error');
  const titleField = cachedElements.storyTitle || el('storyTitle');
  const title = (titleField?.value ?? '').trim();
  if (!title) return showToast('Enter a Story Title to add to the queue.', 'error');

  const jiraField = cachedElements.jiraNumber || el('jiraNumber');
  const descField = cachedElements.storyDesc || el('storyDesc');

  socket.emit('storyQueue:add', {
    roomId: currentRoom,
    story: {
      number: jiraField?.value || '',
      title,
      desc: descField?.value || ''
    }
  });

  if (jiraField) jiraField.value = '';
  if (titleField) titleField.value = '';
  if (descField) descField.value = '';
  if (titleField) titleField.focus();
};

// Finalize button removed - finalization happens on chip selection

/** Helper function to add keyboard support (Enter/Space) to a button */
function addKeyboardClickSupport(element){
  element.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      element.click();
    }
  };
}

/** ---------- Renderers ---------- */
function renderFinalPointsChips(deck, canFinalize) {
  const d = Array.isArray(deck) ? deck : [];
  const container = el('finalPointsChips');
  if (!container) return;
  
  // Filter out non-numeric values (?, ☕) for finalize options
  const numericDeck = d.filter(v => v !== '?' && v !== '☕');
  
  // Check if current story is already finalized
  const isFinalized = lastState?.story?.finalPoints !== null && lastState?.story?.finalPoints !== undefined;
  
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  
  numericDeck.forEach((value) => {
    const chip = document.createElement('button');
    chip.className = 'finalChip';
    chip.type = 'button';
    chip.textContent = value;
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-label', `Select ${value} points`);
    chip.setAttribute('aria-checked', 'false');
    // Disable if not in finalize mode OR if story is already finalized
    chip.disabled = !canFinalize || isFinalized;
    
    if (selectedFinalPoint === value) {
      chip.classList.add('selected');
      chip.setAttribute('aria-checked', 'true');
    }
    
    chip.onclick = () => {
      if (!canFinalize || isFinalized) return;
      
      // Deselect all chips
      if (container) {
        container.querySelectorAll('.finalChip').forEach(c => {
          c.classList.remove('selected');
          c.setAttribute('aria-checked', 'false');
        });
      }
      
      // Select this chip
      chip.classList.add('selected');
      chip.setAttribute('aria-checked', 'true');
      selectedFinalPoint = value;
      
      // Immediately finalize the story with the selected points
      if (!currentRoom) return showToast('Join a room first', 'error');
      if (!lastState?.activeStoryId) return showToast('Set an active story first.', 'error');
      if (!socket || !socket.connected) return showToast('Not connected to server', 'error');

      socket.emit('storyQueue:finalize', {
        roomId: currentRoom,
        storyId: lastState.activeStoryId,
        finalPoints: selectedFinalPoint
      });
      
      // Reset selection after finalization
      selectedFinalPoint = null;
      setTimeout(() => {
        if (container) {
          container.querySelectorAll('.finalChip').forEach(c => {
            c.classList.remove('selected');
            c.setAttribute('aria-checked', 'false');
          });
        }
      }, 100);
    };
    
    // Keyboard support
    addKeyboardClickSupport(chip);
    
    frag.appendChild(chip);
  });
  
  container.appendChild(frag);
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

// Helper function to create user item element
function createUserItem(user, phase, role) {
  const li = document.createElement('li');
  li.className = role === 'facilitator' ? 'userItem facilitatorItem' : 'userItem voterItem';

  const nameWrap = document.createElement('span');
  nameWrap.className = 'unameWrap';

  if (user.emoji) {
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'uemoji';
    emojiSpan.setAttribute('aria-hidden', 'true');
    emojiSpan.textContent = user.emoji;
    nameWrap.appendChild(emojiSpan);
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'uname';
  nameSpan.textContent = user.name ?? '';
  nameWrap.appendChild(nameSpan);

  const statusSpan = document.createElement('span');
  statusSpan.className = 'ustatus';
  let statusText = '';
  if (phase === 'revealed') {
    statusText = (user.vote ?? '—');
    statusSpan.textContent = statusText;
  } else {
    statusText = (user.vote === 'selected' ? 'Selected' : '—');
    statusSpan.textContent = (user.vote === 'selected' ? '✔ Selected' : '—');
  }

  // Enhanced accessibility
  li.setAttribute('role', 'listitem');
  const roleLabel = role === 'facilitator' ? 'Facilitator' : 'Voter';
  li.setAttribute('aria-label', `${user.name}, ${roleLabel}, ${statusText}`);

  li.appendChild(nameWrap);
  li.appendChild(statusSpan);
  
  return li;
}

// Helper function to create group header
function createGroupHeader(label, icon) {
  const header = document.createElement('li');
  header.className = 'userGroupHeader';
  header.innerHTML = `<span class="groupLabel">${label}</span><span class="groupIcon">${icon}</span>`;
  return header;
}

// Helper function to render user group
function renderUserGroup(users, phase, role, label, icon) {
  const frag = document.createDocumentFragment();
  
  if (users.length > 0) {
    frag.appendChild(createGroupHeader(label, icon));
    users.forEach((u) => {
      frag.appendChild(createUserItem(u, phase, role));
    });
  }
  
  return frag;
}

function renderUsers(users, phase) {
  const list = el('usersList');
  if (!list) return;
  list.innerHTML = '';

  const entries = Object.values(users ?? {});
  const usersPill = el('usersPill');
  if (usersPill) usersPill.textContent = String(entries.length);

  // Separate facilitators and voters in one pass
  const facilitators = [];
  const voters = [];
  entries.forEach(u => {
    if (u.isModerator) {
      facilitators.push(u);
    } else {
      voters.push(u);
    }
  });
  
  // Sort after separation
  facilitators.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  voters.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const frag = document.createDocumentFragment();
  frag.appendChild(renderUserGroup(facilitators, phase, 'facilitator', 'Facilitator', '👑'));
  frag.appendChild(renderUserGroup(voters, phase, 'voter', 'Voters', '👤'));
  
  list.appendChild(frag);
}

// Helper function to create metric chips
function createMetricChips(metrics) {
  const frag = document.createDocumentFragment();
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
    frag.appendChild(chip);
  });
  return frag;
}

// Helper function to calculate vote statistics
function calculateVoteStats(users) {
  const votes = Object.values(users ?? {})
    .map((u) => {
      const vote = u.vote;
      // Exclude coffee cup from calculations (represents break/pause, not an estimate)
      if (vote === '☕') return null;
      // Exclude question mark from calculations (represents unknown/can't estimate)
      if (vote === '?') return null;
      return vote;
    })
    .filter((v) => v != null && !Number.isNaN(Number(v)))
    .map(Number)
    .sort((a,b) => a - b);

  if (!votes.length) {
    return null;
  }

  const min = votes[0];
  const max = votes[votes.length-1];
  const avg = (votes.reduce((a,b)=>a+b,0)/votes.length).toFixed(1);
  const median = votes.length % 2
    ? votes[(votes.length-1)/2]
    : ((votes[votes.length/2-1] + votes[votes.length/2]) / 2).toFixed(1);

  return { min, max, avg, median };
}

// Helper function to render placeholder metrics
function renderPlaceholderMetrics(r, finalValue = '—') {
  const summary = document.createElement('div');
  summary.className = 'summary';

  const placeholderMetrics = [
    { label: 'Final', value: finalValue },
    { label: 'Min', value: '—' },
    { label: 'Max', value: '—' },
    { label: 'Avg', value: '—' },
    { label: 'Median', value: '—' }
  ];

  const frag = createMetricChips(placeholderMetrics);
  summary.appendChild(frag);
  
  r.className = '';
  r.innerHTML = '';
  r.appendChild(summary);
}

function renderResults(state) {
  const r = el('results');

  if (state.phase !== 'revealed') {
    renderPlaceholderMetrics(r);
    return;
  }

  const stats = calculateVoteStats(state.users);

  // If no stats or all values are invalid, show placeholder
  if (!stats) {
    renderPlaceholderMetrics(r, state.story?.finalPoints || '—');
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'summary';

  const metrics = [];
  // Always add Final metric first (with value or placeholder)
  const finalValue = state.story?.finalPoints || '—';
  const isFinal = !!state.story?.finalPoints;
  metrics.push({ label: 'Final', value: finalValue, final: isFinal });
  
  // Add calculation metrics with fallback to '—' for any invalid values
  metrics.push(
    { label: 'Min',    value: stats.min ?? '—' },
    { label: 'Max',    value: stats.max ?? '—' },
    { label: 'Avg',    value: stats.avg ?? '—' },
    { label: 'Median', value: stats.median ?? '—' }
  );

  const frag = createMetricChips(metrics);
  summary.appendChild(frag);

  r.className = '';
  r.innerHTML = '';
  r.appendChild(summary);
}
// Helper function to sort story queue
function sortStoryQueue(queue, activeStoryId) {
  return [...queue].sort((a, b) => {
    // Active story always comes first
    if (a.id === activeStoryId) return -1;
    if (b.id === activeStoryId) return 1;
    
    // Non-active finalized stories go to the bottom
    const aFinalized = !!a.finalPoints;
    const bFinalized = !!b.finalPoints;
    
    if (aFinalized && !bFinalized) return 1;  // a goes down
    if (!aFinalized && bFinalized) return -1; // b goes down
    
    // Otherwise maintain original order
    return 0;
  });
}

// Helper function to create delete button with confirmation
function createDeleteButton(storyId, currentRoom, socket) {
  const rmBtn = document.createElement('button');
  rmBtn.className = 'queueBtn';
  rmBtn.type = 'button';
  rmBtn.textContent = '❌';
  rmBtn.dataset.confirmState = 'initial';
  rmBtn.dataset.storyId = storyId;
  
  let confirmTimeout = null;
  
  const outsideClickHandler = (e) => {
    if (!rmBtn.contains(e.target)) {
      resetConfirmState();
    }
  };
  
  const resetConfirmState = () => {
    if (rmBtn.dataset.confirmState === 'confirming') {
      rmBtn.textContent = '❌';
      rmBtn.classList.remove('queueBtnConfirm');
      rmBtn.dataset.confirmState = 'initial';
      clearTimeout(confirmTimeout);
      document.removeEventListener('click', outsideClickHandler);
    }
  };
  
  rmBtn.onclick = (e) => {
    e.stopPropagation();
    
    if (rmBtn.dataset.confirmState === 'initial') {
      // First click: enter confirmation state
      rmBtn.textContent = 'Confirm?';
      rmBtn.classList.add('queueBtnConfirm');
      rmBtn.dataset.confirmState = 'confirming';
      
      // Reset after 3 seconds
      confirmTimeout = setTimeout(() => {
        resetConfirmState();
      }, 3000);
      
      // Reset on outside click
      setTimeout(() => {
        document.addEventListener('click', outsideClickHandler);
      }, 0);
      
    } else if (rmBtn.dataset.confirmState === 'confirming') {
      // Second click: perform removal
      clearTimeout(confirmTimeout);
      document.removeEventListener('click', outsideClickHandler);
      socket.emit('storyQueue:remove', { roomId: currentRoom, storyId: storyId });
      
      // Reset to initial state after removal
      rmBtn.textContent = '❌';
      rmBtn.classList.remove('queueBtnConfirm');
      rmBtn.dataset.confirmState = 'initial';
    }
  };
  
  return rmBtn;
}

// Helper function to create queue item title row
function createQueueTitleRow(story, isActive) {
  const titleRow = document.createElement('div');
  titleRow.className = 'queueTitleRow';

  // Display Jira number as separate element (if present)
  if (story.number) {
    const numberSpan = document.createElement('span');
    numberSpan.className = 'queueNumber';
    numberSpan.textContent = story.number.substring(0, 12); // Max 12 chars
    titleRow.appendChild(numberSpan);
  }

  // Display "Active Story" meta next to Jira number
  if (isActive) {
    const meta = document.createElement('span');
    meta.className = 'queueMeta';
    meta.textContent = 'Active Story';
    titleRow.appendChild(meta);
  }
  
  return titleRow;
}

// Helper function to switch a queue item into an inline edit form
function enterStoryEditMode(li, story) {
  li.innerHTML = '';
  li.classList.add('queueEditing');

  const form = document.createElement('div');
  form.className = 'queueEditForm';

  // Jira # input (letters, numbers, dashes; auto-uppercased like the add form)
  const numberInput = document.createElement('input');
  numberInput.className = 'queueEditInput';
  numberInput.type = 'text';
  numberInput.maxLength = 12;
  numberInput.placeholder = 'Jira #';
  numberInput.value = story.number || '';
  numberInput.setAttribute('aria-label', 'Jira Number');
  numberInput.addEventListener('input', (e) => {
    const field = e.target;
    const caret = field.selectionStart;
    const original = field.value;
    const beforeCaret = original.slice(0, caret);
    const removedBeforeCaret = beforeCaret.length - beforeCaret.replace(/[^A-Za-z0-9\-]/g, '').length;
    field.value = original.replace(/[^A-Za-z0-9\-]/g, '').toUpperCase();
    const newCaret = caret - removedBeforeCaret;
    field.setSelectionRange(newCaret, newCaret);
  });

  // Title input (required)
  const titleInput = document.createElement('input');
  titleInput.className = 'queueEditInput';
  titleInput.type = 'text';
  titleInput.maxLength = 100;
  titleInput.placeholder = 'Story Title';
  titleInput.value = story.title || '';
  titleInput.setAttribute('aria-label', 'Story Title');

  // Description textarea (optional)
  const descInput = document.createElement('textarea');
  descInput.className = 'queueEditInput queueEditDesc';
  descInput.maxLength = 100;
  descInput.rows = 2;
  descInput.placeholder = 'Short Description (optional)';
  descInput.value = story.desc || '';
  descInput.setAttribute('aria-label', 'Story Description');

  const editActions = document.createElement('div');
  editActions.className = 'queueEditActions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'queueBtn primary';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = () => {
    const title = titleInput.value.trim();
    if (!title) return showToast('Enter a Story Title.', 'error');
    socket.emit('storyQueue:edit', {
      roomId: currentRoom,
      storyId: story.id,
      story: {
        number: numberInput.value || '',
        title,
        desc: descInput.value || ''
      }
    });
    // Server broadcast will re-render the queue with the updated values.
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'queueBtn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    // Restore the display view from the last known state
    if (lastState) renderQueue(lastState);
  };

  // Save on Enter within the single-line inputs
  [numberInput, titleInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      }
    });
  });

  editActions.appendChild(saveBtn);
  editActions.appendChild(cancelBtn);

  form.appendChild(numberInput);
  form.appendChild(titleInput);
  form.appendChild(descInput);
  form.appendChild(editActions);

  li.appendChild(form);
  titleInput.focus();
}

// Helper function to create queue item actions
function createQueueActions(story, state, li) {
  const actions = document.createElement('div');
  actions.className = 'queueActions';

  // Facilitator-only buttons
  if (state.youAreModerator) {
    const setBtn = document.createElement('button');
    setBtn.className = 'queueBtn primary' + (state.activeStoryId === story.id ? ' activeEstimate' : '');
    setBtn.type = 'button';
    setBtn.textContent = 'Estimate';
    // Disable if story is active OR if story has been finalized
    setBtn.disabled = state.activeStoryId === story.id || !!story.finalPoints;
    setBtn.onclick = () => socket.emit('storyQueue:setActive', { roomId: currentRoom, storyId: story.id });

    const editBtn = document.createElement('button');
    editBtn.className = 'queueBtn';
    editBtn.type = 'button';
    editBtn.textContent = '✏️ Edit';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      enterStoryEditMode(li, story);
    };

    const rmBtn = createDeleteButton(story.id, currentRoom, socket);

    actions.appendChild(setBtn);
    actions.appendChild(editBtn);
    actions.appendChild(rmBtn);
  }

  // Always show final pill for both facilitators and participants
  const finalPill = document.createElement('button');
  finalPill.className = 'queueBtn finalPill' + (story.finalPoints ? ' finalized' : '');
  finalPill.type = 'button';
  finalPill.textContent = story.finalPoints ? `Final: ${story.finalPoints}` : 'Final: —';
  finalPill.disabled = true;
  actions.appendChild(finalPill);
  
  return actions;
}

// Helper function to create queue item element
function createQueueItemElement(story, state) {
  const li = document.createElement('li');
  li.className = 'queueItem' + (state.activeStoryId === story.id ? ' queueActive' : '');

  const left = document.createElement('div');
  left.className = 'queueLeft';

  const titleRow = createQueueTitleRow(story, state.activeStoryId === story.id);
  left.appendChild(titleRow);

  // Display title on its own line
  const title = document.createElement('div');
  title.className = 'queueTitle';
  const maxTitleLength = 50;
  title.textContent = story.title.length > maxTitleLength ? story.title.substring(0, maxTitleLength) + '...' : story.title;
  left.appendChild(title);

  // Display description if present
  if (story.desc && story.desc.trim()) {
    const desc = document.createElement('div');
    desc.className = 'queueDesc';
    desc.textContent = story.desc;
    left.appendChild(desc);
  }

  const actions = createQueueActions(story, state, li);

  li.appendChild(left);
  li.appendChild(actions);
  
  return li;
}

function renderQueue(state) {
  const queue = Array.isArray(state.storyQueue) ? state.storyQueue : [];
  const list = el('storyQueueList'); 
  
  list.innerHTML = '';

  if (!queue.length) {
    // Show "No Stories In Queue" placeholder for all users
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

  const sortedQueue = sortStoryQueue(queue, state.activeStoryId);
  const frag = document.createDocumentFragment();

  sortedQueue.forEach((story) => {
    const li = createQueueItemElement(story, state);
    frag.appendChild(li);
  });

  list.appendChild(frag);
}