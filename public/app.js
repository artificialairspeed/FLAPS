/* global io */

// Session_State_Machine core (create/join flow overhaul). The pure, DOM-free
// state machine and control-derivation logic live in these ES modules; app.js
// is the thin wiring layer that binds them to the socket and DOM. Loading app.js
// as a module (see the `type="module"` script tag in index.html) is what makes
// these imports available.
import {
  STATES,
  EVENTS,
  transition,
  deriveControls,
  createSessionMachine
} from './session-machine.js';
// Name gating helper (create/join flow overhaul). `isJoinable` is the single
// source of truth for whether a display name qualifies to join; it is used both
// to drive the live Join enabled/disabled state on Name input and to guard the
// Join click handler (Req 4.1, 4.2, 4.3).
// Identity + emit helpers (create/join flow overhaul). `joinPayload` builds every
// room:create / room:join / resume payload with the stable `clientId` always
// attached (Req 5.3); `getClientId` (aliased) is the single durable identity
// source (localStorage-backed). `isJoinable` gates the Join control (Req 4).
// `loadDefaults`/`saveDefaults` are the localStorage-backed Remembered_Defaults
// helpers (Req 6.1–6.3): name/emoji are pre-filled from `loadDefaults()` on a
// fresh load and persisted via `saveDefaults()` on a successful join.
import {
  isJoinable,
  joinPayload,
  getClientId as getStableClientId,
  loadDefaults,
  saveDefaults
} from './session-identity.js';
// Re-vote core (clear/re-vote a finalized story). `isFinalizedValue` is the
// single definition of "finalized" shared by the client renderers and the
// server handler, so queue partitioning, the card action area, the active-story
// highlight, and the export summary can never disagree — a blank or
// whitespace-only `finalPoints` is pending everywhere (Req 1.10, 6.1, 6.3, 6.8).
import { isFinalizedValue, normalizeStoryId } from './story-revote.js';

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

/**
 * The single create/join control renderer (Session_State_Machine subscriber).
 *
 * This is the ONE place that calls show/hide/setDisabled for the create/join
 * entry controls — the Create Room button, the Name field, the Join button, and
 * the emoji selector. It maps a `controlConfig` (the output of `deriveControls`
 * from session-machine.js) onto the real DOM elements and reads ONLY that
 * config: it never inspects the legacy `joinButtonClicked`, `userJoined`, or
 * `roomCreated` flags (Req 1.3, 1.4). `state` and `ctx` are passed through for
 * diagnostics and future wiring; rendering decisions come solely from
 * `controlConfig`.
 *
 * ControlConfig shape:
 *   { create:{visible,enabled,label}, name:{visible,enabled},
 *     join:{visible,enabled}, emoji:{visible,enabled}, moderatorControls? }
 *
 * Note: the in-session moderator controls (story form, reveal/clear, etc.)
 * continue to key off `state.youAreModerator` from the room state
 * (updateStoryFormVisibility / updateButtonStates); this renderer owns only the
 * create/join entry controls plus the create button's label/visibility.
 *
 * @param {object} controlConfig - fully specified create/join control config
 * @param {string} [state] - the current Session_State (diagnostic pass-through)
 * @param {object} [ctx] - the render context (diagnostic pass-through)
 * @returns {void}
 */
function render(controlConfig, state, ctx) { // eslint-disable-line no-unused-vars
  if (!controlConfig) return;
  const { create, name, join, emoji } = controlConfig;

  // Create Room button: visibility, enabled state, and label (Create Room /
  // Creating… / Room Created). The `roomCreated` CSS class tracks the created
  // label so the button keeps its green "created" styling.
  if (create) {
    if (create.visible) show('createRoomBtn'); else hide('createRoomBtn');
    setDisabled('createRoomBtn', !create.enabled);
    if (typeof create.label === 'string') {
      const createBtn = el('createRoomBtn');
      if (createBtn) {
        createBtn.textContent = create.label;
        createBtn.classList.toggle('roomCreated', create.label === 'Room Created');
      }
    }
  }

  // Name field.
  if (name) {
    if (name.visible) show('name'); else hide('name');
    setDisabled('name', !name.enabled);
  }

  // Join button: visibility, enabled state, and label (Join / Joined). The
  // `roomCreated` CSS class gives the "Joined" state the same green styling as
  // the facilitator's "Room Created" button.
  if (join) {
    if (join.visible) show('joinBtn'); else hide('joinBtn');
    setDisabled('joinBtn', !join.enabled);
    if (typeof join.label === 'string') {
      const joinBtn = el('joinBtn');
      if (joinBtn) {
        joinBtn.textContent = join.label;
        joinBtn.classList.toggle('roomCreated', join.label === 'Joined');
      }
    }
  }

  // Emoji selector.
  if (emoji) {
    if (emoji.visible) show('emoji'); else hide('emoji');
    setDisabled('emoji', !emoji.enabled);
  }
}

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
let isReconnecting = false; // True while a transient, auto-recovering connection lapse is in flight
let myVote = null; // Track this user's current vote locally
let selectedFinalPoint = null; // Track selected final point for finalization
const RECONNECTION_TIMEOUT_MS = 5000; // Timeout for automatic reconnection attempts

(function parseFromUrl() {
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1]) currentRoom = decodeURIComponent(parts[1]).toUpperCase();
  modKey = url.searchParams.get('mod') ?? null;
})();

/** ---------- Session state machine (single source of truth) ---------- */
// The machine holds the current Session_State plus the render context and
// notifies the single `render` subscriber on every change. Creating it does not
// touch the DOM (no render runs until the first dispatch/setContext); the
// machinery is put in place here so tasks 5.4/5.5 can wire socket events to
// `sessionMachine.dispatch(...)`, at which point all create/join rendering flows
// through the same `render` used by the transitional gating below.
const sessionMachine = createSessionMachine(
  STATES.INITIAL,
  { role: modKey ? 'facilitator' : null, hasRoomInUrl: !!currentRoom, hasModKey: !!modKey },
  render
);
// `transition` is consumed indirectly through the machine holder; reference it
// so the import is retained. Socket events dispatch into `sessionMachine`
// (task 5.4); bootstrap initial-state selection is completed in task 5.5.
void transition;

/** ---------- Remember my name ---------- */
// Pre-fill the Name field and emoji control from the localStorage-backed
// Remembered_Defaults on a fresh load (Req 6.2). For backward compatibility with
// pre-migration sessions (and any legacy readers/tests), fall back to the legacy
// sessionStorage `flaps_name`/`flaps_emoji` values when localStorage has none.
(function prefillRememberedDefaults(){
  const { name, emoji } = loadDefaults();
  let nameVal = name;
  let emojiVal = emoji;
  try {
    if (!nameVal) nameVal = sessionStorage.getItem('flaps_name') || '';
    if (!emojiVal) emojiVal = sessionStorage.getItem('flaps_emoji') || '';
  } catch {}
  const nameField = cachedElements.name || el('name');
  const emojiField = cachedElements.emoji || el('emoji');
  if (nameVal && nameField) nameField.value = nameVal;
  if (emojiVal && emojiField) emojiField.value = emojiVal;
})();
function saveName(name){
  // localStorage is now authoritative for Remembered_Defaults (Req 6.1); mirror
  // to the legacy sessionStorage key for backward compatibility.
  saveDefaults(name, getSelectedEmoji());
  try { if (name) sessionStorage.setItem('flaps_name', name); } catch {}
}

/** ---------- Remember my emoji ---------- */
function saveEmoji(emoji){
  const nameField = cachedElements.name || el('name');
  saveDefaults((nameField?.value ?? '').trim(), emoji);
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

/** ---------- Stable client identity ---------- */
// A durable identifier minted once per browser and re-sent on every connect.
// Unlike the transient socket.id, this survives reconnects so the server can
// resume the existing session after a background-induced lapse.
//
// Single identity source: `getClientId` delegates to session-identity.js's
// `getStableClientId`, which is backed by sessionStorage and therefore PER-TAB.
// Each tab/window is a distinct room participant, so two users in the same
// browser are never merged into one server record or allowed to inherit each
// other's role. Every create/join emit — built via `joinPayload` — carries this
// same per-tab id. The module writes the id to sessionStorage under
// `flaps_client_id`, so no separate mirror is needed here.
function getClientId(){
  return getStableClientId();
}
// Resolve (minting if needed) the per-tab clientId once on load so it is stable
// for the lifetime of this tab.
getClientId();

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

/**
 * Whether a stored joined session exists for the given room.
 *
 * Drives the bootstrap initial-state selection (Req 7.1, 7.4): a truthy result
 * means the machine should enter RESUMING and rejoin using the stored clientId;
 * a falsy result means a fresh load that stays INITIAL.
 *
 * localStorage is the authoritative store post-migration, but we also honor the
 * legacy sessionStorage `flaps_joined_<ROOM>` flag so pre-migration sessions
 * (and the existing session-persistence tests, which seed sessionStorage) still
 * resume correctly.
 *
 * @param {string|null} room - the current room id
 * @returns {boolean} true when a joined session is recorded for `room`
 */
function hasStoredJoinedSession(room){
  if (!room) return false;
  const key = 'flaps_joined_' + room;
  try {
    if (localStorage.getItem(key) === 'true') return true;
  } catch {}
  try {
    if (sessionStorage.getItem(key) === 'true') return true;
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
  // Re-show the pre-join entry controls so the user can join manually (INITIAL),
  // routed through the single render(). Name gating (task 5.2) re-enables the
  // Join button once a non-whitespace name is entered.
  const ctx = { role: null, hasRoomInUrl: !!currentRoom, hasModKey: !!modKey };
  render(deriveControls(STATES.INITIAL, ctx), STATES.INITIAL, ctx);
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

  // No room yet: facilitator pre-create entry (INITIAL). Create is visible and
  // enabled, name/join/emoji hidden — all routed through the single render().
  if (!hasRoomInUrl) {
    const ctx = { role: null, hasRoomInUrl: false, hasModKey: false };
    render(deriveControls(STATES.INITIAL, ctx), STATES.INITIAL, ctx);
    return;
  }

  // On /room/:id. Determine whether this browser already joined this room.
  // Note: userJoined is only set true when the server confirms via room:state;
  // the automatic reconnection logic in socket.on('connect') handles rejoining.
  const alreadyJoined = isAlreadyJoined();
  if (alreadyJoined) {
    joinButtonClicked = true;
  }

  if (hasModKey){
    // Facilitator deep link - show main content, footer, and mark as joined.
    if (mainContent) mainContent.style.display = '';
    if (footer) footer.style.display = 'flex';
    roomCreated = true;
    userJoined = true;

    const ctx = { role: 'facilitator', hasRoomInUrl: true, hasModKey: true };
    if (alreadyJoined) {
      // Joined facilitator (e.g. after a refresh): in-session config — Create
      // shows "Room Created" and name/join/emoji are hidden. Auto-rejoin
      // restores the session and role.
      render(deriveControls(STATES.JOINED, ctx), STATES.JOINED, ctx);
    } else {
      // Live create / fresh deep-link: keep the "Room Created" button while the
      // facilitator can still enter a name before the auto-join completes. This
      // legacy entry combination maps to no single deriveControls state, so it
      // is expressed directly through the same render().
      render({
        create: { visible: true, enabled: false, label: 'Room Created' },
        name: { visible: true, enabled: true },
        join: { visible: true, enabled: true },
        emoji: { visible: true, enabled: true }
      }, STATES.INITIAL, ctx);
    }
  } else {
    // Participant link. Clear the name field so participants enter their own name.
    const nameField = cachedElements.name || el('name');
    if (nameField && !alreadyJoined) nameField.value = '';

    const ctx = { role: alreadyJoined ? 'participant' : null, hasRoomInUrl: true, hasModKey: false };
    if (alreadyJoined) {
      // Already joined: in-session config (Create hidden, name/join/emoji hidden);
      // auto-rejoin restores the session.
      if (footer) footer.style.display = 'flex';
      render(deriveControls(STATES.JOINED, ctx), STATES.JOINED, ctx);
    } else {
      // Pre-join participant entry (INITIAL): Create hidden, name/emoji visible,
      // Join gated by name (enabled by the name input listener in task 5.2).
      render(deriveControls(STATES.INITIAL, ctx), STATES.INITIAL, ctx);
      // Auto-focus the name field so participants can start typing immediately.
      if (nameField) {
        setTimeout(() => nameField.focus(), 100);
      }
    }
  }
}
/** ---------- Bootstrap: initial machine-state selection ---------- */
// Reconcile the Session_State_Machine with reality on load (Req 7.1, 7.4). When
// a stored joined session exists for the current room, choose BOOTSTRAP_RESUME
// so the machine enters RESUMING (and the subsequent 'connect' handler re-emits
// room:join with the stored clientId via joinPayload); otherwise choose
// BOOTSTRAP_FRESH, leaving the machine in INITIAL.
//
// This runs BEFORE applyInitialRoleView() so that the role-aware transitional
// render below remains the authoritative render for the create/join entry
// controls (task 5.4 left applyInitialRoleView/updateRoombar as that render),
// while the machine state now correctly tracks resume-vs-fresh. On resume the
// first room:state dispatches ROOM_STATE, carrying RESUMING -> JOINED so the
// machine converges on the real session state after a refresh.
const bootstrapEvent = hasStoredJoinedSession(currentRoom)
  ? EVENTS.BOOTSTRAP_RESUME
  : EVENTS.BOOTSTRAP_FRESH;
sessionMachine.dispatch(bootstrapEvent);

applyInitialRoleView();

/** Handle participant reconnection logic */
function handleParticipantReconnection() {
  const storedRoomId = getStoredRoomId();
  const storedUserName = getStoredUserName();
  const wasJoined = storedRoomId === currentRoom && isAlreadyJoined();
  
  // Early return if we don't have the necessary data
  if (!storedUserName || !wasJoined) {
    // No matching stored session: fall back to the pre-join participant entry
    // (INITIAL) so the user can join manually, routed through the single render().
    joinButtonClicked = false;
    const ctx = { role: null, hasRoomInUrl: !!currentRoom, hasModKey: false };
    render(deriveControls(STATES.INITIAL, ctx), STATES.INITIAL, ctx);
    return;
  }

  // Attempt automatic reconnection for participant (RESUMING). Keep the
  // in-session config (name and Join hidden/disabled, never reverting to
  // pre-join) via the single render(), then re-emit room:join to resume.
  joinButtonClicked = true;
  const ctx = { role: 'participant', hasRoomInUrl: !!currentRoom, hasModKey: false };
  render(deriveControls(STATES.RESUMING, ctx), STATES.RESUMING, ctx);

  // Emit room:join event to rejoin with stored identity. Built via joinPayload
  // so the durable clientId is always attached (Req 5.3, 8.2).
  socket.emit('room:join', joinPayload({
    roomId: currentRoom,
    name: storedUserName,
    emoji: getStoredEmoji(),
    modKey: null
  }));
  
  // NOTE: We intentionally do NOT arm a short RECONNECTION_TIMEOUT_MS timer that
  // clears session storage and forces a manual re-join here. A backgrounded tab
  // can take longer than a few seconds to resume, and tearing down the session
  // on that basis is exactly the bug we are fixing (a mere background lapse must
  // never force a manual re-join). We let Socket.IO's built-in reconnection run
  // and rely on the server's disconnect grace period to preserve the session.
  // A genuinely unrecoverable failure is handled via the 'reconnect_failed'
  // handler below, not a timer tied to backgrounding.
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

  // Reconnect begins from a disconnected in-session state: DISCONNECTED ->
  // RESUMING (Req 8.2). Only fires when the machine genuinely reached
  // DISCONNECTED (i.e. we disconnected while joined), so an initial connect or a
  // not-yet-bootstrapped resume is left untouched. The room:join re-emit below
  // carries the complete payload (room, name, emoji, modKey, clientId).
  if (sessionMachine.getState() === STATES.DISCONNECTED) {
    sessionMachine.dispatch(EVENTS.RECONNECT_ATTEMPT);
  }

  if (currentRoom && modKey) {
    // Facilitator: auto-rejoin (payload via joinPayload — Req 5.3, 8.2).
    // Prefer the sessionStorage-backed name (set on initial join) over the DOM
    // field value — localStorage (which pre-fills the field) is shared across
    // tabs, so a participant joining in another tab can overwrite it, causing the
    // facilitator to reconnect with the participant's name.
    const nameVal = getStoredUserName() || (nameField?.value ?? '').trim() || 'Facilitator';
    socket.emit('room:join', joinPayload({ roomId: currentRoom, name: nameVal, emoji: getSelectedEmoji() || getStoredEmoji(), modKey }));
  } else if (currentRoom) {
    // Participant automatic reconnection logic
    handleParticipantReconnection();
  }
  
  // A successful (re)connection means any in-flight transient lapse has
  // recovered. Clear the reconnecting gate so future genuine failures can
  // surface again, and let the pill flip Disconnected -> Reconnected quietly.
  isReconnecting = false;

  // Update connection status
  updateReconnectionStatus();
});

socket.on('connect_error', (err) => {
  // Keep diagnostics in the console, but do NOT surface a toast on every retry.
  // A single backgrounding-induced lapse can emit several connect_error events;
  // spamming a toast per event is exactly the noise we are suppressing. The
  // quiet 'Disconnected' pill (set on disconnect) already conveys status, and a
  // genuinely unrecoverable failure is escalated via 'reconnect_failed'.
  console.error('[socket] connect_error', err);
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected', reason);
  // Treat the lapse as transient and auto-recovering: show a single quiet status
  // indication via the pill and do NOT surface a toast. Socket.IO's built-in
  // reconnection runs and the server's disconnect grace period preserves the
  // session; only a truly exhausted reconnect ('reconnect_failed') escalates.
  isReconnecting = true;
  const modePill = cachedElements.modePill || el('modePill');
  if (modePill) setPill(modePill, 'Disconnected', 'warn');

  // Drive the machine only when actually in-session (Req 8.1): JOINED ->
  // DISCONNECTED. Because DISCONNECTED derives the in-session config, the
  // create/join controls stay in their JOINED configuration and never revert to
  // the pre-join controls during the lapse (Req 8.5). Guarded by userJoined so a
  // not-yet-confirmed session is left untouched.
  if (userJoined) sessionMachine.dispatch(EVENTS.SOCKET_DISCONNECT);
});

socket.on('error', ({ message }) => {
  showToast(message || 'An error occurred', 'error');
});

// Only fall back to a manual re-join after Socket.IO has genuinely exhausted its
// reconnection attempts — never merely because the tab was backgrounded. This is
// the sole remaining path that surfaces the manual-rejoin fallback.
socket.on('reconnect_failed', () => {
  console.warn('[socket] reconnection attempts exhausted');
  // Recovery has genuinely failed: the transient lapse is over and we now
  // escalate to a single user-facing notification (handleReconnectionFailure
  // surfaces the manual-rejoin toast) rather than staying quiet.
  isReconnecting = false;
  if (!userJoined) {
    handleReconnectionFailure();
  }
});

/** ---------- Tab/window/app lifecycle handling ---------- */
// Browsers throttle timers and can suspend the socket when a tab/window/app is
// backgrounded, which lapses the Socket.IO heartbeat. These listeners let the
// client promptly resume the existing session (using the stable clientId) when
// the user returns, and distinguish a real unload (intentional leave) from a
// background suspension so we never force-clear the session on backgrounding.

/** Resume the session immediately if we returned to the foreground disconnected. */
function resumeSessionIfDisconnected() {
  // If we have an active session context and the socket has dropped, ask
  // Socket.IO to reconnect right away. The subsequent 'connect' handler
  // re-emits room:join with the stored clientId so the server resumes us.
  if (currentRoom && socket && !socket.connected) {
    try {
      if (typeof socket.connect === 'function') {
        socket.connect();
      }
    } catch (err) {
      console.warn('Failed to trigger reconnect on foreground:', err);
    }
  }
}

// Reference document/window listener APIs defensively (jsdom/test env safe).
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resumeSessionIfDisconnected();
    }
  });
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // pageshow: fired on normal navigation and when restored from the bfcache
  // (event.persisted === true). In both cases, if we came back disconnected,
  // resume the session rather than forcing a manual re-join.
  window.addEventListener('pageshow', () => {
    resumeSessionIfDisconnected();
  });

  // pagehide: distinguish a background suspension (event.persisted === true,
  // page kept in bfcache) from a true unload (persisted === false). On a real
  // unload the browser tears down the socket and the server's grace timer will
  // eventually remove the user (preserving intentional-leave behavior). On a
  // background suspension we do NOT clear our own session — the user may return.
  window.addEventListener('pagehide', (event) => {
    if (event && event.persisted) {
      // Backgrounded into bfcache — keep the session intact for a seamless resume.
      return;
    }
    // Genuine unload: no client-side action needed. Intentional-leave removal is
    // handled server-side once the disconnect grace period elapses.
  });
}

/** ----- Server → Client events ----- */
socket.on('room:created', ({ roomId, modKey: createdModKey }) => {
  currentRoom = roomId; modKey = createdModKey;
  roomCreated = true;
  userJoined = true; // Mark as joined so functionality is enabled
  // Drive the machine: CREATING -> JOINED as a facilitator (Req 2.3, 2.4). The
  // role is set on the machine context so deriveControls exposes moderator
  // controls and the created-configuration Create button.
  sessionMachine.setContext({ role: 'facilitator' });
  sessionMachine.dispatch(EVENTS.ROOM_CREATED);
  saveJoinedState(); // Save that facilitator has joined
  // Persist Remembered_Defaults on the facilitator's successful create+join
  // (Req 6.1). room:created marks userJoined=true, so the room:state first-join
  // save below is skipped for the facilitator; save here instead.
  {
    const createdNameField = cachedElements.name || el('name');
    saveDefaults((createdNameField?.value ?? '').trim(), getSelectedEmoji());
  }
  
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

  // The facilitator entered their name/emoji in the pre-create view (Req 2.5),
  // so we do NOT re-show the Name/Join/emoji controls here — the JOINED
  // in-session config (rendered via ROOM_CREATED above) keeps them hidden.
  //
  // Auto-join the facilitator with the name they entered, defaulting to
  // "Facilitator" only when left blank (payload via joinPayload so the durable
  // clientId is always attached — Req 5.3).
  const nameField = cachedElements.name || el('name');
  const nameVal = (nameField?.value ?? '').trim() || 'Facilitator';
  socket.emit('room:join', joinPayload({ roomId: currentRoom, name: nameVal, emoji: getSelectedEmoji(), modKey }));
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
  // Only connected participants count toward voting, so a lingering "away" vote
  // never keeps Reveal/Clear enabled on its own.
  const hasVotes = Object.values(state.users ?? {})
    .some(u => u.connected !== false && u.vote && u.vote !== null);
  
  const revealBtn = el('revealBtn');
  if (revealBtn) {
    revealBtn.disabled = !state.youAreModerator || !hasActiveStory || state.phase === 'revealed' || !hasVotes;
  }
  
  const clearBtn = el('clearBtn');
  if (clearBtn) {
    clearBtn.disabled = !state.youAreModerator || !hasActiveStory || !!state.story?.finalPoints || !hasVotes;
  }
}

// Helper function to update roombar UI.
// A room:state means membership is confirmed (Session_State JOINED), so the
// create/join entry controls are rendered in their in-session configuration
// through the single render(): the Create button shows "Room Created" for a
// facilitator and is hidden for a participant, while name/join/emoji are hidden
// for both roles (Req 2.4, 3.4). In-session moderator controls (story form,
// reveal/clear) continue to key off state.youAreModerator elsewhere.
function updateRoombar(state) {
  const role = state.youAreModerator ? 'facilitator' : 'participant';
  const ctx = { role, hasRoomInUrl: !!currentRoom, hasModKey: !!modKey };
  render(deriveControls(STATES.JOINED, ctx), STATES.JOINED, ctx);
}

// Helper function to show/hide story form based on moderator status
function updateStoryFormVisibility(state) {
  const jiraNumber = cachedElements.jiraNumber || el('jiraNumber');
  const storyTitle = cachedElements.storyTitle || el('storyTitle');
  const addToQueueBtn = el('addToQueueBtn');
  const jiraNumberLabel = document.querySelector('label[for="jiraNumber"]');
  const storyTitleLabel = document.querySelector('label[for="storyTitle"]');
  const addStoryHeader = document.querySelector('.storyForm > .resultsTitle:first-child');
  const storyInputCol = document.querySelector('.storyInputCol');
  const storyQueueHeader = document.querySelectorAll('.storyForm > .resultsTitle')[1];
  
  if (state.youAreModerator) {
    // Show entire Add a Story section for facilitators
    if (addStoryHeader) addStoryHeader.style.display = '';
    if (storyInputCol) storyInputCol.style.display = '';
    if (jiraNumber) jiraNumber.style.display = '';
    if (storyTitle) storyTitle.style.display = '';
    if (addToQueueBtn) addToQueueBtn.style.display = '';
    if (jiraNumberLabel) jiraNumberLabel.style.display = '';
    if (storyTitleLabel) storyTitleLabel.style.display = '';
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
    if (addToQueueBtn) addToQueueBtn.style.display = 'none';
    if (jiraNumberLabel) jiraNumberLabel.style.display = 'none';
    if (storyTitleLabel) storyTitleLabel.style.display = 'none';
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

  // Drive the machine: membership is confirmed, so resolve the role from the
  // room state (facilitator iff youAreModerator, else participant) and dispatch
  // ROOM_STATE. This carries JOINING/RESUMING/DISCONNECTED -> JOINED (Req 3.3,
  // 7.2, 8.3) and is a no-op once already JOINED. updateRoombar (below) remains
  // the authoritative in-session render for resume/refresh paths whose initial
  // state selection lands in task 5.5.
  sessionMachine.setContext({ role: state.youAreModerator ? 'facilitator' : 'participant' });
  sessionMachine.dispatch(EVENTS.ROOM_STATE);

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
    // Persist the last-used name/emoji as Remembered_Defaults on a successful
    // join (Req 6.1); pre-filled on the next fresh load via loadDefaults().
    const joinedNameField = cachedElements.name || el('name');
    saveDefaults((joinedNameField?.value ?? '').trim(), getSelectedEmoji());
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
    // Prefer the stable identity (myId = clientId) now that room.users is keyed
    // by clientId; fall back to mySocketId for backward compatibility.
    const myKey = state.myId ?? state.mySocketId;
    const myEntry = myKey && state.users && state.users[myKey];
    if (!myEntry || myEntry.vote === null) {
      myVote = null;
    }
  }

  // Reset selection when phase changes or story changes. This MUST run before
  // renderAllComponents so a stale selectedFinalPoint from a previous round
  // cannot render a chip in the selected state on this broadcast (Req 6.5) —
  // e.g. the voting-phase state that follows a re-vote.
  if (state.phase !== 'revealed' || !state.activeStoryId) {
    selectedFinalPoint = null;
  }

  renderAllComponents(state, canFinalize);
});

/** ---------- UI → Server ---------- */
const createRoomBtnElement = el('createRoomBtn');

if (!createRoomBtnElement) {
  console.error('createRoomBtn element not found!');
}

el('createRoomBtn').onclick = () => {
  // Guard: only create from the pre-join INITIAL state. Once a room has been
  // created (JOINED/CREATING/etc.) the button is just a "Room Created" status
  // indicator; a stray click must not emit a second room:create.
  if (roomCreated || sessionMachine.getState() !== STATES.INITIAL) return;
  const nameField = cachedElements.name || el('name');
  const rawName = nameField?.value ?? '';
  // Guard: a room cannot be created without a non-empty (non-whitespace) name.
  // Mirrors the isJoinable gate that drives the Create button's enabled state.
  if (!isJoinable(rawName)) return showToast('Enter your name.', 'error');
  const name = rawName.trim();
  saveName(name);
  const emoji = getSelectedEmoji();
  saveEmoji(emoji);
  // Drive the machine: INITIAL -> CREATING (Req 2.1). The single render()
  // subscriber disables the Create control for the CREATING state.
  sessionMachine.setContext({ role: 'facilitator' });
  sessionMachine.dispatch(EVENTS.CREATE_CLICK);
  setLoading('createRoomBtn', true);
  // Emit through joinPayload so the durable clientId is always attached (Req 5.3).
  socket.emit('room:create', joinPayload({ name, emoji }));
  
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
  const rawName = nameField?.value ?? '';
  // Re-check the name gate before joining (Req 4.3). A whitespace-only or empty
  // name must NOT emit room:join and must NOT change the Session_State: return
  // early, leaving joinButtonClicked/userJoined untouched, and keep the existing
  // toast. This mirrors the isJoinable gate that drives the Join enabled state.
  if (!isJoinable(rawName)) return showToast('Enter your name.', 'error');
  const name = rawName.trim();
  saveName(name);
  const emoji = getSelectedEmoji();
  saveEmoji(emoji);

  if (!currentRoom) return showToast('No room to join. Create a room first.', 'error');
  
  // Clear old session data before joining new room
  clearSessionData();
  
  // Drive the machine: INITIAL -> JOINING (Req 3.1). The single render()
  // subscriber disables the Name field and Join button for the JOINING state.
  joinButtonClicked = true;
  sessionMachine.dispatch(EVENTS.JOIN_CLICK);
  setLoading('joinBtn', true);
  setDisabled('name', true);

  // Emit through joinPayload so the durable clientId is always attached (Req 5.3).
  socket.emit('room:join', joinPayload({ roomId: currentRoom, name, emoji, modKey }));
  
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

/**
 * Live entry-control gating on Name input (Req 4.1, 4.2).
 *
 * In the pre-join entry view (Session_State INITIAL) the enabled state of the
 * primary entry action must track the Name field: enabled exactly when
 * `isJoinable(value)` is true. This applies to BOTH the Create Room button (no
 * room in the URL) and the Join button (room in the URL) so neither can be
 * activated without a non-empty name. It is routed through the single
 * `render()` path (not an ad hoc `setDisabled`) to preserve the single
 * source-of-truth approach: we derive the pre-join control config for the
 * current context via `deriveControls`, override `create.enabled`/`join.enabled`
 * with `isJoinable(value)`, and render.
 *
 * Gating applies only to the pre-join entry (INITIAL). Once a create/join/resume
 * is in flight or confirmed, the state is no longer INITIAL and the Name field
 * is hidden, so gating no longer applies. A facilitator deep-link (modKey
 * present) renders a custom "Room Created" view outside `deriveControls`, so it
 * is left untouched here.
 */
function syncEntryEnabledFromName() {
  if (modKey) return;
  if (sessionMachine.getState() !== STATES.INITIAL) return;
  const nameField = cachedElements.name || el('name');
  const value = nameField?.value ?? '';
  const joinable = isJoinable(value);
  const ctx = { role: null, hasRoomInUrl: !!currentRoom, hasModKey: false };
  const controls = deriveControls(STATES.INITIAL, ctx);
  controls.create = { ...controls.create, enabled: joinable };
  controls.join = { ...controls.join, enabled: joinable };
  render(controls, STATES.INITIAL, ctx);
}
el('name').addEventListener('input', syncEntryEnabledFromName);
// Set the initial enabled state so a pre-filled (remembered) name enables the
// entry action on load, and an empty name leaves it disabled.
syncEntryEnabledFromName();

// Enable Enter key in the name field to trigger the active entry action:
// Create Room for a facilitator (no room in URL) or Join for a participant.
// Whichever button is currently visible and enabled is clicked.
el('name').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const createBtn = el('createRoomBtn');
    const joinBtn = el('joinBtn');
    const isActive = (btn) => btn && !btn.classList.contains('hidden') && !btn.disabled;
    if (isActive(createBtn)) {
      createBtn.click();
    } else if (isActive(joinBtn)) {
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
// Story Title allows any characters (no filtering).
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

  socket.emit('storyQueue:add', {
    roomId: currentRoom,
    story: {
      number: jiraField?.value || '',
      title
    }
  });

  if (jiraField) jiraField.value = '';
  if (titleField) titleField.value = '';
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
    // Render special cards as enlarged emoji while keeping their underlying
    // vote value intact ('?' stays '?' for server/calculation logic).
    const isEmojiCard = v === '☕' || v === '?';
    b.textContent = v === '?' ? '❓' : v;
    if (isEmojiCard) b.classList.add('deckEmoji');
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

  // A disconnected participant is retained as "away" during the grace window
  // rather than removed, so mark it visually and for assistive tech.
  const isAway = user.connected === false;
  if (isAway) li.classList.add('isAway');

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

  if (isAway) {
    const awayBadge = document.createElement('span');
    awayBadge.className = 'uaway';
    awayBadge.textContent = 'Away';
    nameWrap.appendChild(awayBadge);
  }

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
  const presenceLabel = isAway ? ', Away' : '';
  li.setAttribute('aria-label', `${user.name}, ${roleLabel}${presenceLabel}, ${statusText}`);

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
    // Count only currently-connected participants toward the tally. An "away"
    // participant's stale vote must not skew min/max/avg/median.
    .filter((u) => u.connected !== false)
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

/**
 * Partition the queue into the two rendered sections.
 *   - pending: stories still needing an estimate, active story pinned first
 *   - done:    stories with a finalized estimate, in original queue order
 * Both groups preserve insertion order otherwise so rows don't jump around.
 */
function partitionStoryQueue(queue, activeStoryId) {
  const pending = [];
  const done = [];
  queue.forEach((story) => {
    if (story && isFinalizedValue(story.finalPoints)) done.push(story);
    else pending.push(story);
  });

  pending.sort((a, b) => {
    if (a.id === activeStoryId) return -1;
    if (b.id === activeStoryId) return 1;
    return 0;
  });

  return { pending, done };
}

// Helper function to create delete button (removes the story immediately)
function createDeleteButton(storyId, currentRoom, socket) {
  const rmBtn = document.createElement('button');
  rmBtn.className = 'queueBtn';
  rmBtn.type = 'button';
  rmBtn.textContent = '❌';
  // Without a label the accessible name is the bare ❌ emoji. Naming it here
  // on the shared builder covers finalized and pending cards alike (Req 1.12).
  rmBtn.setAttribute('aria-label', 'Delete story');
  rmBtn.title = 'Delete story';
  rmBtn.dataset.storyId = storyId;

  rmBtn.onclick = (e) => {
    e.stopPropagation();
    socket.emit('storyQueue:remove', { roomId: currentRoom, storyId: storyId });
  };

  // A native <button> already activates on Enter/Space in a browser, but jsdom
  // does not synthesize that click, so the helper makes Req 9.2 observable. It
  // calls click(), which runs the same single-emit onclick above.
  addKeyboardClickSupport(rmBtn);

  return rmBtn;
}

/**
 * Build the final estimate pill for a finalized story: a small "FINAL" label
 * beside the stored value, mirroring the "Final" metric chip from the
 * results/math area scaled down to suit the story card.
 */
function createFinalChip(story) {
  const finalChip = document.createElement('div');
  finalChip.className = 'queueFinalChip';
  finalChip.setAttribute('aria-label', `Final estimate: ${story.finalPoints}`);

  const label = document.createElement('span');
  label.className = 'queueFinalChipLabel';
  label.textContent = 'Final';

  const value = document.createElement('span');
  value.className = 'queueFinalChipValue';
  value.textContent = story.finalPoints;

  finalChip.appendChild(label);
  finalChip.appendChild(value);
  return finalChip;
}

// Helper function to create queue item title row
function createQueueTitleRow(story, isActive) {
  const titleRow = document.createElement('div');
  titleRow.className = 'queueTitleRow';

  // Display Jira number as separate element. Show a placeholder pill when none is set.
  const numberSpan = document.createElement('span');
  numberSpan.className = 'queueNumber';
  if (story.number) {
    numberSpan.textContent = story.number.substring(0, 12); // Max 12 chars
  } else {
    numberSpan.textContent = 'JIRA-####';
  }
  titleRow.appendChild(numberSpan);

  // Active story is indicated by the full accent border on the card
  // (see .queueActive in styles.css), so no text badge is needed here.
  // The final estimate pill sits beside the story number, reading as story
  // metadata, so the actions area holds only the card's actual controls.
  if (isFinalizedValue(story.finalPoints)) {
    titleRow.appendChild(createFinalChip(story));
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
  numberInput.className = 'queueEditInput queueEditNumber';
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
  titleInput.className = 'queueEditInput queueEditTitle';
  titleInput.type = 'text';
  titleInput.maxLength = 100;
  titleInput.placeholder = 'Story Title';
  titleInput.value = story.title || '';
  titleInput.setAttribute('aria-label', 'Story Title');

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
        title
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

  const fieldsRow = document.createElement('div');
  fieldsRow.className = 'queueEditFieldsRow';
  fieldsRow.appendChild(numberInput);
  fieldsRow.appendChild(titleInput);

  form.appendChild(fieldsRow);
  form.appendChild(editActions);

  li.appendChild(form);
  titleInput.focus();
}

/**
 * Build the Re-Vote control for a finalized story card. Facilitator-only; the
 * caller decides whether to append it (Req 1.1, 1.2).
 */
function createRevoteButton(story) {
  const btn = document.createElement('button');
  btn.className = 'queueBtn queueRevoteBtn';
  btn.type = 'button';                                  // Req 1.4
  btn.textContent = 'Re-Vote';                          // Req 1.5
  btn.setAttribute('aria-label', 'Re-vote story');      // Req 1.4
  btn.title = 'Re-vote story';
  btn.dataset.storyId = story.id;                       // Req 1.7
  btn.disabled = false;                                 // Req 1.9, 2.7
  // stopPropagation keeps the activation off the enclosing card (Req 2.6).
  btn.onclick = (e) => { e.stopPropagation(); requestRevote(story.id); };
  addKeyboardClickSupport(btn);                         // Req 2.1 (Enter / Space)
  return btn;
}

/**
 * Ask the server to clear a finalized estimate and reopen the story for voting.
 * Guards run id → room → connection and each returns before any emit, so a
 * blocked activation emits nothing and mutates no client state (Req 2.3, 2.4,
 * 2.8). On the success path nothing here touches the DOM or `lastState` — the
 * queue changes only when the broadcast arrives (Req 2.2, 2.5).
 */
function requestRevote(storyId) {
  const id = normalizeStoryId(storyId);
  if (!id) return showToast('Could not identify the story to re-vote', 'error');  // Req 2.8
  if (!currentRoom) return showToast('Join a room first', 'error');               // Req 2.4
  if (!socket || !socket.connected) return showToast('Not connected to server', 'error');  // Req 2.3

  socket.emit('storyQueue:revote', { roomId: currentRoom, storyId: id }, (res) => {
    // The button is never disabled, so a rejected request stays retryable (Req 2.7).
    if (res && res.ok === false) showToast(res.reason || 'Re-vote failed', 'error');
  });
}

// Helper function to create queue item actions
function createQueueActions(story, state, li) {
  const actions = document.createElement('div');
  actions.className = 'queueActions';

  // A finalized story has moved to "Estimate Done" and is no longer
  // actionable, so the Vote and edit buttons are not shown. The final estimate
  // pill lives in the title row beside the story number
  // (see createQueueTitleRow), not here.
  if (isFinalizedValue(story.finalPoints)) {
    // The facilitator can remove a finalized story, or send it back for
    // re-estimation. This branch returns immediately, so the facilitator's
    // action area is exactly [Delete, Re-Vote] and a participant's is empty —
    // no Vote and no edit control either way (Req 1.1, 1.2, 1.6, 1.11). The delete
    // control is the same shared builder the pending cards use, so it emits
    // the same `storyQueue:remove` event with the same payload, unguarded and
    // without a confirmation prompt (Req 9.3, 9.5, 9.9). Nothing here consults
    // `activeStoryId`, so a finalized active story gets both controls enabled
    // like any other card (Req 1.9).
    if (state.youAreModerator) {
      const rmBtn = createDeleteButton(story.id, currentRoom, socket);
      rmBtn.classList.add('queueIconBtn');   // same square icon sizing as pending cards
      actions.appendChild(rmBtn);
      actions.appendChild(createRevoteButton(story));
    }
    return actions;
  }

  // Facilitator-only buttons
  if (state.youAreModerator) {
    const setBtn = document.createElement('button');
    setBtn.className = 'queueBtn primary' + (state.activeStoryId === story.id ? ' activeEstimate' : '');
    setBtn.type = 'button';
    setBtn.textContent = 'Vote';
    // Disable if story is active OR if story has been finalized
    setBtn.disabled = state.activeStoryId === story.id || !!story.finalPoints;
    setBtn.onclick = () => socket.emit('storyQueue:setActive', { roomId: currentRoom, storyId: story.id });

    const editBtn = document.createElement('button');
    editBtn.className = 'queueBtn queueIconBtn';
    editBtn.type = 'button';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit story';
    editBtn.setAttribute('aria-label', 'Edit story');
    editBtn.onclick = (e) => {
      e.stopPropagation();
      enterStoryEditMode(li, story);
    };

    const rmBtn = createDeleteButton(story.id, currentRoom, socket);
    rmBtn.classList.add('queueIconBtn');

    actions.appendChild(rmBtn);
    actions.appendChild(editBtn);
    actions.appendChild(setBtn);
  }

  return actions;
}

// Helper function to create queue item element
function createQueueItemElement(story, state) {
  // The accent border marks the story currently being estimated. A finalized
  // story has moved to "Estimate Done" and is no longer the active story, so
  // it should not carry the selected/active highlight.
  const isActive = state.activeStoryId === story.id && !isFinalizedValue(story.finalPoints);

  const li = document.createElement('li');
  li.className = 'queueItem' + (isActive ? ' queueActive' : '');

  const left = document.createElement('div');
  left.className = 'queueLeft';

  const titleRow = createQueueTitleRow(story, isActive);
  left.appendChild(titleRow);

  // Display title on its own line
  const title = document.createElement('div');
  title.className = 'queueTitle';
  const maxTitleLength = 50;
  title.textContent = story.title.length > maxTitleLength ? story.title.substring(0, maxTitleLength) + '...' : story.title;
  left.appendChild(title);

  const actions = createQueueActions(story, state, li);

  li.appendChild(left);
  li.appendChild(actions);
  
  return li;
}

/** Render a single story group into its list, or a per-section empty state. */
function renderQueueSection(listId, stories, state, emptyMessage) {
  const list = el(listId);
  if (!list) return;
  list.innerHTML = '';

  if (!stories.length) {
    const li = document.createElement('li');
    li.className = 'queueItem queueEmptySection';
    const msg = document.createElement('span');
    msg.className = 'queueEmptyText';
    msg.textContent = emptyMessage;
    li.appendChild(msg);
    list.appendChild(li);
    return;
  }

  const frag = document.createDocumentFragment();
  stories.forEach((story) => {
    frag.appendChild(createQueueItemElement(story, state));
  });
  list.appendChild(frag);
}

function renderQueue(state) {
  const queue = Array.isArray(state.storyQueue) ? state.storyQueue : [];

  const emptyAll = el('queueEmptyAll');
  const pendingSection = document.querySelector('.queueSection[data-section="pending"]');
  const doneSection = document.querySelector('.queueSection[data-section="done"]');

  // Whole-queue empty state: hide both sections, show the single placeholder.
  if (!queue.length) {
    if (emptyAll) emptyAll.hidden = false;
    if (pendingSection) pendingSection.hidden = true;
    if (doneSection) doneSection.hidden = true;
    updateExportControls();
    return;
  }

  if (emptyAll) emptyAll.hidden = true;
  if (pendingSection) pendingSection.hidden = false;
  if (doneSection) doneSection.hidden = false;

  const { pending, done } = partitionStoryQueue(queue, state.activeStoryId);

  renderQueueSection('queuePendingList', pending, state, 'All stories estimated 🎉');
  renderQueueSection('queueDoneList', done, state, 'No finalized stories');

  const pendingCount = el('queuePendingCount');
  if (pendingCount) pendingCount.textContent = `(${pending.length})`;
  const doneCount = el('queueDoneCount');
  if (doneCount) doneCount.textContent = `(${done.length})`;

  updateExportControls();
}

/** ---------- Export Story Queue ---------- */

/** Return the current story queue from the last known room state. */
function getQueueForExport() {
  return Array.isArray(lastState?.storyQueue) ? lastState.storyQueue : [];
}

/**
 * Determine whether a story has a usable final points value.
 * Delegates to the shared `isFinalizedValue` predicate so the export summary
 * agrees with queue partitioning, the card action area, and the active-story
 * highlight (Req 6.8).
 */
function hasFinalPoints(story) {
  return isFinalizedValue(story?.finalPoints);
}

/** Build room/date metadata used across export formats. */
function buildExportMeta() {
  const roomId = lastState?.roomId || currentRoom || '—';
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return { roomId, dateStr, timeStr, now };
}

/** Summarize the queue: totals and sum of final points. */
function summarizeQueue(queue) {
  let finalized = 0;
  let pointsTotal = 0;
  queue.forEach((s) => {
    if (hasFinalPoints(s)) {
      finalized += 1;
      const n = Number(s.finalPoints);
      if (Number.isFinite(n)) pointsTotal += n;
    }
  });
  return { total: queue.length, finalized, pointsTotal };
}

/** Trigger a client-side file download. */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build a filesystem-safe filename fragment from the room id. */
function exportFileBase() {
  const roomId = lastState?.roomId || currentRoom || 'room';
  const safe = String(roomId).replace(/[^A-Za-z0-9\-]/g, '').toUpperCase() || 'ROOM';
  return `flaps-${safe}-estimates`;
}

/** Escape a value for safe use inside a Markdown table cell. */
function mdCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** Escape a value for safe insertion into HTML. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** Export the story queue as a Markdown document (final points only). */
function exportQueueMarkdown() {
  const queue = getQueueForExport();
  if (!queue.length) return showToast('No stories in the queue to export.', 'warn');

  const { roomId, dateStr, timeStr } = buildExportMeta();
  const { total, finalized, pointsTotal } = summarizeQueue(queue);

  const lines = [];
  lines.push('# FLAPS — Story Point Estimates');
  lines.push('');
  lines.push(`**Room:** ${mdCell(roomId)}  `);
  lines.push(`**Generated:** ${dateStr} at ${timeStr}  `);
  lines.push(`**Stories:** ${total} &nbsp;•&nbsp; **Estimated:** ${finalized} &nbsp;•&nbsp; **Total Points:** ${pointsTotal}`);
  lines.push('');
  lines.push('| # | Jira | Story | Final Points |');
  lines.push('| :--: | :-- | :-- | :--: |');
  queue.forEach((s, i) => {
    const num = mdCell(s.number) || '—';
    const title = mdCell(s.title) || '—';
    const pts = hasFinalPoints(s) ? mdCell(s.finalPoints) : '—';
    lines.push(`| ${i + 1} | ${num} | ${title} | ${pts} |`);
  });
  lines.push('');
  lines.push('---');
  lines.push('_Generated by FLAPS · Fibonacci Lean Agile Pointing System_');

  downloadFile(`${exportFileBase()}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  showToast('✓ Markdown exported', 'success');
}

/** Build a self-contained, print-ready HTML document for the queue. */
function buildExportHtml(queue, meta, summary) {
  const rows = queue.map((s, i) => {
    const ptsCell = hasFinalPoints(s)
      ? `<span class="pts">${escapeHtml(s.finalPoints)}</span>`
      : '<span class="ptsNone">Not estimated</span>';
    return `<tr>
        <td class="idx">${i + 1}</td>
        <td class="jira">${escapeHtml(s.number) || '<span class="dash">—</span>'}</td>
        <td class="story">
          <div class="titleText">${escapeHtml(s.title) || '<span class="dash">—</span>'}</div>
        </td>
        <td class="ptsCol">${ptsCell}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FLAPS — Story Point Estimates</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
<style>
  :root{
    --accent:#7c9aff;
    --ink:#e4e8f0;
    --muted:#8a96a8;
    --line:#2a3244;
    --line-strong:#3a4558;
    --soft:#1a2236;
    --accent-soft:#1e2a4a;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
    color:var(--ink);
    background:#121826;
    line-height:1.5;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .sheet{ max-width:820px; margin:0 auto; padding:40px 44px; }
  header.report{
    display:flex; align-items:center; justify-content:space-between;
    gap:24px; padding-bottom:18px; margin-bottom:24px;
    border-bottom:3px solid var(--accent);
  }
  .brandBlock .title{ font-size:24px; font-weight:900; letter-spacing:-.02em; margin:0; }
  .brandBlock .subtitle{ font-size:12px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-top:4px; }
  .metaBlock{ text-align:right; font-size:12px; color:var(--muted); }

  .summary{ display:flex; gap:12px; margin-bottom:26px; flex-wrap:wrap; }
  .statCard{
    flex:1 1 0; min-width:120px;
    border:1px solid var(--line); border-radius:8px;
    padding:14px 16px; background:var(--soft);
  }
  .statCard.accent{ background:var(--accent-soft); border-color:#3a4a7a; }
  .statCard .statLabel{ font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
  .statCard .statValue{ font-size:26px; font-weight:800; margin-top:4px; }
  .statCard.accent .statValue{ color:var(--accent); }

  table{ width:100%; border-collapse:collapse; font-size:13px; }
  thead th{
    text-align:left; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); padding:0 12px 10px; border-bottom:2px solid var(--line-strong);
  }
  thead th.idx{ width:36px; text-align:center; }
  thead th.ptsCol{ text-align:center; width:110px; }
  tbody td{ padding:14px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody tr:nth-child(even){ background:var(--soft); }
  td.idx{ text-align:center; color:var(--muted); font-weight:600; }
  td.jira{ font-weight:700; color:var(--accent); white-space:nowrap; }
  .titleText{ font-weight:600; }
  .dash{ color:var(--line-strong); }
  td.ptsCol{ text-align:center; }
  .pts{
    display:inline-block; min-width:38px; padding:6px 12px;
    background:var(--accent); color:#fff; border-radius:999px;
    font-weight:800; font-size:14px;
  }
  .ptsNone{ font-size:11px; font-style:italic; color:var(--muted); }

  footer.report{
    margin-top:28px; padding-top:16px; border-top:1px solid var(--line);
    display:flex; justify-content:space-between; align-items:center;
    font-size:11px; color:var(--muted);
  }
  footer.report .totals{ font-weight:700; color:var(--ink); }
  footer.report .totals span{ color:var(--accent); }

  @page{ margin:0; size:letter; }
  @media print{
    html, body{ background:#121826 !important; color:#e4e8f0 !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; margin:0; padding:0; overflow:hidden; height:100%; width:100%; }
    .sheet{ padding:16mm; max-width:none; }
    tbody tr{ break-inside:avoid; }
    .statCard{ background:#1a2236 !important; border-color:#2a3244 !important; }
    .statCard.accent{ background:#1e2a4a !important; border-color:#3a4a7a !important; }
    tbody tr:nth-child(even){ background:#1a2236 !important; }
    .pts{ background:#7c9aff !important; color:#fff !important; }
    header.report{ border-bottom-color:#7c9aff !important; }
    footer.report{ border-top-color:#2a3244 !important; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <header class="report">
      <div class="brandBlock">
        <p class="title">Story Point Estimates</p>
        <p class="subtitle">FLAPS · Fibonacci Lean Agile Pointing System</p>
      </div>
      <div class="metaBlock">
        <div>${escapeHtml(meta.dateStr)}</div>
        <div>${escapeHtml(meta.timeStr)}</div>
      </div>
    </header>

    <section class="summary">
      <div class="statCard">
        <div class="statLabel">Stories</div>
        <div class="statValue">${summary.total}</div>
      </div>
      <div class="statCard">
        <div class="statLabel">Estimated</div>
        <div class="statValue">${summary.finalized}</div>
      </div>
      <div class="statCard accent">
        <div class="statLabel">Total Points</div>
        <div class="statValue">${summary.pointsTotal}</div>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th class="idx">#</th>
          <th class="jira">Jira</th>
          <th class="story">Story</th>
          <th class="ptsCol">Final Points</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <footer class="report">
      <span>Generated by FLAPS</span>
      <span class="totals">Total: <span>${summary.pointsTotal}</span> points across ${summary.finalized} estimated ${summary.finalized === 1 ? 'story' : 'stories'}</span>
    </footer>
  </div>
  <script>
    (function(){
      // Scale content to fit a single printed page — only during print
      function scaleToFit(){
        var sheet = document.querySelector('.sheet');
        var pageH = 1056;
        var pageW = 816;
        sheet.style.transform = '';
        sheet.style.transformOrigin = 'top left';
        sheet.style.width = '';
        sheet.style.height = '';
        document.body.style.overflow = '';
        document.body.style.height = '';
        document.body.style.width = '';
        var rect = sheet.getBoundingClientRect();
        var scaleX = pageW / rect.width;
        var scaleY = pageH / rect.height;
        var scale = Math.min(scaleX, scaleY, 1);
        if(scale < 1){
          sheet.style.transform = 'scale(' + scale + ')';
          sheet.style.transformOrigin = 'top left';
          sheet.style.width = (pageW / scale) + 'px';
          sheet.style.height = (pageH / scale) + 'px';
          document.body.style.overflow = 'hidden';
          document.body.style.height = pageH + 'px';
          document.body.style.width = pageW + 'px';
        }
      }
      function resetScale(){
        var sheet = document.querySelector('.sheet');
        sheet.style.transform = '';
        sheet.style.width = '';
        sheet.style.height = '';
        document.body.style.overflow = '';
        document.body.style.height = '';
        document.body.style.width = '';
      }
      window.addEventListener('beforeprint', scaleToFit);
      window.addEventListener('afterprint', resetScale);
    })();
  </script>
</body>
</html>`;
}

/** Export the story queue as a print-ready PDF via the browser print dialog. */
function exportQueuePdf() {
  const queue = getQueueForExport();
  if (!queue.length) return showToast('No stories in the queue to export.', 'warn');

  const meta = buildExportMeta();
  const summary = summarizeQueue(queue);
  const html = buildExportHtml(queue, meta, summary);

  const win = window.open('', '_blank');
  if (!win) return showToast('Popup blocked. Allow popups to export a PDF.', 'error');

  win.document.open();
  win.document.write(html);
  win.document.close();

  // Wait for the document (and web fonts) to finish loading before printing.
  const triggerPrint = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === 'complete') {
    setTimeout(triggerPrint, 400);
  } else {
    win.onload = () => setTimeout(triggerPrint, 400);
  }

  showToast('Opening print dialog — choose "Save as PDF".', 'success');
}

/** Enable or disable export controls based on queue contents. */
function updateExportControls() {
  const hasStories = getQueueForExport().length > 0;
  const mdBtn = el('exportMdBtn');
  const pdfBtn = el('exportPdfBtn');
  if (mdBtn) mdBtn.disabled = !hasStories;
  if (pdfBtn) pdfBtn.disabled = !hasStories;
}

// Wire up export buttons
(function initExportControls() {
  const mdBtn = el('exportMdBtn');
  if (mdBtn) mdBtn.onclick = exportQueueMarkdown;
  const pdfBtn = el('exportPdfBtn');
  if (pdfBtn) pdfBtn.onclick = exportQueuePdf;
  updateExportControls();
})();
