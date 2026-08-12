# Implementation Plan: Clear/Re-Vote a Finalized Story

## Overview

Build bottom-up, in the order the design layers things, so every layer is verifiable the moment it exists:

1. **Pure core** — `public/story-revote.js` holds the whole state transition (`REVOTE_REASONS`, `isFinalizedValue`, `normalizeStoryId`, `validateRevote`, `applyRevote`). Requirements 3, 4, 5, and 8 become executable property tests here with no socket, no `io`, and no timers.
2. **Server** — `handleStoryQueueRevote` is a thin I/O wrapper over the core (room lookup, moderator resolution, one broadcast, one ack), plus the `broadcastRoom` per-socket isolation fix.
3. **Client** — the shared finalized predicate, the Re-Vote control, and the chip-reset ordering fix, exercised through the existing jsdom harness (`fakeSocket.__trigger('room:state', state)` after `await import('./app.js')`).
4. **Delete on finalized cards** — two lines in the finalized branch of `createQueueActions`, two attribute lines plus `addKeyboardClickSupport` inside the shared `createDeleteButton`, and one test-only export line in `server.js`. `handleStoryQueueRemove` itself is not changed; Requirements 10 and 11 pin its existing contract under test.

Language: JavaScript (ES modules), matching the existing tree. Tests run with `npm test` (`vitest --run`), `fast-check@4`, and `jsdom` — all already in `package.json`.

All 38 correctness properties from the design get exactly one property-based test each, at ≥100 iterations, tagged `// Feature: clear-revote-finalized-story, Property N: <name>`. Properties 1–22 cover re-vote (Requirements 1 through 8); Properties 23–38 cover delete on finalized cards (Requirements 9 through 11), with the delete criteria that restate an already-universal claim folded into the Property 1 and Property 15 tests rather than duplicated.

## Tasks

- [x] 1. Build the pure re-vote core and its state-transition properties
  - [x] 1.1 Create `public/story-revote.js`
    - Export frozen `REVOTE_REASONS`: `NO_ROOM = 'Room not found'`, `NOT_MODERATOR = 'Not facilitator / moderator'` (character-identical to the `storyQueue:setActive` rejection), `NO_STORY = 'Story not found in queue'`, `NOT_FINALIZED = 'Story is not finalized'`, `NOT_APPLIED = 'Re-vote was not applied'`
    - Export `isFinalizedValue(value)` — false for `null`, `undefined`, `''`, whitespace-only
    - Export `normalizeStoryId(storyId)` — `''` for absent, `null`, non-string, empty, whitespace-only
    - Export `validateRevote(room, storyId, isFacilitator)` — ordered checks: room existence, facilitator, id validity, story existence, finalized status; first failure wins; checks 3 and 4 share `NO_STORY`
    - Export `applyRevote(room, storyId, { isFacilitator, now = Date.now() })` — snapshot, then `entry.finalPoints = null`, `activeStoryId = normalizedId`, `room.story = { number, title, finalPoints: null }` (exactly three fields), `phase = 'voting'`, every `room.users[uid].vote = null`, `lastActiveAt = now`; any throw restores the snapshot and returns `NOT_APPLIED`
    - No DOM, no `io`, no `rooms`, no timers, no filesystem — importable from both the browser and `server.js`
    - _Requirements: 1.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_

  - [x]* 1.2 Create `public/story-revote.pbt.test.js` with the shared generators
    - `arbitraryRoom`: 0–20 queue entries with unique ids, `number`/`title` from `fc.string()` including empty and unicode, `finalPoints` from `fc.oneof(fc.constant(null), fc.constantFrom('1','2','3','5','8','13'), whitespaceString())`
    - `activeStoryId`: `null`, an id in the queue, or an id not in the queue; `phase`: `fc.constantFrom('voting','revealed')`
    - `users`: 0–30 records with random `vote` (null and non-null) and random `connected` flags
    - Invalid story-id generator spanning `undefined`, `null`, `''`, whitespace strings, numbers, booleans, arrays, objects
    - Operation-sequence generator: 1–20 `{ kind: 'finalize' | 'revote', storyId, points }` steps with deliberately invalid steps mixed in
    - Shared by the seven property tests in this file (Properties 8, 10, 11, 12, 19, 20, 21)
    - _Requirements: 3.5, 4.4, 5.3, 8.8_

  - [x]* 1.3 Write property test for the accepted transition
    - **Property 8: The accepted transition clears exactly one estimate and resets the room**
    - Inject `now` so timestamp assertions are deterministic
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x]* 1.4 Write property test for rejected and failed requests
    - **Property 10: Rejected and failed requests leave the server exactly as it was**
    - Cover every rejection cause including a mutation that throws (frozen room) to reach the snapshot restore
    - **Validates: Requirements 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 5.7**

  - [x]* 1.5 Write property test for validation ordering
    - **Property 11: The first failing check determines the response**
    - **Validates: Requirements 4.7**

  - [x]* 1.6 Write property test for idempotence
    - **Property 12: Re-vote is idempotent**
    - **Validates: Requirements 4.6**

- [x] 2. Checkpoint - pure core green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Wire the re-vote handler into the server
  - [x] 3.1 Add `handleStoryQueueRevote` to `server.js`
    - Import `applyRevote` from `./public/story-revote.js`
    - `normalizeRoomId(roomId) || socket.data.roomId`, then `rooms.get(roomId)` — never `getOrCreateRoom` (Req 4.2)
    - Pass `isFacilitator: !!room && requireModerator(room, socket)` and `now: Date.now()`; no `checkRateLimit`, matching its siblings
    - On rejection: `ack({ ok: false, reason })` only, no broadcast, `lastActiveAt` untouched
    - On acceptance: exactly one `broadcastRoom(roomId)` after the mutation, then `ack({ ok: true })`
    - Register `socket.on("storyQueue:revote", (data, ack) => handleStoryQueueRevote(socket, data, ack));` in the `io.on("connection")` block beside `storyQueue:setActive`, and add `handleStoryQueueRevote` to the existing `export { ... }` block
    - _Requirements: 3.10, 3.12, 4.1, 4.2, 4.7, 4.8, 5.6, 7.1_

  - [x]* 3.2 Write property test for the broadcast in `revote-handler.pbt.test.js` (repo root, beside `server.exploration.test.js`)
    - **Property 9: One broadcast, sent after every state change, identical for every recipient**
    - Use the `makeSocket` fake-socket pattern plus a counting broadcast stub; no network, no real `io`
    - **Validates: Requirements 3.10, 5.6, 7.1**

- [x] 4. Apply the three incidental fixes the design identified as in scope
  - [x] 4.1 Isolate per-socket emits in `broadcastRoom` (design finding 6)
    - `broadcastRoom` currently wraps `fetchSockets()` and the whole emit loop in one `try`; move the per-socket `s.emit("room:state", makeRoomState(room, s))` into its own `try`/`catch` inside the loop so one failing socket cannot skip the rest
    - Log and continue; never roll back applied state
    - _Requirements: 7.5, 7.6_

  - [x] 4.2 Unify the finalized predicate in `public/app.js` (design finding 3)
    - Import `isFinalizedValue` and `normalizeStoryId` from `./story-revote.js`
    - Replace raw truthiness at all three render sites: `partitionStoryQueue` (`story.finalPoints`), `createQueueActions` (`if (story.finalPoints)`), `createQueueItemElement` (`activeStoryId === story.id && !story.finalPoints`)
    - Make the existing `hasFinalPoints(story)` delegate to `isFinalizedValue(story?.finalPoints)` so partitioning, the card action area, the active highlight, and the export summary all agree
    - _Requirements: 1.10, 6.1, 6.3, 6.8_

  - [x] 4.3 Reorder the chip-selection reset in `public/app.js` (design finding 7)
    - In the `room:state` handler, move `if (state.phase !== 'revealed' || !state.activeStoryId) selectedFinalPoint = null;` above the `renderAllComponents(state, canFinalize)` call so no chip renders selected on the post-re-vote broadcast
    - _Requirements: 6.5_

  - [x]* 4.4 Write property test for delivery failure in `revote-handler.pbt.test.js`
    - **Property 18: A failing delivery does not roll back state or starve other sockets**
    - 2–10 joined sockets, one whose `emit` throws
    - **Validates: Requirements 7.5, 7.6**

- [x] 5. Add the finalize/re-vote round-trip and persistence properties to `public/story-revote.pbt.test.js`
  - [x]* 5.1 Write property test for finalize/re-vote inversion
    - **Property 20: Finalize and re-vote are inverses**
    - Model finalize as the queue-entry write `handleStoryQueueFinalize` performs, with points values drawn from the finalize-control set
    - **Validates: Requirements 8.1, 8.2**

  - [x]* 5.2 Write property test for operation sequences
    - **Property 21: Finalize/re-vote sequences preserve the queue**
    - Drive the 1–20 step operation-sequence generator from task 1.2, including rejected steps; assert after every step
    - **Validates: Requirements 8.3, 8.4, 8.7, 8.8**

  - [x]* 5.3 Write property test for the persistence round trip
    - **Property 19: Persistence round trip preserves the re-voted story**
    - Serialize a re-voted room in the shape `.rooms-state.json` uses and restore it through the existing load path
    - **Validates: Requirements 7.7**

- [x] 6. Checkpoint - server layer green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add the Re-Vote control to the client
  - [x] 7.1 Implement `createRevoteButton` and `requestRevote` in `public/app.js`
    - `createRevoteButton(story)`: `button`, `type="button"`, `className = 'queueBtn queueRevoteBtn'`, text `"Re-Vote"`, `aria-label`/`title` `"Re-vote story"`, `dataset.storyId = story.id`, `disabled = false`, `onclick` calls `e.stopPropagation()` then `requestRevote(story.id)`, plus the existing `addKeyboardClickSupport(btn)` for Enter/Space
    - `requestRevote(storyId)`: guards in order id → room → connection, each returning before any emit with `showToast('Could not identify the story to re-vote' | 'Join a room first' | 'Not connected to server', 'error')`; otherwise `socket.emit('storyQueue:revote', { roomId: currentRoom, storyId: id }, res => { if (res && res.ok === false) showToast(res.reason || 'Re-vote failed', 'error'); })`
    - Insert `if (state.youAreModerator) actions.appendChild(createRevoteButton(story));` after the `queueFinalChip` append in the `createQueueActions` finalized early-return branch, before the `return actions`, so the facilitator's action area is `[pill, Re-Vote]` and the participant's is `[pill]`
    - Touch no DOM and no `lastState` on the success path — the queue changes only when the broadcast arrives
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 7.2 Add the `.queueBtn.queueRevoteBtn` rule to `public/styles.css`
    - One rule inheriting `.queueBtn` sizing, radius, focus ring, and hover; accent to match `.queueBtn.primary`; no new design tokens
    - _Requirements: 1.1, 1.5_

- [x] 8. Write the queue-render property tests in `public/revote-ui.pbt.test.js`
  - Drive the real client through the existing jsdom harness: inject `index.html`'s body, stub `io`, `await import('./app.js')`, then `fakeSocket.__trigger('room:state', state)` and assert on `#queuePendingList` / `#queueDoneList`
  - [x]* 8.1 Write property test for the finalized action area, covering both finalized controls
    - **Property 1: Finalized card action area is determined by viewer role**
    - Facilitator: exactly three elements in order — final estimate pill, then one enabled `button[type=button]` with text `❌` and accessible name "Delete story", then one enabled `button[type=button]` with text "Re-Vote" and accessible name "Re-vote story". Participant: the pill alone, zero Re-Vote controls, zero delete controls. No Vote or edit control on a finalized card for either role; pending cards keep their existing action set
    - Holds for a queue that has just had an entry deleted as well as for any other queue, which is what carries Requirement 11.3
    - Depends on tasks 13.1 and 13.2; extend this test's tag comment with the added requirement ids rather than adding a second Property 1 test
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.11, 1.12, 11.3**

  - [x]* 8.2 Write property test for control-to-story binding
    - **Property 2: One control per card, bound to its own story**
    - **Validates: Requirements 1.7**

  - [x]* 8.3 Write property test for role changes
    - **Property 3: Role change is reflected in the same render pass**
    - **Validates: Requirements 1.8**

  - [x]* 8.4 Write property test for blank final estimates
    - **Property 4: A blank final estimate is not a finalized story**
    - **Validates: Requirements 1.10**

  - [x]* 8.5 Write property test for the cleared story rendering as pending
    - **Property 13: A cleared story renders as pending on every client**
    - **Validates: Requirements 6.1, 7.2**

  - [x]* 8.6 Write property test for pending order and active highlight
    - **Property 14: Pending order and active highlight follow the active story**
    - **Validates: Requirements 6.2, 6.4, 6.9**

  - [x]* 8.7 Write property test for section counts, including post-delete queues
    - **Property 15: Section counts equal cards rendered**
    - Generate queues that have had an entry removed alongside untouched queues, so the same universal claim carries the post-delete Estimate Done count; extend this test's tag comment with the added requirement id rather than adding a second Property 15 test
    - **Validates: Requirements 6.3, 11.2**

  - [x]* 8.8 Write property test for re-finalizing after a re-vote
    - **Property 22: Re-finalizing after a re-vote returns the story to done with the newest value**
    - **Validates: Requirements 8.5, 8.6**

- [x] 9. Write the activation and voting-control property tests in `public/revote-ui.pbt.test.js`
  - Extend the fake socket's `emit` to capture the ack callback so rejection responses can be replayed
  - [x]* 9.1 Write property test for activation
    - **Property 5: Activation emits exactly one request for the activated card**
    - Cover pointer click, Enter, and Space
    - **Validates: Requirements 2.1, 2.2, 2.6**

  - [x]* 9.2 Write property test for guarded activations
    - **Property 6: Guarded activations emit nothing and change nothing**
    - **Validates: Requirements 2.3, 2.4, 2.8**

  - [x]* 9.3 Write property test for no optimistic update and retryability
    - **Property 7: No optimistic update, and a rejected request stays retryable**
    - **Validates: Requirements 2.5, 2.7**

  - [x]* 9.4 Write property test for reopened voting controls
    - **Property 16: A null final estimate reopens voting controls with nothing selected**
    - **Validates: Requirements 6.5, 6.6, 6.7, 6.10**

  - [x]* 9.5 Write property test for export totals
    - **Property 17: Export totals exclude re-voted stories**
    - **Validates: Requirements 6.8**

- [x] 10. Write the concrete unit tests in `public/revote-ui.unit.test.js`
  - [x]* 10.1 Assert each guard's toast string literally once
    - `"Join a room first"`, `"Not connected to server"`, `"Could not identify the story to re-vote"`
    - _Requirements: 2.3, 2.4, 2.8_

  - [x]* 10.2 Pin the five `REVOTE_REASONS` strings
    - `'Room not found'`, `'Not facilitator / moderator'`, `'Story not found in queue'`, `'Story is not finalized'`, `'Re-vote was not applied'`, keeping `NOT_MODERATOR` character-identical to the `storyQueue:setActive` rejection wording
    - _Requirements: 3.12, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 10.3 Smoke-test the synchronous post-re-vote render
    - One broadcast of post-re-vote state leaves both queue sections, the deck, and the finalize chips populated after the handler returns, with no further user action
    - _Requirements: 6.11_

- [x] 11. Write the integration tests in `revote-integration.test.js` (repo root)
  - [x]* 11.1 End-to-end example through the real handler
    - Finalize a story, re-vote it, assert the resulting `room:state` payload shows it pending and active with cleared votes and `phase === 'voting'`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10_

  - [x]* 11.2 Join and rejoin after a re-vote
    - A newly joining facilitator socket and a newly joining participant socket each receive the re-voted story as pending and active with no further request
    - _Requirements: 7.3_

  - [x]* 11.3 Debounced persistence after a re-vote
    - Against a temp state file, apply a re-vote, advance past the debounce window, and assert the on-disk snapshot holds `finalPoints: null` and the new `activeStoryId`
    - _Requirements: 7.4_

- [x] 12. Final checkpoint - full suite and regression guards
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm `public/app.unit.test.js`, `public/app.exploration.test.js`, `server.exploration.test.js`, and the existing `*.pbt.test.js` suites are at their pre-change status — the unified finalized predicate is the only edit to a shared client path and the per-socket `try` the only edit to shared server code
  - Confirm `public/repro-highlight.test.js` status is unchanged from before this feature (it is already failing on the current tree because it contradicts Requirement 6.9). Do not modify it; retiring or rewriting it is tracked separately
  - _Requirements: 1.10, 6.1, 6.3, 6.8, 7.6_

- [x] 13. Add the Delete control to finalized story cards
  - [x] 13.1 Append the delete control in the finalized branch of `createQueueActions` (`public/app.js`)
    - Inside the `isFinalizedValue(story.finalPoints)` early-return branch, after the `queueFinalChip` append and inside the existing `if (state.youAreModerator)` gate: `const rmBtn = createDeleteButton(story.id, currentRoom, socket); rmBtn.classList.add('queueIconBtn'); actions.appendChild(rmBtn);` before the `createRevoteButton(story)` append
    - Append order is the contract: facilitator action area is exactly `[pill, Delete, Re-Vote]`, participant's is exactly `[pill]`; the branch still returns immediately so no Vote or edit control reaches a finalized card
    - Consult no `activeStoryId` — a finalized active story gets both controls enabled like any other card
    - Add no confirmation prompt, no ack callback, no connectivity guard, and no room guard; reuse the existing builder rather than writing a second one
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.8, 1.9, 1.11, 1.12, 9.3, 9.5, 9.9_

  - [x] 13.2 Add the accessible name and keyboard activation inside `createDeleteButton` (`public/app.js`)
    - Add `rmBtn.setAttribute('aria-label', 'Delete story')` and `rmBtn.title = 'Delete story'` so the accessible name is "Delete story" instead of the bare `❌` emoji
    - Add `addKeyboardClickSupport(rmBtn)` before the `return` so Enter and Space are observable in jsdom; the helper calls `click()`, which runs the same single-emit `onclick`, so browser behavior is unchanged
    - Leave the class name, event name, payload fields, `stopPropagation()` call, and enabled state exactly as they are — both additions land on the shared path, so pending-card delete buttons gain the same accessible name and keyboard support with no functional change
    - _Requirements: 1.12, 9.2, 9.4, 9.5_

  - [x] 13.3 Export `handleStoryQueueRemove` and `handleStoryQueueFinalize` from `server.js` for tests
    - Add both names to the existing `export { ... }` block, the same test-only exposure `handleStoryQueueRevote` and `handleStoryQueueSetActive` already have
    - Change no code inside either handler — no validation, no ack, no rate limit — so the response set Requirements 10.7, 10.8, 10.9, and 10.12 specify is untouched
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 10.8, 10.9, 10.12_

  - [x]* 13.4 Extend the shared generators with delete steps and delete request payloads
    - In `public/story-revote.pbt.test.js`, widen the operation-sequence generator to `{ kind: 'finalize' | 'revote' | 'delete', storyId, points }`, drawing delete `storyId` from live ids *and* ids already removed earlier in the same sequence so repeat-delete idempotence and the emptied-queue case occur naturally
    - Carry the expected id set forward step by step — start from the pre-sequence set, subtract the id of each *accepted* delete, add nothing for a rejected one
    - Add a delete request payload generator: `roomId` from `fc.oneof(the target room id, that id with surrounding whitespace and mixed case, fc.constant(''), fc.constant(null), fc.constant(undefined), an id matching no room)`; `storyId` from the existing invalid-id generator plus live queue ids
    - Export the shared generators so `delete-finalized-handler.pbt.test.js` and `public/delete-finalized-ui.pbt.test.js` import them instead of redefining them
    - _Requirements: 10.2, 10.9, 10.10, 10.13, 10.14, 11.13_

- [x] 14. Write the delete handler property tests in `delete-finalized-handler.pbt.test.js` (repo root, beside `revote-handler.pbt.test.js`)
  - Drive the real `handleStoryQueueRemove` with the `makeSocket` fake-socket pattern and a counting broadcast stub; assert `lastActiveAt` as bounded monotonicity (`before <= after <= Date.now()` sampled around the call), since the handler calls `Date.now()` itself and is not changed
  - [x]* 14.1 Write property test for the accepted removal
    - **Property 27: An accepted delete removes exactly the requested entry**
    - Cover room ids needing whitespace trimming and case folding, and blank room ids falling back to the socket's joined room
    - **Validates: Requirements 10.1, 10.2, 10.5, 10.11**

  - [x]* 14.2 Write property test for the active-story slot
    - **Property 28: Deleting the active story clears the active slot, and deleting any other story leaves it alone**
    - Assert the biconditional in both directions so an inverted condition fails either way
    - **Validates: Requirements 10.3, 10.4**

  - [x]* 14.3 Write property test for one broadcast per processed delete at any rate
    - **Property 29: Exactly one broadcast per processed delete, issued after every state change, at any request rate**
    - 2–20 facilitator requests without advancing the clock; assert the state observed at each broadcast already reflects that request's removal
    - **Validates: Requirements 10.6, 10.12**

  - [x]* 14.4 Write property test for unauthorized and unresolvable deletes
    - **Property 30: Unauthorized and unresolvable deletes are total no-ops with no response**
    - Assert every room deep-equal including `lastActiveAt`, no room created, no broadcast, and no ack or error argument passed back
    - **Validates: Requirements 10.7, 10.8**

  - [x]* 14.5 Write property test for unmatched story ids
    - **Property 31: An unmatched story id leaves the queue untouched but still advances `lastActiveAt` and broadcasts once**
    - Include the repeat-of-an-accepted-delete case, which is exactly this path
    - **Validates: Requirements 10.9, 10.10**

  - [x]* 14.6 Write property test for mixed operation sequences
    - **Property 32: Finalize, re-vote, and delete sequences preserve the surviving ids and their order**
    - Drive the widened 1–20 step sequence generator from task 13.4, including rejected steps; assert after every step
    - **Validates: Requirements 10.13, 10.14**

  - [x]* 14.7 Write property test for per-recipient broadcast equality
    - **Property 36: One broadcast per socket after a delete, identical for every recipient**
    - 1–20 joined sockets; payloads deep-equal except the per-viewer facilitator flag and the recipient's own identity
    - **Validates: Requirements 11.6**

  - [x]* 14.8 Write property test for the post-delete persistence round trip
    - **Property 38: Persistence round trip preserves a delete**
    - Serialize a post-delete room in the shape `.rooms-state.json` uses and restore it through the existing load path
    - **Validates: Requirements 11.9**

- [x] 15. Write the delete UI property tests in `public/delete-finalized-ui.pbt.test.js`
  - Same jsdom harness as `public/revote-ui.pbt.test.js`: inject `index.html`'s body, stub `io`, `await import('./app.js')`, then `fakeSocket.__trigger('room:state', state)`; record every emitted event name and payload so disjointness and payload equality are assertable
  - [x]* 15.1 Write property test for delete activation
    - **Property 23: Delete activation emits exactly one request per activation, for its own card only**
    - 2–100 finalized entries with distinct ids, activation by pointer click, Enter, and Space, and 1–10 consecutive repeats; assert no ack argument, no propagation to the card, and that the control never becomes disabled
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.10**

  - [x]* 15.2 Write property test for pending/finalized path equivalence
    - **Property 24: The finalized delete control is the pending delete control**
    - Metamorphic: for the same story id and the same client state (connected or not, room id valid, empty, `null`, or absent), the finalized-card emission is deep-equal in event name and payload to the pending-card emission, with no validation, no guards, and no toast on either path
    - **Validates: Requirements 9.5, 9.9**

  - [x]* 15.3 Write property test for no optimistic removal
    - **Property 25: Delete activation changes nothing on the client until the broadcast**
    - Compare serialized `#queuePendingList` and `#queueDoneList` plus the stored room id and active story id before and after activation
    - **Validates: Requirements 9.6**

  - [x]* 15.4 Write property test for event disjointness
    - **Property 26: The two finalized controls emit disjoint events**
    - **Validates: Requirements 9.7, 9.8**

  - [x]* 15.5 Write property test for the post-delete render
    - **Property 33: A deleted story disappears from both sections and leaves the rest of the render alone**
    - Also assert that a non-active deletion leaves the Need Estimate cards, their order, its count, and the active highlight identical to their pre-delete values
    - **Validates: Requirements 11.1, 11.7, 11.11**

  - [x]* 15.6 Write property test for deleting the active story
    - **Property 34: Deleting the active story clears the active slot and the stored selections**
    - Seed a locally stored deck-card selection and a locally stored final-points chip selection, then broadcast `activeStoryId === null` with the Story_Placeholder
    - Assert both stored selections are discarded, no card carries the active highlight in either section, no user entry shows a cast-vote indicator, every deck card is rendered *disabled* with none selected — `activeStoryId === null` means there is no story left to vote on — and no final-points chip is selected. This is not the re-vote case: nothing is reopened
    - **Validates: Requirements 11.5, 11.12**

  - [x]* 15.7 Write property test for post-delete export totals
    - **Property 35: Export after a delete omits the deleted story and totals the rest**
    - **Validates: Requirements 11.4**

  - [x]* 15.8 Write property test for the emptied queue
    - **Property 37: Deleting the last entry renders the empty-queue placeholder**
    - **Validates: Requirements 11.13**

- [x] 16. Write the delete unit and integration tests
  - [x]* 16.1 Pin the finalized delete control's rendered attributes in `public/delete-finalized-ui.unit.test.js`
    - Assert once, literally: `tagName === 'BUTTON'`, `type === 'button'`, `textContent === '❌'`, `aria-label === 'Delete story'`, `classList` containing both `queueBtn` and `queueIconBtn`, and its position between the final pill and the Re-Vote control
    - Assert a `window.confirm` spy is never called during an activation
    - _Requirements: 1.11, 1.12, 9.3_

  - [x]* 16.2 End-to-end delete examples in `delete-finalized-integration.test.js` (repo root)
    - Finalize a story, delete it through the finalized-card path, assert the resulting `room:state` payload omits it, then delete the same id again and assert one further broadcast carrying the unchanged queue
    - Delete a finalized story that is also the active story, pinning the Story_Placeholder's literal `title` `"Add Story to Queue"`, `activeStoryId === null`, `phase === 'voting'`, and cleared votes in the broadcast payload
    - _Requirements: 10.1, 10.3, 10.10_

  - [x]* 16.3 Persistence and rejoin after a delete in `delete-finalized-integration.test.js`
    - Against a temp state file, delete a finalized story, advance past the debounce window, and assert the on-disk snapshot holds a queue without that entry and the updated `activeStoryId`
    - A newly joining facilitator socket and a newly joining participant socket each receive a queue with no entry carrying the removed id
    - _Requirements: 11.8, 11.10_

- [x] 17. Delete checkpoint - full suite and shared-path regression guards
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm the pending-card delete path is unchanged apart from the accessible name and keyboard support: its event name, payload fields, single-emit shape, classes, and enabled state must all still hold. Any existing test asserting the pending delete button's accessible name is the bare `❌`, or counting its listeners, is the one place a regression can surface
  - Confirm `server.js` behavior is unchanged — the only edit is the export line from task 13.3
  - Confirm `public/repro-highlight.test.js` status is still unchanged from before this feature
  - _Requirements: 1.11, 1.12, 9.2, 9.5, 9.9_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- **Status: the feature is complete. Every production-code task (1.1, 3.1, 4.1, 4.2, 4.3, 7.1, 7.2, 13.1, 13.2, 13.3) is on the tree, all four checkpoints (2, 6, 12, 17) are green, and no tasks remain outstanding.** `npm test` runs 25 files / 187 tests with 24 files / 186 tests passing; the single failure is the pre-existing `public/repro-highlight.test.js`, which contradicts Requirement 6.9 and was already failing before this feature. Retiring or rewriting it is tracked separately
- **All 38 of 38 correctness properties are implemented**, one property-based test each at ≥100 iterations. `public/revote-ui.pbt.test.js` now holds Properties 1, 2, 3, 4, 5, 6, 7, 13, 14, 15, 16, 17, and 22 — tasks 9.1 through 9.5 added Re-Vote activation (2.1, 2.2, 2.6), the activation guards (2.3, 2.4, 2.8), no-optimistic-update and retryability (2.5, 2.7), the reopened voting controls after a re-vote (6.5, 6.6, 6.7, 6.10), and export totals (6.8)
- Each implemented property is covered by exactly one property-based test at ≥100 iterations (`fc.assert(..., { numRuns: 100 })`), tagged `// Feature: clear-revote-finalized-story, Property N: <name>`; Properties 21 and 32 may run fewer iterations with larger sequences only with a recorded reason, never below 100 otherwise
- **Property 34 / Requirement 11.12 was corrected during implementation — the property tests caught a defect in the requirements, not in the code.** The original wording claimed deleting the active story *reopens the voting controls with nothing selected*. Writing that property produced a legitimate failure: deleting the active story leaves `activeStoryId === null`, so `renderAllComponents` computes `hasActiveStory === false` and `renderDeck` renders every card **disabled** — there is no story left to vote on. Requirement 11.12, design Property 34, and task 15.6 now read "Deleting the active story clears the active slot and the stored selections". This is the one place the delete work diverges from the re-vote case, where the re-voted story *becomes* the active story and the deck therefore stays enabled. The production code was not changed for this; the requirement was
- **Property 16 needs TWO broadcasts, not one.** `renderFinalPointsChips` derives `canFinalize` from `youAreModerator && phase === 'revealed' && hasActiveStory`, so the chip-enabled clause of Requirement 6.10 is only meaningful on a `revealed` broadcast. The deck-enabled clause is stated for `voting`, and `renderDeck` disables every card once the phase is `revealed`. No single broadcast can carry both clauses, so the test asserts each against its own broadcast
- **Cosmetic tidy-up left open:** the `Property 34` tag comment and `describe` title inside `public/delete-finalized-ui.pbt.test.js` still carry the superseded "reopens the voting controls" wording. Its assertions are correct and pin the disabled deck; only the wording is stale
- Properties 1 and 15 carry the delete criteria 1.11, 1.12, 11.3, and 11.2 inside their existing tests (tasks 8.1 and 8.7), whose tag comments gain the added requirement ids. No new test file duplicates them
- `fast-check` supplies the generators, shrinking, and reporting — no property-testing machinery is written from scratch
- The delete enhancement changes no server logic: task 13.3 adds two names to an export block, and `handleStoryQueueRemove` keeps its existing contract, including advancing `lastActiveAt` and broadcasting once for an id that matched nothing (Requirement 10.9). Tasks 14.1 through 14.8 pin that contract rather than change it
- The two additions inside `createDeleteButton` (task 13.2) land on the shared builder, so pending cards gain the same accessible name and keyboard support. That is intentional, label-and-listener only, and guarded by Property 24's metamorphic comparison of the two paths
- Requirements 7.4, 7.7, 11.8, and 11.9 need no new production code (existing `schedulePersist` and `loadPersistedRooms` already satisfy them); tasks 5.3, 11.3, 14.8, and 16.3 exist to prove that, not to change it
- Requirements 6.4, 6.6, and 6.7 likewise need no new production code — the existing `renderDeck`, `renderUsers`, and Vote-button logic already satisfy them once `finalPoints` is `null`; tasks 8.6 and 9.4 are the proof
- Edge cases (whitespace-only `finalPoints`, empty `number`/`title`, zero users, empty queue, non-string story ids, re-voting the already-active story, deleting the active story, deleting the last entry, deleting an already-removed id, room ids needing trimming or the socket fallback) are covered by the generators' range rather than dedicated tests
- Checkpoints at tasks 2, 6, 12, and 17 keep each layer verifiable before the next one lands

## Task Dependency Graph

No incomplete tasks remain, so there is nothing left to schedule.

```json
{
  "waves": [
    { "id": 0, "tasks": [] }
  ]
}
```
