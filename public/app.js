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
/** Style helper for the small status "pill" elements */
function setPill(target, text, kind = '') {
  const pill = typeof target === 'string' ? el(target) : target;
  if (!pill) return;
  pill.textContent = text;
  pill.classList.toggle('good', kind === 'good');
  pill.classList.toggle('warn', kind === 'warn');
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
