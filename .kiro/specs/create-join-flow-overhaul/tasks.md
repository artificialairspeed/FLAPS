# Implementation Plan: Create/Join Flow Overhaul

## Overview

Introduce a single client-side `Session_State_Machine` as the sole source of truth for all
create/join UI, migrate durable identity and remembered defaults from `sessionStorage` to
`localStorage`, gate Join on a non-empty name, and consolidate/verify the server-side
create/join/disconnect/resume logic without regressing the `session-persistence-on-tab-inactive`
behavior.

The pure client logic (`transition`, `deriveControls`, `isJoinable`, identity/defaults helpers) is
extracted into small ES modules so it is unit- and property-testable without a DOM, then wired into
`public/app.js`. Property-based tests use Vitest + fast-check following the existing
`server.pbt.test.js` pattern (minimum 100 iterations), each tagged
**Feature: create-join-flow-overhaul, Property {n}**. The existing `server.pbt.test.js` suite must
continue to pass unmodified.

## Tasks

- [x] 1. Client state machine core (new module `public/session-machine.js`)
  - [x] 1.1 Implement `STATES`, `EVENTS`, and the pure `transition(state, event)` function
    - Define the frozen six-state set `INITIAL/CREATING/JOINING/JOINED/DISCONNECTED/RESUMING` and the `EVENTS` set
    - Implement `transition` as a total function that returns the current state for any unhandled `(state, event)` pair
    - Export all symbols as ES module exports
    - _Requirements: 1.1, 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2, 8.3_

  - [x]* 1.2 Property test for `transition`
    - **Property 4: The transition function is total and follows the specified transition table**
    - **Validates: Requirements 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2, 8.3**
    - Tag: `Feature: create-join-flow-overhaul, Property 4`; generate arbitrary state/event pairs, assert totality and each specified edge

  - [x]* 1.3 Test the state set enumeration
    - **Property 1: State machine defines exactly the six states**
    - **Validates: Requirements 1.1**
    - Tag: `Feature: create-join-flow-overhaul, Property 1`; example test asserting `STATES` equals exactly the six values

  - [x] 1.4 Implement `createSessionMachine(initialState, initialCtx, render)` holder
    - Hold current state + context `{ role, hasRoomInUrl, hasModKey }`, expose `getState`, `setContext`, `dispatch`
    - `dispatch` applies `transition` and invokes the single `render` subscriber on every change (one place updates all controls)
    - _Requirements: 1.3_

- [x] 2. Control derivation (in `public/session-machine.js`)
  - [x] 2.1 Implement pure `deriveControls(state, ctx)`
    - Return a fully specified visibility/enabled config for Create, Name, Join, emoji controls plus `moderatorControls`
    - Map `INITIAL`→pre-join, `CREATING`→Create disabled, `JOINING`→Name+Join disabled, `JOINED/DISCONNECTED/RESUMING`→in-session config
    - Read only `(state, ctx)`; never `joinButtonClicked`, `userJoined`, or `roomCreated`
    - _Requirements: 1.2, 1.4, 1.5, 2.2, 2.4, 3.2, 3.4, 7.3, 8.5_

  - [x]* 2.2 Property test `deriveControls` determinism/purity
    - **Property 2: Control configuration is derived solely and deterministically from state**
    - **Validates: Requirements 1.2, 1.3, 1.4**
    - Tag: `Feature: create-join-flow-overhaul, Property 2`; equal inputs yield equal fully-specified configs

  - [x]* 2.3 Property test state-to-control mapping
    - **Property 3: State-to-control mapping matches the specified configuration for every state**
    - **Validates: Requirements 1.5, 2.2, 2.4, 3.2, 3.4, 7.3, 8.5**
    - Tag: `Feature: create-join-flow-overhaul, Property 3`; assert per-state config and that in-session states never revert to pre-join, exposing moderator controls iff role is facilitator

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Identity, defaults, and name gating (new module `public/session-identity.js`)
  - [x] 4.1 Implement `safeLocalGet`/`safeLocalSet` wrappers and `getClientId()`
    - try/catch around `localStorage` (quota/unavailable), warn and fall back to in-memory id
    - Mint a stable `clientId` once, persist to `localStorage`, reuse in-memory and across loads
    - _Requirements: 5.1, 5.2, 5.4_

  - [x]* 4.2 Property test client identity persistence
    - **Property 7: Client identity persists and is stable**
    - **Validates: Requirements 5.1, 5.2, 5.4**
    - Tag: `Feature: create-join-flow-overhaul, Property 7`; over arbitrary initial storage conditions, `getClientId` is non-empty, persisted, and idempotent

  - [x] 4.3 Implement `saveDefaults(name, emoji)` / `loadDefaults()`
    - Persist last-used name/emoji to `localStorage`; load returns empty name and default emoji when absent
    - _Requirements: 6.1, 6.2, 6.3_

  - [x]* 4.4 Property test remembered defaults round-trip
    - **Property 9: Remembered defaults round-trip**
    - **Validates: Requirements 6.1, 6.2**
    - Tag: `Feature: create-join-flow-overhaul, Property 9`; save then load returns the same name/emoji pair

  - [x] 4.5 Implement `isJoinable(name)`
    - True iff the value is a string with at least one non-whitespace character
    - _Requirements: 4.1, 4.2_

  - [x]* 4.6 Property test name gating
    - **Property 5: Join is enabled exactly when the name has a non-whitespace character**
    - **Validates: Requirements 4.1, 4.2**
    - Tag: `Feature: create-join-flow-overhaul, Property 5`; generate arbitrary/whitespace strings and assert `isJoinable` result

  - [x] 4.7 Implement `joinPayload(extra)` helper
    - Build every `room:create`/`room:join`/resume payload through one helper that always attaches `getClientId()`
    - _Requirements: 5.3_

  - [x]* 4.8 Property test emit payload carries clientId
    - **Property 8: Every create/join emit carries the stored clientId**
    - **Validates: Requirements 5.3**
    - Tag: `Feature: create-join-flow-overhaul, Property 8`; for arbitrary extra fields, `joinPayload(...).clientId === getClientId()`

- [x] 5. Client wiring in `public/app.js`
  - [x] 5.1 Implement the single `render(controlConfig, state, ctx)` subscriber
    - The one place that calls `hide`/`show`/`setDisabled` for create/join controls, driven by `deriveControls`
    - Remove `joinButtonClicked`/`userJoined`/`roomCreated` as rendering inputs; replace scattered gating in `applyInitialRoleView`/`updateRoombar`/`updateButtonStates`/`handleParticipantReconnection`
    - _Requirements: 1.3, 1.4_

  - [x] 5.2 Wire Name field `input` listener and Join click guard
    - On input, re-render with `join.enabled = isJoinable(value)` while in a join-eligible state
    - Join click re-checks `isJoinable`; if false, return without dispatching `JOIN_CLICK` (state unchanged, keep existing "Enter your name." toast)
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 5.3 Property test whitespace-only join rejection
    - **Property 6: Whitespace-only join attempts are rejected without changing state**
    - **Validates: Requirements 4.3**
    - Tag: `Feature: create-join-flow-overhaul, Property 6`; for empty/whitespace names, no transition and no `room:join` emit

  - [x] 5.4 Wire socket events to machine dispatches and create/join emits
    - Create click→`CREATE_CLICK` + emit `room:create`; `room:created`→`ROOM_CREATED` (role=facilitator)
    - Join click→`JOIN_CLICK` + emit `room:join`; first `room:state`→`ROOM_STATE` (role from state)
    - `disconnect`→`SOCKET_DISCONNECT`; reconnect/foreground→`RECONNECT_ATTEMPT` + re-emit `room:join` via `joinPayload` with room, name, emoji, `modKey`
    - Retain quiet-reconnect policy (single `Disconnected` pill, no repeated error toasts)
    - _Requirements: 2.1, 2.3, 3.1, 3.3, 8.1, 8.2, 8.4, 8.5_

  - [x] 5.5 Implement bootstrap: initial state selection + defaults prefill
    - Choose `BOOTSTRAP_RESUME` vs `BOOTSTRAP_FRESH` from `hasStoredJoinedSession(currentRoom)`; on resume emit `room:join` with stored `clientId`
    - Pre-fill Name/emoji from `loadDefaults()`; save defaults on successful join
    - _Requirements: 5.3, 6.1, 6.2, 6.3, 7.1, 7.4_

  - [x]* 5.6 Property test bootstrap initial state selection
    - **Property 10: Bootstrap selects the correct initial state and resumes when joined**
    - **Validates: Requirements 7.1, 7.4**
    - Tag: `Feature: create-join-flow-overhaul, Property 10`; stored joined session→`RESUMING` + `room:join` with clientId; otherwise→`INITIAL`

  - [x]* 5.7 Property test reconnect re-emits complete payload
    - **Property 11: Reconnect attempt re-emits a complete join payload**
    - **Validates: Requirements 8.2**
    - Tag: `Feature: create-join-flow-overhaul, Property 11`; from `DISCONNECTED`, transition to `RESUMING` and re-emit `room:join` containing clientId, room, name, emoji, modKey

  - [x]* 5.8 Property test quiet reconnect suppression
    - **Property 12: Repeated connection errors are suppressed during a transient lapse**
    - **Validates: Requirements 8.4**
    - Tag: `Feature: create-join-flow-overhaul, Property 12`; for any sequence of `connect_error`/`disconnect` while `DISCONNECTED`/`RESUMING`, no error toast and status indicator set at most once

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Server consolidation (`server.js`, preserve existing behavior)
  - [x] 7.1 Consolidate/verify `getUserKey` and `makeRoomState`
    - `getUserKey(socket)` returns `clientId ?? socket.id`; `makeRoomState` exposes `myId` (clientId) and per-user `isModerator`
    - _Requirements: 9.1, 9.6, 10.3_

  - [x]* 7.2 Property test key resolution
    - **Property 13: The server keys users by clientId with socket.id fallback**
    - **Validates: Requirements 9.1**
    - Tag: `Feature: create-join-flow-overhaul, Property 13`; with/without clientId, `getUserKey` resolves correctly

  - [x]* 7.3 Property test room state exposes identity/role and client renders by role
    - **Property 17: Room state exposes stable identity and role, and the client renders by role**
    - **Validates: Requirements 9.6, 10.3**
    - Tag: `Feature: create-join-flow-overhaul, Property 17`; `makeRoomState` exposes `myId` + per-user role; client renders moderator controls iff `youAreModerator`

  - [x] 7.4 Verify/consolidate `handleRoomJoin` resume vs first-join
    - Matching `clientId`: cancel grace timer, re-attach `socketId`, `connected=true`, preserve role/vote, never downgrade moderator when `modKey` omitted
    - No match: create record with role `isModerator(room, modKey)`
    - _Requirements: 9.2, 9.3, 10.1, 10.2_

  - [x]* 7.5 Property test resume preservation
    - **Property 14: Resume preserves identity, role, and vote**
    - **Validates: Requirements 9.2, 10.1, 10.2**
    - Tag: `Feature: create-join-flow-overhaul, Property 14`; matching-clientId resume re-attaches socket, keeps role/vote, retains moderator without modKey

  - [x]* 7.6 Property test first-time join record creation
    - **Property 15: First-time join creates a record with role resolved via isModerator**
    - **Validates: Requirements 9.3**
    - Tag: `Feature: create-join-flow-overhaul, Property 15`; unmatched clientId creates a connected record whose role equals `isModerator(room, modKey)`

  - [x] 7.7 Verify/consolidate `handleDisconnect` grace timer
    - Mark `connected=false`, arm `DISCONNECT_GRACE_MS` timer; on expiry without reconnect delete record and `broadcastRoom`
    - _Requirements: 9.4, 9.5_

  - [x]* 7.8 Property test disconnect grace retention and removal
    - **Property 16: Disconnect retains the record for the grace period, then removes it**
    - **Validates: Requirements 9.4, 9.5**
    - Tag: `Feature: create-join-flow-overhaul, Property 16`; use fake timers to assert retention during grace and removal + broadcast on expiry

- [x] 8. Integration and regression
  - [x]* 8.1 Write integration tests for the end-to-end flows
    - Facilitator create→auto-join→refresh restores `JOINED` with moderator controls
    - Participant join gated on name→`JOINED`→disconnect→quiet reconnect→`JOINED` with vote/role intact
    - Load with stored joined session enters `RESUMING`; load without it enters `INITIAL` with defaults pre-filled
    - _Requirements: 2.4, 3.4, 7.1, 7.4, 8.5, 10.3_

  - [x] 8.2 Run the full suite and confirm no regression
    - Run `npm test` and ensure the existing `server.pbt.test.js` suite passes unmodified alongside the new tests
    - _Requirements: 9.2, 9.4, 9.5, 10.1, 10.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each task references specific requirements for traceability; each property test references its
  design property number and the requirements it validates.
- All property tests run a minimum of 100 iterations and carry the tag
  `Feature: create-join-flow-overhaul, Property {n}`, following the `server.pbt.test.js` pattern.
- The pure client logic lives in `public/session-machine.js` and `public/session-identity.js` so it
  is testable without a DOM; `public/app.js` only wires modules to the socket and DOM.
- Server tasks are consolidation/verification of already-shipped `session-persistence-on-tab-inactive`
  behavior; the existing suite must continue to pass unmodified.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "7.1"] },
    { "id": 1, "tasks": ["1.4", "4.3", "7.4", "1.2", "4.2", "7.2"] },
    { "id": 2, "tasks": ["2.1", "4.5", "7.7", "1.3", "4.4", "7.3"] },
    { "id": 3, "tasks": ["4.7", "2.2", "4.6", "7.5", "5.1"] },
    { "id": 4, "tasks": ["2.3", "4.8", "7.6", "5.2"] },
    { "id": 5, "tasks": ["7.8", "5.4", "5.3"] },
    { "id": 6, "tasks": ["5.5", "5.7"] },
    { "id": 7, "tasks": ["5.6", "8.1"] },
    { "id": 8, "tasks": ["5.8", "8.2"] }
  ]
}
```
