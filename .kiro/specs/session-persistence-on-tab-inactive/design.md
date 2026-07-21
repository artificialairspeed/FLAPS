# Session Persistence on Tab Inactive Bugfix Design

## Overview

FLAPS is a real-time collaborative story-point estimation tool built on Socket.IO. Each connected
user is stored in `room.users` keyed by their **transient `socket.id`**, and identity, role
(facilitator/participant), and vote all hang off that key. When a browser backgrounds a tab, window,
or the whole app, it throttles timers and can suspend the WebSocket, so the Socket.IO heartbeat
lapses and the server sees a hard `disconnect`. Today `handleDisconnect` responds by immediately
running `delete room.users[socket.id]`, permanently discarding the user. When the browser wakes and
Socket.IO reconnects, it does so under a **brand new `socket.id`**, so the returning user is a
stranger to the room. The client compounds this: it shows a toast on every `connect_error` and
`disconnect`, and a hard 5-second `RECONNECTION_TIMEOUT_MS` fires `handleReconnectionFailure`, which
wipes session storage and forces a manual re-join that frequently fails to restore the prior role
and state.

The fix has two coordinated halves:

1. **Server** — introduce a **stable user identity** (`clientId`) that survives reconnects, and hold
   a disconnected user's session in a short **grace period** instead of deleting it immediately. A
   reconnect within the grace window re-attaches the existing session (role, vote, membership); only
   after the grace period elapses without a reconnect is the user actually removed.
2. **Client** — persist and resend the `clientId`, add tab/window/app lifecycle handling
   (`visibilitychange` / `pagehide` / `pageshow`), let Socket.IO's built-in reconnection run instead
   of forcing a manual re-join after 5 seconds, and suppress the repeated "Connection error" /
   "Disconnected" toasts while a transient reconnect is in flight.

The fix is scoped strictly to disconnect/reconnect and identity handling. Foreground activity,
intentional leaves, first-time create/join, in-session actions, and idle-room cleanup remain
untouched.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a user with an active session
  backgrounds the app, the socket heartbeat lapses, and the user returns intending to resume the
  same session (see `isBugCondition`).
- **Property (P)**: The desired behavior for buggy inputs — the session is preserved through the
  lapse and automatically restored on return (correct role, state, no manual re-join, no repeated
  error toasts).
- **Preservation**: Existing behavior that must remain unchanged for all non-buggy inputs —
  foreground activity, intentional leaves, first-time create/join, in-session actions, and
  idle-room cleanup.
- **`socket.id`**: Socket.IO's per-connection identifier. It is **transient** — a new value is
  assigned on every (re)connection. Current code uses it as the user key in `room.users`.
- **`clientId`**: A **stable** identifier minted once per browser session (persisted in
  `sessionStorage`) and re-sent on every connect. Introduced by this fix as the durable user key.
- **`handleDisconnect(socket)`**: Server handler in `server.js` that today immediately runs
  `delete room.users[socket.id]` on any disconnect.
- **`handleRoomJoin` / `handleRoomCreate`**: Server handlers in `server.js` that register a user
  into `room.users` and assign role via `isModerator(room, modKey)`.
- **Grace period**: A bounded interval (proposed 45 seconds) during which a disconnected user's
  session is retained and marked disconnected rather than deleted, allowing a reconnect to resume it.
- **`RECONNECTION_TIMEOUT_MS`**: Client constant (currently `5000`) that, on expiry, triggers
  `handleReconnectionFailure` and forces a manual re-join.
- **`ROOM_IDLE_TIMEOUT` / cleanup interval**: Server idle-room cleanup that deletes rooms that are
  both empty (`Object.keys(room.users).length === 0`) and idle beyond one hour.

## Bug Details

### Bug Condition

The bug manifests when a user who is an active member of a room backgrounds the app long enough for
the Socket.IO heartbeat to lapse, and then returns to resume the same session without having
intentionally left. The server-side `handleDisconnect` deletes the user on the transient `socket.id`
before the browser can reconnect, and because identity is keyed on `socket.id`, the reconnecting
browser cannot be recognized as the same user. The client, meanwhile, surfaces repeated connection
error toasts and then abandons automatic reconnection, forcing a manual re-join.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SessionEvent
  OUTPUT: boolean

  RETURN input.userHasActiveSession        // was a member of a live room
         AND input.wentInactive            // tab/window/app backgrounded
         AND input.connectionLapsed        // socket dropped due to heartbeat timeout
         AND input.userReturns             // user comes back to the app
         AND NOT input.userIntentionallyLeft
END FUNCTION
```

### Examples

- **Participant switches apps mid-vote**: A participant who has voted `5` switches to another app for
  40 seconds. Expected: on return they are still in the room as the same participant with their vote
  intact and no error toasts. Actual: they are removed from `room.users`, see multiple "Connection
  error" / "Disconnected" toasts, are forced to re-join, and reappear as a fresh participant with no
  vote (or fail to re-join at all).
- **Facilitator backgrounds the tab**: A facilitator backgrounds the browser tab for 30 seconds.
  Expected: on return they resume as facilitator with moderator controls. Actual: they are removed,
  and even after a forced re-join their moderator role/state is not reliably restored.
- **Phone locks during estimation**: A participant on mobile locks the phone for 20 seconds. Expected:
  on unlock the session resumes seamlessly. Actual: the socket suspended, the user was deleted, and
  they must re-join manually.
- **Edge case — brief network blip while foregrounded**: A foreground user's socket drops for 3
  seconds due to a Wi-Fi hiccup. Expected: silent auto-reconnect with no disruption (this behavior
  should improve alongside the fix and must not regress).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Foreground users with a healthy connection continue to receive real-time `room:state` broadcasts
  and full estimation functionality exactly as before (Requirement 3.1).
- A user who intentionally leaves (closes the tab/window or navigates away permanently) is still
  removed from the room (Requirement 3.2).
- Facilitators creating a room and participants joining for the first time still create/join with the
  correct role assignment via `isModerator(room, modKey)` (Requirement 3.3).
- Voting, revealing, clearing, queuing, activating, and finalizing stories while connected still
  process and broadcast updated room state correctly (Requirement 3.4).
- A room that has been empty and idle beyond `ROOM_IDLE_TIMEOUT` is still cleaned up (Requirement 3.5).

**Scope:**
All inputs where `isBugCondition` is false must be completely unaffected by this fix. This includes:
- Foreground interactions with a healthy connection.
- Intentional leaves (true page unload / navigation away).
- First-time room creation and joining.
- In-session moderator and participant actions.
- Idle-room cleanup timing and semantics.

**Note:** The expected correct behavior for buggy inputs is defined in the Correctness Properties
section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description and codebase inspection, the defect is the combination of the following:

1. **Immediate deletion on disconnect (server)**: `handleDisconnect` runs
   `delete room.users[socket.id]` synchronously on any disconnect, including transient
   background-induced heartbeat lapses. There is no grace period distinguishing a temporary lapse
   from an intentional leave.

2. **Identity keyed on transient `socket.id` (server)**: `room.users` is keyed by `socket.id`, and
   `makeRoomState` returns `mySocketId: socket.id`. A reconnecting browser receives a new `socket.id`,
   so even if the session were retained it could not be matched back to the returning user. There is
   no durable identity to reconcile against.

3. **Forced manual re-join after a fixed timeout (client)**: `handleParticipantReconnection` and the
   join flow arm a `RECONNECTION_TIMEOUT_MS` (5s) timer that calls `handleReconnectionFailure`, which
   clears session storage and reverts the UI to a manual-join state — cutting off Socket.IO's own
   reconnection before backgrounded sockets have a chance to resume.

4. **Noisy, unthrottled connection notifications (client)**: `connect_error` and `disconnect`
   handlers unconditionally call `showToast`, so a single transient lapse (which may emit several
   retry events) produces repeated "Connection error. Retrying..." and "Disconnected from server"
   toasts.

5. **No tab/window/app lifecycle awareness (client)**: There are no `visibilitychange`, `pagehide`,
   or `pageshow` handlers, so the client cannot proactively prepare for backgrounding or promptly
   re-establish the session on return, and it cannot distinguish backgrounding from a real unload.

## Correctness Properties

Property 1: Bug Condition - Seamless Session Persistence on Return

_For any_ input where the bug condition holds (`isBugCondition` returns true), the fixed system SHALL
preserve the user's session through the connection lapse and, on the user's return, automatically
restore it such that `sessionRestored = true`, `roleRestored = priorRole`,
`requiredManualRejoin = false`, `repeatedConnectionErrorsShown = false`, and
`canContinueInSameSession = true` — i.e., the returning user resumes the same room under their prior
role (facilitator/participant) with current session state (active story, voting phase, and their own
vote where still applicable) and no repeated connection error notifications.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Non-Backgrounding Behavior Unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed
system SHALL produce the same observable result as the original system, preserving foreground
real-time updates and estimation, removal of intentionally-leaving users, first-time create/join role
assignment, in-session action processing and broadcasts, and idle-room cleanup.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct, the fix spans the server and the client.

**File**: `server.js`

**Functions**: `handleRoomCreate`, `handleRoomJoin`, `handleDisconnect`, `makeRoomState`, connection
handler, room cleanup.

**Specific Changes**:
1. **Introduce stable `clientId` identity**: Accept a `clientId` on `room:create` and `room:join`
   payloads. Key `room.users` by `clientId` instead of `socket.id`. Track the current live
   `socket.id` as a field on the user record (e.g., `user.socketId`) for targeted emits, and store
   `socket.data.clientId`. `makeRoomState` returns the user's `clientId` as the identity marker (e.g.,
   `myId`) instead of `mySocketId`.

2. **Grace period on disconnect**: In `handleDisconnect`, do NOT immediately delete the user. Instead
   mark the user record disconnected (e.g., `user.connected = false`, `user.disconnectedAt = now`) and
   arm a per-user grace timer (proposed `DISCONNECT_GRACE_MS = 45s`). If the timer elapses without a
   reconnect, delete the user (`delete room.users[clientId]`), update `lastActiveAt`, and broadcast.

3. **Resume on reconnect within grace**: In `handleRoomJoin` (and the facilitator auto-rejoin path),
   when an incoming `clientId` matches an existing (possibly disconnected) user record, cancel any
   pending grace timer, re-attach the new `socket.id`, mark `connected = true`, preserve the existing
   role and `vote`, `socket.join(roomId)`, and broadcast the restored state. Role is still resolved
   through `isModerator(room, modKey)` so facilitators retain moderator status via their `modKey`.

4. **Preserve first-time join semantics**: When no matching `clientId` exists, behavior is identical
   to today — a new user record is created with role from `isModerator`. No change to create/join for
   first-time users beyond carrying the `clientId`.

5. **Keep idle cleanup intact**: The empty-and-idle cleanup logic is unchanged. Because the grace
   window (45s) is far shorter than `ROOM_IDLE_TIMEOUT` (1 hour), grace-held sessions do not alter
   cleanup outcomes; a room that truly empties (all users' grace periods elapse) still becomes empty
   and is cleaned up on the same schedule.

**File**: `public/app.js`

**Functions**: `connect` / `connect_error` / `disconnect` handlers,
`handleParticipantReconnection`, `handleReconnectionFailure`, session-storage helpers, plus new
lifecycle handlers.

**Specific Changes**:
1. **Mint and persist `clientId`**: On first load, generate a stable `clientId` (e.g.,
   `crypto.randomUUID()`), store it in `sessionStorage`, and include it in every `room:create` and
   `room:join` emit (foreground join, facilitator auto-rejoin, and `handleParticipantReconnection`).

2. **Add tab/window/app lifecycle handling**: Register `visibilitychange`, `pagehide`, and `pageshow`
   listeners. On return to foreground (`visibilitychange` → visible / `pageshow`), if the socket is
   disconnected, trigger an immediate reconnect/rejoin using the stored `clientId`. Use `pagehide`
   with `event.persisted`/unload semantics to distinguish a real unload (intentional leave) from a
   background suspension so preservation of intentional-leave behavior is maintained.

3. **Stop forcing manual re-join on transient lapses**: Remove/relax the hard
   `RECONNECTION_TIMEOUT_MS` path that calls `handleReconnectionFailure` and clears session storage.
   Let Socket.IO's built-in reconnection run; only fall back to manual re-join after reconnection has
   genuinely failed for an extended, clearly-unrecoverable period (and never merely because the tab
   was backgrounded).

4. **Suppress repeated connection notifications during transient reconnects**: Gate the
   `connect_error` and `disconnect` toasts so that transient, auto-recovering lapses do not surface
   repeated "Connection error" / "Disconnected" toasts. Track a "reconnecting" state; show at most a
   single quiet status indication (e.g., the `Disconnected`/`Reconnected` pill via
   `updateReconnectionStatus`) and only escalate to a toast if recovery ultimately fails.

5. **Automatic restoration on reconnect**: On `connect`, re-emit `room:join` with the stored
   `clientId`, room, name, emoji, and `modKey`; the server resumes the existing session and the
   subsequent `room:state` restores role, phase, active story, and the user's own vote in the UI with
   no manual action required.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate
the bug on the unfixed code, then verify the fix satisfies Property 1 (Fix Checking) and preserves
all non-buggy behavior per Property 2 (Preservation Checking).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or
refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate a member's disconnect followed by a reconnect under a new
`socket.id`, and assert that the session is retained and restored with the prior role and state. Run
these against the UNFIXED server/client to observe failures and confirm root cause.

**Test Cases**:
1. **Immediate deletion on disconnect**: Add a user via `handleRoomJoin`, fire `disconnect`, and
   assert the user still exists in `room.users`. (Will fail on unfixed code — `delete room.users[socket.id]` runs immediately.)
2. **Identity survives reconnect**: Join, disconnect, then join again with a new `socket.id` but the
   same identity, and assert it maps to the same user record with the same role and vote. (Will fail
   on unfixed code — identity is keyed on `socket.id`, so it is treated as a new user.)
3. **Role restoration for facilitator**: Facilitator disconnects and reconnects; assert
   `youAreModerator` remains true and moderator controls return. (Will fail on unfixed code.)
4. **No forced manual re-join / no repeated toasts (client)**: Simulate a backgrounding-induced
   disconnect and assert that `handleReconnectionFailure` is not invoked and connection toasts are not
   shown repeatedly. (Will fail on unfixed code — 5s timer clears session and toasts fire per event.)
5. **Edge case — vote preservation**: Participant votes, disconnects, reconnects within grace; assert
   the prior vote is still present. (Will fail on unfixed code.)

**Expected Counterexamples**:
- The user is absent from `room.users` immediately after `disconnect`.
- A reconnected user appears as a new participant with no role/vote.
- Possible causes: immediate `delete room.users[socket.id]`, `socket.id`-keyed identity, client 5s
  forced re-join, unthrottled toasts.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed system produces the
expected behavior (Property 1).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedSystem(input)
  ASSERT result.sessionRestored = true
     AND result.roleRestored = input.priorRole
     AND result.requiredManualRejoin = false
     AND result.repeatedConnectionErrorsShown = false
     AND result.canContinueInSameSession = true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed system produces
the same result as the original system (Property 2).

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalSystem(input) = fixedSystem(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many `SessionEvent` inputs automatically across the input domain (foreground actions,
  intentional leaves, first-time joins, in-session actions, idle timing).
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for non-backgrounding scenarios, then write
property-based tests capturing that behavior and assert equivalence after the fix.

**Test Cases**:
1. **Foreground real-time updates**: Observe that connected users receive `room:state` on every
   action on unfixed code; assert this continues after the fix.
2. **Intentional leave removal**: Observe that a true unload/navigation removes the user; assert the
   user is still removed after the fix (grace period expires with no reconnect, or explicit-leave path
   removes promptly).
3. **First-time create/join role assignment**: Observe correct facilitator/participant assignment via
   `isModerator`; assert unchanged after the fix (with `clientId` carried through).
4. **In-session actions**: Observe vote/reveal/clear/queue/activate/finalize broadcasts on unfixed
   code; assert identical broadcasts after the fix.
5. **Idle-room cleanup**: Observe empty-and-idle rooms are deleted after `ROOM_IDLE_TIMEOUT`; assert
   unchanged timing/semantics after the fix.

### Unit Tests

- Server: `handleDisconnect` marks disconnected and arms a grace timer instead of deleting; grace
  expiry deletes and broadcasts.
- Server: `handleRoomJoin` with an existing `clientId` resumes the session (role, vote, membership)
  and cancels the grace timer; with a new `clientId` creates a fresh user (unchanged behavior).
- Server: `makeRoomState` exposes stable identity (`clientId`) and role correctly for both
  facilitator and participant.
- Client: `clientId` is minted once and reused; reconnect re-emits `room:join` with it.
- Client: transient `disconnect`/`connect_error` do not produce repeated toasts; genuine failure does.

### Property-Based Tests

- Generate random room states and disconnect/reconnect sequences within the grace window and verify
  the session is always restored with the correct role and vote (Property 1).
- Generate random non-buggy `SessionEvent`s (foreground actions, first-time joins, intentional
  leaves, in-session actions, idle timings) and verify fixed-vs-original equivalence (Property 2).
- Generate random moderator/participant configurations and verify role assignment is preserved on
  both first join and resume.

### Integration Tests

- Full flow: participant joins, votes, backgrounds the tab past the heartbeat, returns within grace,
  and resumes with vote and role intact and no error toasts.
- Full flow: facilitator backgrounds and returns, retaining moderator controls and active-story state.
- Context/timing: user backgrounds past the grace window without returning and is removed; a later
  reconnect is treated as a fresh join.
- Visual feedback: the connection pill reflects `Disconnected` → `Reconnected` transitions without
  spamming toasts, and the main UI stays intact across the lapse.
