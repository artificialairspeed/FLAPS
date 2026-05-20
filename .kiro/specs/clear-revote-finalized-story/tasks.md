# Implementation Plan: Clear / Revote Finalized Story

## Overview

Minimal surgical change to the `vote:clear` handler in `server.js` to null out `finalPoints` on both the active story and its queue entry when a revote is triggered. No new events, no client changes, no schema changes.

## Tasks

- [x] 1. Extend `vote:clear` handler in `server.js` to clear `finalPoints`
  - In the `vote:clear` socket handler, after setting `room.phase = "voting"` and clearing votes, add a guard: if `room.activeStoryId` is set and `room.story.finalPoints` is non-null, set `room.story.finalPoints = null` and find the matching entry in `room.storyQueue` by `room.activeStoryId` and set its `finalPoints = null`
  - The queue find should be a no-op if the entry is not found (consistent with existing defensive patterns)
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.1 Write property test for vote:clear nullifying finalPoints (Property 1)
    - **Property 1: Clear / Revote nullifies finalPoints on both active story and queue entry**
    - **Validates: Requirements 1.1, 1.2**
    - Use `fast-check` with an arbitrary room where the active story has a non-null `finalPoints`; after calling the extracted `handleVoteClear` logic, assert both `room.story.finalPoints === null` and the matching queue entry's `finalPoints === null`

  - [ ]* 1.2 Write property test for vote:clear always resetting votes and phase (Property 2)
    - **Property 2: Clear / Revote always resets votes and phase**
    - **Validates: Requirements 1.3, 1.4**
    - Use `fast-check` with an arbitrary room (finalized or not); after calling `handleVoteClear`, assert `room.phase === "voting"` and every user's `vote === null`

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Verify client rendering already handles null finalPoints correctly
  - Confirm `renderStory` in `public/app.js` does not render a `.pointsBadge` when `story.finalPoints` is null (no code change needed — this is a read-only verification step that produces a test)
  - Confirm `renderQueue` renders `"Final: —"` when a queue entry's `finalPoints` is null (no code change needed)
  - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 3.1 Write property test for renderStory with null finalPoints (Property 3)
    - **Property 3: Rendering null finalPoints shows no badge and "Final: —"**
    - **Validates: Requirements 2.1, 2.2**
    - Use `fast-check` with arbitrary story objects where `finalPoints = null`; call `renderStory` and assert no `.pointsBadge` element exists in the DOM output
    - Also test arbitrary queue entries with `finalPoints = null` through `renderQueue` and assert the text contains `"Final: —"`

  - [ ]* 3.2 Write property test for canFinalize controls (Property 4)
    - **Property 4: Finalize controls are enabled exactly when moderator + revealed + active story**
    - **Validates: Requirements 3.1**
    - Use `fast-check` with arbitrary combinations of `youAreModerator`, `phase`, and `activeStoryId`; apply state and assert `finalizeEstimateBtn.disabled === !(youAreModerator && phase === "revealed" && !!activeStoryId)`

- [x] 4. Write unit tests covering specific examples and edge cases
  - `vote:clear` on a room with a finalized active story → `room.story.finalPoints` is `null`
  - `vote:clear` on a room with a finalized active story → matching queue entry `finalPoints` is `null`
  - `vote:clear` on a room with no finalized story → `room.story.finalPoints` remains `null` (no regression)
  - `vote:clear` on a room with no active story → no error, phase and votes still reset
  - `renderStory` with `finalPoints = null` → no `.pointsBadge` element in output
  - `renderQueue` with a queue entry where `finalPoints = null` → text contains `"Final: —"`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2_

  - [ ]* 4.1 Write property test for clear-then-finalize round-trip (Property 5)
    - **Property 5: Clear then finalize round-trip stores the new value**
    - **Validates: Requirements 3.2**
    - Use `fast-check` with an arbitrary finalized room and a new points value from the deck; call `handleVoteClear`, `handleVoteReveal`, then `handleFinalize` with the new value; assert `room.story.finalPoints === newPoints` and the queue entry's `finalPoints === newPoints`

- [x] 5. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The only production code change is a ~3 line addition to the `vote:clear` handler in `server.js`
- Client rendering (`renderStory`, `renderQueue`, `renderDeck`, finalize controls) already handles `null finalPoints` correctly — no client changes required
- Property tests require extracting the `vote:clear` mutation logic into a testable pure function or using a test harness that can invoke the handler directly
