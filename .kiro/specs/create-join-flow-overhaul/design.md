# Design Document

## Overview

FLAPS is a real-time collaborative story-point estimation tool built on a Node.js + Socket.IO
backend (`server.js`) and a vanilla JavaScript client (`public/app.js`). Today the create/join
lifecycle is spread across many independent client functions — `applyInitialRoleView`,
`updateRoombar`, `updateButtonStates`, `handleParticipantReconnection`, and the `room:created` /
`room:state` handlers — each toggling `hide`/`show`/`setDisabled` and reading ad hoc boolean flags
(`joinButtonClicked`, `userJoined`, `roomCreated`). The same visibility decision is duplicated in at
least four places with subtly different conditions, which is why the UI drifts out of sync across
refresh, disconnect, and reconnect.

This design introduces a single explicit client-side **Session_State_Machine** that is the sole
authority for the visibility and enabled state of every create/join control. All UI gating is
derived from the current `Session_State` through one pure function; the legacy flags are removed as
inputs to rendering. Client identity (`clientId`) stays per-tab in `sessionStorage` so each
tab/window is a distinct participant, while the remembered name/emoji defaults live in `localStorage`
so they persist across the browser. The server-side
create/join/disconnect/resume logic is consolidated around the stable `clientId` key while
**preserving** the disconnect grace-period and resume-on-reconnect behavior already delivered by the
`session-persistence-on-tab-inactive` spec.

### Design Goals

1. One source of truth: a `Session_State` drives all create/join control rendering.
2. Per-tab identity (`sessionStorage` `clientId`) so each tab/window is a distinct participant.
3. Join gated on a non-empty (non-whitespace) name.
4. Remembered name/emoji defaults pre-filled on fresh loads.
5. Refresh, disconnect, and reconnect converge on the same, correct UI.
6. No regression of the existing grace-period / quiet-reconnect behavior.

### Relationship to `session-persistence-on-tab-inactive`

That completed spec introduced, on the **server**, the stable `clientId` key (`getUserKey`), the
grace timer in `handleDisconnect` (`DISCONNECT_GRACE_MS`), the resume path in `handleRoomJoin`, and
`myId` in `makeRoomState`; and on the **client**, the minted `clientId`, the `visibilitychange` /
`pageshow` / `pagehide` lifecycle handlers, the removal of the forced 5s manual re-join, and the
suppression of repeated connection toasts. This design **reconciles rather than regresses** that
work:

- The server changes here are a **consolidation and documentation** of the already-shipped
  `clientId`/grace/resume behavior. Client identity stays in `sessionStorage` (per tab); only the
  remembered name/emoji defaults use `localStorage`. `getUserKey`, the grace timer, and role
  preservation are kept exactly as they behave today.
- The client changes replace the scattered flag-based gating with the Session_State_Machine while
  keeping the existing lifecycle handlers and the quiet-reconnect notification policy intact. The
  machine's `DISCONNECTED` and `RESUMING` states formalize the states those handlers already imply.

## Architecture

```
                          public/app.js (client)
  ┌───────────────────────────────────────────────────────────────────┐
  │  Identity (sessionStorage, per-tab) + Defaults (localStorage)       │
  │    getClientId()   loadDefaults()/saveDefaults()                    │
  ├───────────────────────────────────────────────────────────────────┤
  │  Session_State_Machine  (single source of truth)                   │
  │    state: INITIAL|CREATING|JOINING|JOINED|DISCONNECTED|RESUMING     │
  │    transition(state, event) -> state'                              │
  │    deriveControls(state, ctx) -> ControlConfig                     │
  │    subscribe(render)                                              │
  ├───────────────────────────────────────────────────────────────────┤
  │  render(controlConfig)  — the ONE place that calls hide/show/      │
  │                            setDisabled for create/join controls    │
  ├───────────────────────────────────────────────────────────────────┤
  │  Socket adapter: emits room:create / room:join (always w/clientId) │
  │  dispatches events into the machine (connect, disconnect,          │
  │  room:created, room:state, reconnect_attempt)                      │
  └───────────────────────────────────────────────────────────────────┘
                                   │  Socket.IO
                                   ▼
                          server.js (server)
  ┌───────────────────────────────────────────────────────────────────┐
  │  getUserKey(socket) = clientId ?? socket.id                        │
  │  handleRoomCreate / handleRoomJoin (resume vs first-join)          │
  │  handleDisconnect (grace timer, DISCONNECT_GRACE_MS)               │
  │  makeRoomState (exposes myId + per-user role)                      │
  └───────────────────────────────────────────────────────────────────┘
```

The machine is intentionally a small, pure core (`transition` and `deriveControls` are pure
functions) wrapped by a thin stateful holder that notifies a single `render` subscriber. This makes
the gating logic unit- and property-testable without a DOM.

## Components and Interfaces

### 1. Session_State_Machine (client, new)

The authoritative owner of create/join UI state. Pure transition and derivation functions plus a
thin holder.

```javascript
// The six states, and nothing else (Req 1.1).
const STATES = Object.freeze({
  INITIAL: 'INITIAL',
  CREATING: 'CREATING',
  JOINING: 'JOINING',
  JOINED: 'JOINED',
  DISCONNECTED: 'DISCONNECTED',
  RESUMING: 'RESUMING'
});

// Events the machine understands.
const EVENTS = Object.freeze({
  CREATE_CLICK: 'CREATE_CLICK',       // facilitator activates Create
  ROOM_CREATED: 'ROOM_CREATED',       // server room:created
  JOIN_CLICK: 'JOIN_CLICK',           // participant activates Join (name valid)
  ROOM_STATE: 'ROOM_STATE',           // server room:state (membership confirmed)
  SOCKET_DISCONNECT: 'SOCKET_DISCONNECT',
  RECONNECT_ATTEMPT: 'RECONNECT_ATTEMPT',
  BOOTSTRAP_RESUME: 'BOOTSTRAP_RESUME', // load with stored joined session
  BOOTSTRAP_FRESH: 'BOOTSTRAP_FRESH'    // load with no stored session
});

// Pure, total transition function. Unknown (state,event) pairs return the
// current state unchanged (no illegal jumps).
function transition(state, event) {
  switch (state) {
    case STATES.INITIAL:
      if (event === EVENTS.CREATE_CLICK) return STATES.CREATING;
      if (event === EVENTS.JOIN_CLICK)   return STATES.JOINING;
      if (event === EVENTS.BOOTSTRAP_RESUME) return STATES.RESUMING;
      return state;
    case STATES.CREATING:
      if (event === EVENTS.ROOM_CREATED) return STATES.JOINED;
      return state;
    case STATES.JOINING:
      if (event === EVENTS.ROOM_STATE)   return STATES.JOINED;
      return state;
    case STATES.JOINED:
      if (event === EVENTS.SOCKET_DISCONNECT) return STATES.DISCONNECTED;
      return state;
    case STATES.DISCONNECTED:
      if (event === EVENTS.RECONNECT_ATTEMPT) return STATES.RESUMING;
      if (event === EVENTS.ROOM_STATE)        return STATES.JOINED; // fast reconnect
      return state;
    case STATES.RESUMING:
      if (event === EVENTS.ROOM_STATE)        return STATES.JOINED;
      if (event === EVENTS.SOCKET_DISCONNECT) return STATES.DISCONNECTED;
      return state;
    default:
      return state;
  }
}
```

The thin holder owns the current state, the render context (role, whether a room is in the URL, and
whether the facilitator has a `modKey`), and notifies the single subscriber on every change:

```javascript
function createSessionMachine(initialState, initialCtx, render) {
  let state = initialState;
  let ctx = { ...initialCtx };            // { role, hasRoomInUrl, hasModKey }
  function apply() { render(deriveControls(state, ctx), state, ctx); }
  return {
    getState: () => state,
    setContext: (patch) => { ctx = { ...ctx, ...patch }; apply(); },
    dispatch: (event) => {
      const next = transition(state, event);
      if (next !== state) { state = next; }
      apply();                              // Req 1.3: one place updates all controls
    }
  };
}
```

### 2. Control derivation (client, new)

`deriveControls` is the single mapping from state to the visibility/enabled state of every
create/join control. Rendering reads only this output — never `joinButtonClicked`, `userJoined`, or
`roomCreated` (Req 1.4).

```javascript
// ctx.role is 'facilitator' | 'participant' | null (unknown until JOINED).
// Returns a fully specified config for every control (Req 1.2).
function deriveControls(state, ctx) {
  const preJoin = {           // INITIAL entry configuration (Req 1.5)
    create:   { visible: !ctx.hasRoomInUrl, enabled: true,  label: 'Create Room' },
    name:     { visible: true,              enabled: true }, // always shown pre-join (Req 2.5)
    join:     { visible: ctx.hasRoomInUrl,  enabled: false }, // gated by name (Req 4)
    emoji:    { visible: true,              enabled: true }  // always shown pre-join (Req 2.5)
  };
  const inSession = {         // JOINED / DISCONNECTED / RESUMING configuration
    create:   { visible: ctx.role === 'facilitator', enabled: true, label: 'Room Created' },
    name:     { visible: false, enabled: false },
    join:     { visible: false, enabled: false },
    emoji:    { visible: false, enabled: false },
    moderatorControls: ctx.role === 'facilitator'
  };
  switch (state) {
    case STATES.INITIAL:
      return preJoin;
    case STATES.CREATING:
      return { ...preJoin,
        create: { visible: true, enabled: false, label: 'Creating…' } }; // Req 2.2
    case STATES.JOINING:
      return { ...preJoin,
        name: { visible: true, enabled: false },     // Req 3.2
        join: { visible: true, enabled: false } };
    case STATES.JOINED:            // Req 2.4 (facilitator) / 3.4 (participant)
    case STATES.DISCONNECTED:      // Req 8.5 — keep in-session config, do not revert
    case STATES.RESUMING:          // Req 7.3 / 8.5 — name+join disabled, in-session config
      return inSession;
    default:
      return preJoin;
  }
}
```

Note: the moderator control gating that lives in `updateStoryFormVisibility` / `updateButtonStates`
continues to key off `state.youAreModerator` from the room state (Req 10.3); `deriveControls` only
owns the create/join entry controls plus the top-level `moderatorControls` flag.

### 3. Name gating (client, new)

```javascript
// Req 4.1 / 4.2: a name is joinable iff it has at least one non-whitespace char.
function isJoinable(name) {
  return typeof name === 'string' && name.trim().length > 0;
}
```

The name field's `input` listener calls `render` with `join.enabled = isJoinable(value)` while in a
join-eligible state (INITIAL/JOINING-eligible), so the Join button toggles live. The Join click
handler re-checks `isJoinable` and, if false, returns without dispatching `JOIN_CLICK` — leaving the
state unchanged (Req 4.3).

### 4. Identity and remembered defaults (client)

Client **identity is per-tab** (`sessionStorage`), while **remembered defaults are per-browser**
(`localStorage`). Per-tab identity ensures each tab/window is a distinct room participant: a
`localStorage` clientId is shared across all tabs of the same origin, which let a second user in the
same browser resume the first user's record and inherit their role/vote. `sessionStorage` still
survives reloads and tab-inactive/background lapses within the tab (what the persistence behavior
needs) while isolating separate tabs and full browser restarts (Req 5).

```javascript
const CLIENT_ID_KEY = 'flaps_client_id'; // sessionStorage — per tab
const LS_NAME = 'flaps_name';            // localStorage — per browser
const LS_EMOJI = 'flaps_emoji';          // localStorage — per browser

// Req 5: per-tab clientId in sessionStorage, minted once per tab, reused thereafter.
function getClientId() {
  if (cachedClientId) return cachedClientId;                 // in-tab in-memory reuse
  const existing = safeSessionGet(CLIENT_ID_KEY);
  if (existing) { cachedClientId = existing; return existing; } // per-tab persisted reuse
  cachedClientId = generateClientId();                        // mint once per tab
  safeSessionSet(CLIENT_ID_KEY, cachedClientId);              // persist per tab
  return cachedClientId;
}

// Req 6: remembered defaults round-trip through localStorage.
function saveDefaults(name, emoji) {                        // Req 6.1
  if (name) safeLocalSet(LS_NAME, name);
  safeLocalSet(LS_EMOJI, emoji ?? '');
}
function loadDefaults() {                                   // Req 6.2 / 6.3
  return { name: safeLocalGet(LS_NAME) || '', emoji: safeLocalGet(LS_EMOJI) || '' };
}
```

`safeLocalGet`/`safeLocalSet` (defaults) and `safeSessionGet`/`safeSessionSet` (identity) wrap their
respective stores in try/catch (quota/unavailable), so blocked storage never throws — identity falls
back to an in-memory id for the tab. Every `room:create` and `room:join` emit is built through one
payload helper that always attaches `getClientId()` (Req 5.3):

```javascript
function joinPayload(extra) {
  return { roomId: currentRoom, clientId: getClientId(), ...extra };
}
```

### 5. Bootstrap and socket wiring (client, refactor)

On load, the machine's initial state is chosen from stored session presence:

```javascript
// Req 7.1 / 7.4
const startEvent = hasStoredJoinedSession(currentRoom) ? EVENTS.BOOTSTRAP_RESUME
                                                       : EVENTS.BOOTSTRAP_FRESH;
```

`BOOTSTRAP_RESUME` moves the machine to `RESUMING` and, on `connect`, emits `room:join` with the
stored `clientId` (Req 7.1). Socket events map to dispatches:

| Socket event / trigger        | Machine event                          |
|-------------------------------|----------------------------------------|
| Create button click           | `CREATE_CLICK` + emit `room:create`    |
| `room:created`                | `ROOM_CREATED` (set role=facilitator)  |
| Join button click (valid name)| `JOIN_CLICK` + emit `room:join`        |
| first `room:state`            | `ROOM_STATE` (set role from state)     |
| `disconnect` (while JOINED)   | `SOCKET_DISCONNECT`                    |
| reconnect begins / foreground | `RECONNECT_ATTEMPT` + emit `room:join` |
| `room:state` after resume     | `ROOM_STATE`                           |

The existing quiet-reconnect policy is retained unchanged: `connect_error` logs to console only, and
`disconnect` shows a single `Disconnected` pill via `updateReconnectionStatus`. Because
`DISCONNECTED`/`RESUMING` both derive the in-session config, the main UI never reverts to the
pre-join controls during a transient lapse (Req 8.4, 8.5).

### 6. Server consolidation (server, keep existing behavior)

The server already implements the target behavior via `session-persistence-on-tab-inactive`. This
design documents it as the consolidated contract and makes no behavioral change beyond what that
spec shipped:

- `getUserKey(socket)` returns `socket.data.clientId || socket.id` (Req 9.1).
- `handleRoomJoin`: when `getUserKey` matches an existing record, resume it — cancel `graceTimer`,
  set `socketId`, `connected = true`, and preserve `isModerator` and `vote`
  (`existing.isModerator = existing.isModerator || isModerator(room, modKey)` never downgrades)
  (Req 9.2, 10.1, 10.2). When no record matches, create a new one with `isModerator(room, modKey)`
  (Req 9.3).
- `handleDisconnect`: mark `connected = false`, arm a `DISCONNECT_GRACE_MS` timer; on expiry without
  reconnect, delete the record and `broadcastRoom` (Req 9.4, 9.5).
- `makeRoomState`: expose `myId` (the `clientId`) and per-user `isModerator` (Req 9.6, 10.3).

## Data Models

### Client Session context

```javascript
// Held by the machine holder; drives deriveControls.
{
  state: 'INITIAL'|'CREATING'|'JOINING'|'JOINED'|'DISCONNECTED'|'RESUMING',
  role:  'facilitator'|'participant'|null,   // resolved from room:created / room:state
  hasRoomInUrl: boolean,                      // /room/:id present
  hasModKey: boolean                          // ?mod= present (facilitator deep link)
}
```

### Storage keys

| Key                | Store           | Value                        | Requirement |
|--------------------|-----------------|------------------------------|-------------|
| `flaps_client_id`  | sessionStorage  | per-tab UUID string          | 5.1–5.5     |
| `flaps_name`       | localStorage    | last-used display name       | 6.1–6.3     |
| `flaps_emoji`      | localStorage    | last-used emoji (or '')       | 6.1–6.3     |
| `flaps_joined_<ROOM>` | sessionStorage | `'true'` when joined        | 7.1, 7.4    |

### Server user record (unchanged)

```javascript
room.users[clientId] = {
  name, emoji, vote,
  isModerator,        // preserved on resume; never downgraded
  socketId,           // re-attached on each (re)connect
  connected,          // false during grace window
  disconnectedAt,
  graceTimer          // cleared on resume; fires removal on expiry
}
```

## Error Handling

- **Storage unavailable / quota exceeded**: `safeLocalGet`/`safeLocalSet` swallow errors and log a
  warning; the machine falls back to an in-memory `clientId` for the session and empty defaults, so
  the flow still works without persistence.
- **Empty/whitespace name on join**: the Join handler returns early (no dispatch, no emit), state
  unchanged (Req 4.3); the existing `showToast('Enter your name.')` message is retained.
- **Illegal transitions**: `transition` returns the current state for any unhandled `(state, event)`
  pair, so stray or duplicate events cannot corrupt the UI.
- **Transient connection lapse**: no error toast; a single `Disconnected` → `Reconnected` pill
  transition. Only a genuinely exhausted reconnect (`reconnect_failed`) escalates to a user-facing
  message (existing behavior retained).
- **Resume with omitted `modKey`**: server never downgrades an existing moderator record (Req 10.1).
- **Grace expiry**: record removed and room re-broadcast; a later reconnect is treated as a fresh
  join (existing behavior retained).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a
system — essentially, a formal statement about what the system should do. Properties serve as the
bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: State machine defines exactly the six states

For all members of the machine's state set, the set equals exactly `{INITIAL, CREATING, JOINING,
JOINED, DISCONNECTED, RESUMING}` — no more and no fewer.

**Validates: Requirements 1.1**

### Property 2: Control configuration is derived solely and deterministically from state

For any `Session_State` and render context, `deriveControls(state, ctx)` returns a fully specified
visibility/enabled configuration for the Create, Name, Join, and emoji controls, is a pure function
of `(state, ctx)` (equal inputs yield equal configs), and depends on no legacy flag.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 3: State-to-control mapping matches the specified configuration for every state

For any `Session_State` and role, `deriveControls` yields the specified control configuration:
`INITIAL` presents the pre-join configuration; `CREATING` disables Create; `JOINING` disables Name
and Join; `JOINED`, `DISCONNECTED`, and `RESUMING` keep the in-session configuration with Name and
Join hidden/disabled and never revert to the pre-join configuration, exposing moderator controls iff
the role is facilitator.

**Validates: Requirements 1.5, 2.2, 2.4, 3.2, 3.4, 7.3, 8.5**

### Property 4: The transition function is total and follows the specified transition table

For any `Session_State` and any event, `transition` returns a member of the state set (totality),
and the specified transitions hold: `INITIAL`+`CREATE_CLICK`→`CREATING`,
`CREATING`+`ROOM_CREATED`→`JOINED`, `INITIAL`+`JOIN_CLICK`→`JOINING`,
`JOINING`+`ROOM_STATE`→`JOINED`, `JOINED`+`SOCKET_DISCONNECT`→`DISCONNECTED`,
`DISCONNECTED`+`RECONNECT_ATTEMPT`→`RESUMING`, `RESUMING`+`ROOM_STATE`→`JOINED`; any unspecified
`(state, event)` pair leaves the state unchanged.

**Validates: Requirements 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2, 8.3**

### Property 5: Join is enabled exactly when the name has a non-whitespace character

For any string, `isJoinable` returns true iff the string contains at least one non-whitespace
character; consequently the Join control is enabled for such names and disabled for empty or
whitespace-only names.

**Validates: Requirements 4.1, 4.2**

### Property 6: Whitespace-only join attempts are rejected without changing state

For any empty or whitespace-only name, attempting to join performs no transition and emits no
`room:join`, leaving the `Session_State` unchanged.

**Validates: Requirements 4.3**

### Property 7: Client identity persists and is stable

For any initial storage condition, `getClientId` returns a non-empty identifier, persists it to
`sessionStorage` (per tab), and returns that same identifier on every subsequent call within and
across reloads of the tab (idempotence), minting a new one only when none exists.

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 8: Every create/join emit carries the stored clientId

For any create, join, or resume emit path, the emitted payload's `clientId` equals `getClientId()`.

**Validates: Requirements 5.3**

### Property 9: Remembered defaults round-trip

For any name and emoji pair, saving them as remembered defaults and then loading defaults returns
the same name and emoji, which are pre-filled into the Name and emoji controls on load.

**Validates: Requirements 6.1, 6.2**

### Property 10: Bootstrap selects the correct initial state and resumes when joined

For any load, when a stored joined session exists for the current room the machine enters `RESUMING`
and emits `room:join` carrying the stored `clientId`; when no stored joined session exists it enters
`INITIAL`.

**Validates: Requirements 7.1, 7.4**

### Property 11: Reconnect attempt re-emits a complete join payload

For any reconnect attempt from `DISCONNECTED`, the machine transitions to `RESUMING` and re-emits
`room:join` whose payload contains `clientId`, room, name, emoji, and `modKey`.

**Validates: Requirements 8.2**

### Property 12: Repeated connection errors are suppressed during a transient lapse

For any sequence of `connect_error`/`disconnect` events occurring while the session is
`DISCONNECTED` or `RESUMING`, no error toast is surfaced and the quiet status indicator is set at
most once.

**Validates: Requirements 8.4**

### Property 13: The server keys users by clientId with socket.id fallback

For any socket, `getUserKey` returns the `clientId` when one is present and the `socket.id`
otherwise.

**Validates: Requirements 9.1**

### Property 14: Resume preserves identity, role, and vote

For any existing user record, a `room:join` with a matching `clientId` re-attaches the current
`socketId`, marks the record connected, and preserves the existing role and vote; a facilitator
retains moderator status even when the reconnect omits the `modKey`, and a participant retains
participant status and prior vote while the voting phase still applies.

**Validates: Requirements 9.2, 10.1, 10.2**

### Property 15: First-time join creates a record with role resolved via isModerator

For any `room:join` whose `clientId` matches no existing record, the server creates a new connected
user record whose role equals `isModerator(room, modKey)`.

**Validates: Requirements 9.3**

### Property 16: Disconnect retains the record for the grace period, then removes it

For any joined user, a socket disconnect leaves the record present and marked disconnected with a
grace timer armed; if the grace period elapses without a reconnect, the record is removed and the
updated room state is broadcast.

**Validates: Requirements 9.4, 9.5**

### Property 17: Room state exposes stable identity and role, and the client renders by role

For any room and requesting socket, `makeRoomState` exposes the user's stable `clientId` (`myId`)
and each user's role; and for any room state the client renders moderator controls iff
`youAreModerator` is true, otherwise participant controls.

**Validates: Requirements 9.6, 10.3**

## Testing Strategy

### Dual approach

- **Property-based tests** (Vitest + fast-check, following the existing `server.pbt.test.js`
  pattern) cover the universal properties above. The machine's `transition`, `deriveControls`,
  `isJoinable`, identity, and defaults functions are pure, so they are tested directly without a DOM.
  Server properties reuse the existing harness that drives `handleRoomCreate`, `handleRoomJoin`, and
  `handleDisconnect` against in-memory `rooms`, using fake timers for grace-period timing.
- **Example/unit tests** cover the enumerated states (Property 1), the empty-defaults case (Req
  6.3), the fresh-vs-resume bootstrap (Req 7.4), and role rendering after resume (Req 10.3).

### Property test configuration

- Minimum 100 iterations per property test.
- Each property test references its design property with the tag:
  **Feature: create-join-flow-overhaul, Property {number}: {property_text}**.

### Generators

- **State**: element of the six-state set. **Event**: element of the `EVENTS` set.
- **Context**: `{ role ∈ {facilitator, participant, null}, hasRoomInUrl: bool, hasModKey: bool }`.
- **Name**: arbitrary strings, including all-whitespace strings (spaces, tabs, newlines) and strings
  with leading/trailing whitespace around content, to exercise Properties 5 and 6.
- **clientId / storage**: arbitrary UUID-like strings and empty/absent storage conditions.
- **Server records**: arbitrary user records (role, vote, connected) and reconnect payloads with and
  without `modKey`, plus disconnect/reconnect sequences within and beyond `DISCONNECT_GRACE_MS`.

### Preservation

Server-side properties (13–17) assert the existing `session-persistence-on-tab-inactive` behavior is
preserved: grace-period timing, resume role/vote preservation, and idle-room cleanup semantics are
unchanged. The existing `server.pbt.test.js` suite must continue to pass unmodified.

### Integration tests

- Facilitator create → auto-join → refresh restores `JOINED` with moderator controls.
- Participant join gated on name → `JOINED` → disconnect → quiet reconnect → `JOINED` with vote and
  role intact.
- Load with stored joined session enters `RESUMING` and resumes without manual re-join; load without
  it enters `INITIAL` with remembered defaults pre-filled.
