# Implementation Plan

## Overview

This plan fixes session loss when a user backgrounds the FLAPS app (tab/window/app) and returns to an active session. It follows the exploratory bugfix methodology: write bug-condition tests that FAIL on unfixed code (Property 1), capture preservation baselines that PASS on unfixed code (Property 2), apply the coordinated server + client fix (stable `clientId` identity, disconnect grace period, resume-on-reconnect, plus client lifecycle handling, relaxed forced re-join, and suppressed repeated toasts), then verify Fix Checking and Preservation Checking hold. Tasks reference requirements from `bugfix.md` and correctness properties from `design.md`.

## Tasks

- [x] 1. Write bug condition exploration tests (BEFORE implementing the fix)
  - **Property 1: Bug Condition** - Seamless Session Persistence on Return
  - **CRITICAL**: These tests MUST FAIL on the unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the tests or the code when they fail** at this stage
  - **NOTE**: These tests encode the Expected Behavior (Property 1) and will validate the fix once they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug and confirm the hypothesized root cause (immediate `delete room.users[socket.id]`, `socket.id`-keyed identity, client 5s forced re-join, unthrottled toasts)
  - **Scoped PBT Approach**: Because the bug is deterministic, scope the property to concrete failing cases (a member disconnects, then reconnects under a new `socket.id`), then generalize across roles/votes
  - Encode `isBugCondition(input)`: `userHasActiveSession AND wentInactive AND connectionLapsed AND userReturns AND NOT userIntentionallyLeft`
  - Test cases (from design Exploratory Bug Condition Checking):
    - Immediate deletion on disconnect: add a user via `handleRoomJoin`, fire `disconnect`, assert the user still exists in `room.users` (fails on unfixed code — deletion is immediate)
    - Identity survives reconnect: join, disconnect, then join again under a new `socket.id` with the same identity; assert it maps to the same user record with the same role and vote (fails — identity keyed on `socket.id`)
    - Role restoration for facilitator: facilitator disconnects and reconnects; assert `youAreModerator`/moderator controls return (fails on unfixed code)
    - No forced manual re-join / no repeated toasts (client): simulate a backgrounding-induced disconnect; assert `handleReconnectionFailure` is NOT invoked and connection toasts are not shown repeatedly (fails — 5s timer clears session, toasts fire per event)
    - Vote preservation (edge case): participant votes, disconnects, reconnects within grace; assert the prior vote is still present (fails on unfixed code)
  - Assertions match Property 1: `sessionRestored = true`, `roleRestored = priorRole`, `requiredManualRejoin = false`, `repeatedConnectionErrorsShown = false`, `canContinueInSameSession = true`
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "user absent from `room.users` immediately after `disconnect`"; "reconnected user appears as a new participant with no role/vote")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Write preservation property tests (BEFORE implementing the fix)
  - **Property 2: Preservation** - Non-Backgrounding Behavior Unchanged
  - **IMPORTANT**: Follow the observation-first methodology
  - Encode `NOT isBugCondition(input)`: foreground actions, intentional leaves, first-time create/join, in-session actions, and idle timing
  - Observe behavior on UNFIXED code and record the actual outputs, then assert equivalence (`originalSystem(input) = fixedSystem(input)`) across the input domain
  - Property-based testing is recommended here — it generates many non-buggy `SessionEvent` inputs and provides strong guarantees that behavior is unchanged
  - Test cases (from design Preservation Checking):
    - Foreground real-time updates: connected users receive `room:state` on every action; assert continues after the fix (Requirement 3.1)
    - Intentional leave removal: a true unload/navigation removes the user; assert still removed after the fix (Requirement 3.2)
    - First-time create/join role assignment: correct facilitator/participant assignment via `isModerator(room, modKey)`; assert unchanged with `clientId` carried through (Requirement 3.3)
    - In-session actions: vote/reveal/clear/queue/activate/finalize broadcasts; assert identical broadcasts after the fix (Requirement 3.4)
    - Idle-room cleanup: empty-and-idle rooms deleted after `ROOM_IDLE_TIMEOUT`; assert unchanged timing/semantics after the fix (Requirement 3.5)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for session loss on tab/window/app inactivity

  - [x] 3.1 Introduce stable `clientId` identity on the server
    - Accept a `clientId` on `room:create` and `room:join` payloads and store `socket.data.clientId`
    - Key `room.users` by `clientId` instead of the transient `socket.id`
    - Track the current live `socket.id` as a field on the user record (e.g., `user.socketId`) for targeted emits
    - Update `makeRoomState` to return the user's stable identity (e.g., `myId = clientId`) instead of `mySocketId`
    - _Bug_Condition: isBugCondition(input) — active member goes inactive, connection lapses, and returns_
    - _Expected_Behavior: expectedBehavior(result) — identity survives reconnect so the returning user is recognized_
    - _Preservation: First-time create/join role assignment via isModerator unchanged (3.3); in-session broadcasts unchanged (3.4)_
    - _Requirements: 2.3, 2.4, 3.3, 3.4_

  - [x] 3.2 Add disconnect grace period on the server
    - In `handleDisconnect`, do NOT immediately `delete room.users[...]`
    - Mark the user record disconnected (e.g., `user.connected = false`, `user.disconnectedAt = now`) and arm a per-user grace timer (`DISCONNECT_GRACE_MS = 45s`)
    - On grace expiry without reconnect, delete the user (`delete room.users[clientId]`), update `lastActiveAt`, and broadcast
    - _Bug_Condition: isBugCondition(input) — transient heartbeat lapse from backgrounding_
    - _Expected_Behavior: expectedBehavior(result) — session preserved through the lapse (sessionRestored = true)_
    - _Preservation: Intentional-leave removal still occurs (grace expiry with no reconnect) (3.2); idle cleanup intact (3.5)_
    - _Requirements: 2.1, 3.2, 3.5_

  - [x] 3.3 Resume the session on reconnect within the grace window
    - In `handleRoomJoin` (and the facilitator auto-rejoin path), when an incoming `clientId` matches an existing (possibly disconnected) user record: cancel any pending grace timer, re-attach the new `socket.id`, set `connected = true`, preserve the existing role and `vote`, `socket.join(roomId)`, and broadcast the restored state
    - Resolve role through `isModerator(room, modKey)` so facilitators retain moderator status via their `modKey`
    - Preserve first-time join semantics: when no matching `clientId` exists, create a new user record with role from `isModerator` exactly as today (only difference is carrying the `clientId`)
    - Keep idle cleanup intact: grace window (45s) is far shorter than `ROOM_IDLE_TIMEOUT` (1 hour), so grace-held sessions do not alter cleanup outcomes
    - _Bug_Condition: isBugCondition(input) — user returns within the grace window intending to resume_
    - _Expected_Behavior: expectedBehavior(result) — roleRestored = priorRole, vote/state preserved, canContinueInSameSession = true_
    - _Preservation: First-time create/join unchanged (3.3); in-session actions/broadcasts unchanged (3.4); idle cleanup unchanged (3.5)_
    - _Requirements: 2.3, 2.4, 2.5, 3.3, 3.4, 3.5_

  - [x] 3.4 Mint, persist, and resend `clientId` on the client
    - On first load, generate a stable `clientId` (e.g., `crypto.randomUUID()`) and store it in `sessionStorage`
    - Include the `clientId` in every `room:create` and `room:join` emit (foreground join, facilitator auto-rejoin, and `handleParticipantReconnection`)
    - On `connect`, re-emit `room:join` with the stored `clientId`, room, name, emoji, and `modKey` so the server resumes the existing session and the subsequent `room:state` restores role, phase, active story, and the user's own vote — no manual action required
    - _Bug_Condition: isBugCondition(input) — user returns and the client must re-identify_
    - _Expected_Behavior: expectedBehavior(result) — automatic restoration (requiredManualRejoin = false), state restored in the UI_
    - _Preservation: First-time create/join role assignment unchanged with clientId carried through (3.3)_
    - _Requirements: 2.3, 2.4, 2.5, 3.3_

  - [x] 3.5 Add tab/window/app lifecycle handling and relax forced re-join on the client
    - Register `visibilitychange`, `pagehide`, and `pageshow` listeners
    - On return to foreground (`visibilitychange` → visible / `pageshow`): if the socket is disconnected, trigger an immediate reconnect/rejoin using the stored `clientId`
    - Use `pagehide` with `event.persisted`/unload semantics to distinguish a real unload (intentional leave) from a background suspension, preserving intentional-leave behavior
    - Remove/relax the hard `RECONNECTION_TIMEOUT_MS` (5s) path that calls `handleReconnectionFailure` and clears session storage; let Socket.IO's built-in reconnection run and only fall back to manual re-join after genuinely unrecoverable failure (never merely because the tab was backgrounded)
    - _Bug_Condition: isBugCondition(input) — backgrounding must not trigger forced re-join_
    - _Expected_Behavior: expectedBehavior(result) — requiredManualRejoin = false; seamless resume on return_
    - _Preservation: Intentional leaves still remove the user (3.2); foreground real-time behavior unchanged (3.1)_
    - _Requirements: 2.1, 2.3, 2.5, 3.1, 3.2_

  - [x] 3.6 Suppress repeated connection notifications during transient reconnects (client)
    - Gate the `connect_error` and `disconnect` toasts so transient, auto-recovering lapses do not surface repeated "Connection error" / "Disconnected" toasts
    - Track a "reconnecting" state; show at most a single quiet status indication (e.g., the `Disconnected`/`Reconnected` pill via `updateReconnectionStatus`) and only escalate to a toast if recovery ultimately fails
    - _Bug_Condition: isBugCondition(input) — a single lapse may emit several retry events_
    - _Expected_Behavior: expectedBehavior(result) — repeatedConnectionErrorsShown = false_
    - _Preservation: Genuine, unrecoverable failures still surface a notification (does not suppress real errors)_
    - _Requirements: 2.2_

  - [x] 3.7 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Seamless Session Persistence on Return
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the Expected Behavior; when they pass they confirm the expected behavior is satisfied
    - Run the bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms `sessionRestored = true`, `roleRestored = priorRole`, `requiredManualRejoin = false`, `repeatedConnectionErrorsShown = false`, `canContinueInSameSession = true`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Backgrounding Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — foreground updates, intentional-leave removal, first-time create/join, in-session broadcasts, and idle cleanup all unchanged)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Add supporting unit tests
  - Server: `handleDisconnect` marks the user disconnected and arms a grace timer instead of deleting; grace expiry deletes and broadcasts
  - Server: `handleRoomJoin` with an existing `clientId` resumes the session (role, vote, membership) and cancels the grace timer; with a new `clientId` creates a fresh user (unchanged behavior)
  - Server: `makeRoomState` exposes stable identity (`clientId`) and role correctly for both facilitator and participant
  - Client: `clientId` is minted once and reused; reconnect re-emits `room:join` with it
  - Client: transient `disconnect`/`connect_error` do not produce repeated toasts; a genuine failure does
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3_

- [x] 5. Add property-based tests (Fix Checking and Preservation Checking)
  - **Property 1: Fix Checking** - Generate random room states and disconnect/reconnect sequences within the grace window; verify the session is always restored with the correct role and vote (`FOR ALL input WHERE isBugCondition(input)`)
  - **Property 2: Preservation Checking** - Generate random non-buggy `SessionEvent`s (foreground actions, first-time joins, intentional leaves, in-session actions, idle timings); verify fixed-vs-original equivalence (`FOR ALL input WHERE NOT isBugCondition(input): originalSystem(input) = fixedSystem(input)`)
  - Generate random moderator/participant configurations and verify role assignment is preserved on both first join and resume
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Add integration tests
  - Full flow: participant joins, votes, backgrounds the tab past the heartbeat, returns within grace, and resumes with vote and role intact and no error toasts
  - Full flow: facilitator backgrounds and returns, retaining moderator controls and active-story state
  - Context/timing: user backgrounds past the grace window without returning and is removed; a later reconnect is treated as a fresh join
  - Visual feedback: the connection pill reflects `Disconnected` → `Reconnected` transitions without spamming toasts, and the main UI stays intact across the lapse
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.2_

- [x] 7. Checkpoint - Ensure all tests pass
  - Run the full test suite (exploration, preservation, unit, property-based, integration)
  - Confirm Property 1 (Fix Checking) and Property 2 (Preservation Checking) both hold
  - Ensure all tests pass; ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2"],
      "description": "Pre-fix tests: bug condition exploration tests (must FAIL on unfixed code) and preservation property tests (must PASS on unfixed code). Independent of each other."
    },
    {
      "wave": 2,
      "tasks": ["3.1"],
      "description": "Server: introduce stable clientId identity keyed in room.users and update makeRoomState. Depends on pre-fix tests being in place."
    },
    {
      "wave": 3,
      "tasks": ["3.2"],
      "description": "Server: disconnect grace period (mark disconnected + arm grace timer). Depends on clientId identity."
    },
    {
      "wave": 4,
      "tasks": ["3.3"],
      "description": "Server: resume session on reconnect within grace; preserve first-time join and idle cleanup. Depends on grace period."
    },
    {
      "wave": 5,
      "tasks": ["3.4"],
      "description": "Client: mint/persist/resend clientId and auto-restore on connect. Depends on server resume support."
    },
    {
      "wave": 6,
      "tasks": ["3.5", "3.6"],
      "description": "Client: lifecycle handling + relax forced re-join, and suppress repeated connection toasts. Depend on clientId being sent."
    },
    {
      "wave": 7,
      "tasks": ["3.7", "3.8"],
      "description": "Verify bug condition tests now PASS (Fix Checking) and preservation tests still PASS (no regressions)."
    },
    {
      "wave": 8,
      "tasks": ["4", "5", "6"],
      "description": "Supporting unit tests, property-based tests (Fix + Preservation Checking), and integration tests."
    },
    {
      "wave": 9,
      "tasks": ["7"],
      "description": "Checkpoint: ensure the full test suite passes and both properties hold."
    }
  ]
}
```

## Notes

- Tasks 1 and 2 MUST be completed before any implementation (task 3). Task 1 tests must FAIL on the unfixed code; task 2 tests must PASS on the unfixed code.
- `DISCONNECT_GRACE_MS` is proposed at 45s (far shorter than `ROOM_IDLE_TIMEOUT` of 1 hour) so grace-held sessions do not affect idle cleanup.
- Property 1 (Bug Condition / Fix Checking) is validated by the same tests written in task 1 and re-run in task 3.7 — do not write new tests there.
- Property 2 (Preservation) is validated by the same tests written in task 2 and re-run in task 3.8 — do not write new tests there.
- The fix is scoped strictly to disconnect/reconnect and identity handling; all inputs where `isBugCondition` is false must remain unaffected.
