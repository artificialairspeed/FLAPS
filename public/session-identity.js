/**
 * session-identity.js
 *
 * Durable client identity and localStorage helpers for the create/join flow.
 *
 * Identity (`clientId`) and remembered name/emoji defaults are persisted to
 * `localStorage` (rather than `sessionStorage`) so they survive browser
 * restarts. All access to `localStorage` goes through the safe wrappers below,
 * which never throw: a blocked or quota-exhausted store degrades gracefully to
 * an in-memory identity for the current session.
 *
 * This module is intentionally DOM-free so it can be unit- and property-tested
 * directly. `public/app.js` wires it to the socket and DOM.
 */

/**
 * sessionStorage key under which the per-tab clientId is persisted.
 *
 * Identity is intentionally PER-TAB (sessionStorage), not per-browser
 * (localStorage): each tab/window is a distinct room participant. A per-tab id
 * survives reloads and tab-inactive/background lapses within the same tab, but a
 * separate tab/window (or a full browser restart) starts fresh. This prevents
 * two users in the same browser from being merged into a single server record
 * or inheriting each other's role (e.g. a participant resuming the facilitator's
 * moderator record). Remembered name/emoji defaults still live in localStorage.
 */
export const CLIENT_ID_KEY = 'flaps_client_id';

/** localStorage key under which the last-used display name is persisted. */
export const LS_NAME = 'flaps_name';

/** localStorage key under which the last-used emoji is persisted. */
export const LS_EMOJI = 'flaps_emoji';

/**
 * Read a value from localStorage without ever throwing.
 *
 * Wraps `localStorage.getItem` in try/catch to tolerate environments where
 * storage is unavailable (private mode, disabled, quota-related access errors).
 * On failure it warns and returns `null`.
 *
 * @param {string} key - The storage key to read.
 * @returns {string|null} The stored value, or `null` if absent or unavailable.
 */
export function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    // Storage unavailable/blocked; treat as absent.
    console.warn(`Failed to read localStorage key "${key}":`, err);
    return null;
  }
}

/**
 * Write a value to localStorage without ever throwing.
 *
 * Wraps `localStorage.setItem` in try/catch to tolerate quota-exceeded and
 * unavailable-storage conditions. On failure it warns and returns `false` so
 * callers can continue with an in-memory fallback.
 *
 * @param {string} key - The storage key to write.
 * @param {string} value - The value to persist.
 * @returns {boolean} `true` if the write succeeded, `false` otherwise.
 */
export function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    // Quota exceeded or storage unavailable; keep the in-memory value.
    console.warn(`Failed to persist localStorage key "${key}":`, err);
    return false;
  }
}

/**
 * Read a value from sessionStorage without ever throwing.
 *
 * sessionStorage is per-tab, so this backs the per-tab client identity. Wrapped
 * in try/catch to tolerate environments where storage is unavailable.
 *
 * @param {string} key - The storage key to read.
 * @returns {string|null} The stored value, or `null` if absent or unavailable.
 */
export function safeSessionGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (err) {
    console.warn(`Failed to read sessionStorage key "${key}":`, err);
    return null;
  }
}

/**
 * Write a value to sessionStorage without ever throwing.
 *
 * @param {string} key - The storage key to write.
 * @param {string} value - The value to persist.
 * @returns {boolean} `true` if the write succeeded, `false` otherwise.
 */
export function safeSessionSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`Failed to persist sessionStorage key "${key}":`, err);
    return false;
  }
}

/**
 * In-memory cache of the resolved clientId so repeated calls are stable within
 * a single load even when storage is unavailable.
 * @type {string|null}
 */
let cachedClientId = null;

/**
 * Generate a stable clientId, preferring `crypto.randomUUID` and falling back
 * to a Math.random-based RFC4122-ish v4 UUID in environments that lack it.
 *
 * @returns {string} A newly minted UUID-like identifier.
 */
function generateClientId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // crypto.randomUUID unavailable or blocked; fall through to manual generation.
  }
  // Fallback: RFC4122-ish v4 UUID using Math.random (sufficient for identity keying).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Return the stable per-tab clientId, minting one exactly once per tab.
 *
 * Resolution order:
 *  1. Reuse the in-memory cached value if already resolved in this tab.
 *  2. Reuse the value persisted in sessionStorage across reloads of this tab.
 *  3. Otherwise mint a new id and persist it to sessionStorage.
 *
 * Because it is backed by sessionStorage, the identity is scoped to a single
 * tab/window: it survives reloads and background/tab-inactive lapses, but a
 * separate tab or a full browser restart gets a fresh identity. If storage is
 * unavailable, the minted id is retained in memory for the current page so the
 * flow still works without persistence.
 *
 * @returns {string} The stable, non-empty per-tab clientId.
 */
export function getClientId() {
  if (cachedClientId) return cachedClientId; // In-memory reuse within the tab.

  const existing = safeSessionGet(CLIENT_ID_KEY);
  if (existing) {
    cachedClientId = existing; // Persisted reuse across reloads in THIS tab.
    return cachedClientId;
  }

  cachedClientId = generateClientId(); // Mint once per tab.
  safeSessionSet(CLIENT_ID_KEY, cachedClientId); // Persist per-tab; safe on failure.
  return cachedClientId;
}

/**
 * Persist the last-used name and emoji as Remembered_Defaults.
 *
 * The name is only written when truthy, so an empty/blank name never clobbers a
 * previously remembered value. The emoji is always written, coalescing a
 * nullish value to `''` so the stored default is well-defined (Req 6.1).
 *
 * Writes go through `safeLocalSet` and therefore never throw; a blocked or
 * full store simply leaves the defaults unpersisted for this session.
 *
 * @param {string} name - The display name to remember.
 * @param {string} [emoji] - The emoji to remember; `null`/`undefined` stored as ''.
 * @returns {void}
 */
export function saveDefaults(name, emoji) {
  if (name) safeLocalSet(LS_NAME, name); // Only persist a non-empty name (Req 6.1).
  safeLocalSet(LS_EMOJI, emoji ?? ''); // Always persist emoji, coalescing nullish to '' (Req 6.1).
}

/**
 * Load the Remembered_Defaults for pre-filling the join fields.
 *
 * Reads through `safeLocalGet`, which returns `null` when a key is absent or
 * storage is unavailable. Missing values fall back to an empty name and the
 * default (empty-string) emoji (Req 6.2, 6.3).
 *
 * @returns {{ name: string, emoji: string }} The remembered name and emoji.
 */
export function loadDefaults() {
  return {
    name: safeLocalGet(LS_NAME) || '', // Empty name when absent (Req 6.3).
    emoji: safeLocalGet(LS_EMOJI) || '', // Default (empty) emoji when absent (Req 6.3).
  };
}

/**
 * Determine whether a display name is joinable.
 *
 * A name is joinable iff it is a string containing at least one non-whitespace
 * character. Empty strings, whitespace-only strings, and non-string values
 * (null, undefined, numbers, etc.) are all rejected. This gates the Join
 * control and guards the Join click handler (Req 4.1, 4.2).
 *
 * @param {unknown} name - The candidate display name.
 * @returns {boolean} `true` if the name has a non-whitespace character.
 */
export function isJoinable(name) {
  return typeof name === 'string' && name.trim().length > 0;
}

/**
 * Build a socket payload for `room:create` / `room:join` / resume emits with a
 * guaranteed, stable `clientId` attached.
 *
 * Every create/join/resume emit is constructed through this single helper so
 * the durable per-browser identity (Req 5.3) is always present. Callers pass
 * the room/name/emoji/modKey fields (and any other per-emit data) via `extra`;
 * this keeps the helper pure and DOM-free — app-level state such as the current
 * room id is supplied by the caller rather than read here.
 *
 * `extra` may override any other field, but `clientId` is always sourced from
 * `getClientId()` and cannot be overridden: it is spread last so the returned
 * payload's `clientId` always equals `getClientId()`.
 *
 * @param {Object} [extra] - Additional payload fields (e.g. `{ roomId, name, emoji, modKey }`).
 * @returns {Object} A new payload object with `clientId` set to `getClientId()`.
 */
export function joinPayload(extra) {
  return { ...extra, clientId: getClientId() };
}
