# Implementation Plan: Codebase Optimization

## Overview

Incremental optimization of the FLAPS codebase across security, performance, code quality, and maintainability. Tasks are ordered so each step builds on the previous, with shared modules extracted first before dependent changes are made.

## Tasks

- [-] 1. Extract shared rendering module (`public/render.js`)
  - [-] 1.1 Create `public/render.js` exporting `normalizeUrl`, `escapeHtml`, `renderStory`, and `renderQueueEntry` as named ES module exports
    - Copy the four functions verbatim from `public/app.js` as the authoritative source
    - _Requirements: 5.1_
  - [ ] 1.2 Write property test for `normalizeUrl` round-trip
    - **Property: For any valid HTTP/HTTPS URL string, `normalizeUrl` returns a URL that starts with `http://` or `https://`**
    - **Validates: Requirements 12.4**
  - [ ] 1.3 Update `public/app.js` to import `normalizeUrl`, `escapeHtml`, `renderStory`, and `renderQueueEntry` from `./render.js` and remove the inline definitions
    - _Requirements: 5.1_
  - [ ] 1.4 Update `server.unit.test.js` to import `renderStory`, `renderQueueEntry`, and `normalizeUrl` from `./public/render.js` and remove the inline copies
    - _Requirements: 5.2_
  - [ ] 1.5 Update `public/app.property.test.js` to import `renderStory`, `renderQueueEntry`, and `normalizeUrl` from `./render.js` and remove the inline copies
    - _Requirements: 5.3_

- [ ] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Fix Vitest environment configuration
  - [ ] 3.1 Update `vitest.config.js` to add an `environmentMatchGlobs` rule assigning `jsdom` to `public/**/*.test.js` files while keeping `server.unit.test.js` under `node`
    - _Requirements: 10.1, 10.3_
  - [ ] 3.2 Remove manual `JSDOM` construction from `public/app.property.test.js` now that the `jsdom` environment provides `document` directly
    - _Requirements: 10.2_
  - [ ] 3.3 Verify the full test suite passes under the new environment config
    - _Requirements: 10.4_

- [ ] 4. Remove debug logging from production client code
  - [ ] 4.1 Delete all `console.log` calls in `public/app.js` that use `[DEBUG]` prefixes or log internal state objects (the two `[DEBUG]` blocks in the `room:state` handler)
    - Retain `console.error` and `console.warn` calls
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ] 4.2 Fix Socket.IO debug logging: wrap the `localStorage.debug` assignment so it only runs when `window.location.hostname === 'localhost'`; wrap in try/catch to handle unavailable `localStorage`
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 5. Add HTTP security headers to the server
  - [ ] 5.1 Add a middleware in `server.js` (before static and route handlers) that sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` on every response
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ] 5.2 Extend the middleware to set a `Content-Security-Policy` header restricting `script-src` to `'self'` and the Socket.IO path (`/socket.io/`)
    - _Requirements: 2.1_
  - [ ] 5.3 Extend the middleware to conditionally set `Strict-Transport-Security: max-age=31536000; includeSubDomains` when the request protocol is HTTPS (check `req.secure` or `X-Forwarded-Proto`)
    - _Requirements: 2.5_
  - [ ] 5.4 Add a catch-all 404 handler after all routes that responds with HTTP 404 and includes the same security headers
    - _Requirements: 2.6_
  - [ ] 5.5 Write unit tests for the security header middleware
    - Test that each required header is present on HTML and static responses
    - Test that the 404 handler returns the correct status and headers
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

- [ ] 6. Add HTTP Cache-Control headers for static assets
  - [ ] 6.1 Replace the bare `express.static` call with one that sets `Cache-Control: public, max-age=86400` for non-HTML assets and `Cache-Control: no-cache` for `index.html`; enable `etag` and `lastModified` (both are Express defaults — verify they are not disabled)
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 7. Validate and bound user-supplied input lengths
  - [ ] 7.1 Add a `validateLengths` helper in `server.js` that checks trimmed length against the defined maxima: `desiredRoomId` ≤ 40, `name` ≤ 60, story `title` ≤ 200, story `desc` ≤ 1000, story `link` ≤ 500
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ] 7.2 Apply server-side length validation in the `room:create`, `room:join`, and `storyQueue:add` socket event handlers; silently discard events that exceed limits
    - _Requirements: 3.6_
  - [ ] 7.3 Add client-side length validation in `public/app.js` for the Create Room, Join, and Add To Queue button handlers; display an inline validation message and suppress the socket emit when a field exceeds its limit
    - _Requirements: 3.7_
  - [ ] 7.4 Write property tests for server-side length validation
    - **Property: For any string whose trimmed length exceeds the defined maximum, `validateLengths` returns false (or the event is discarded)**
    - **Validates: Requirements 3.1–3.6**
  - [ ] 7.5 Write unit tests for client-side validation messages
    - Test that the inline message appears and the socket is not called when input exceeds limits
    - _Requirements: 3.7_

- [ ] 8. Cap maximum concurrent rooms
  - [ ] 8.1 Add a `MAX_ROOMS` constant (default `500`) in `server.js` and enforce it in the `room:create` handler: emit `room:error` with reason `"Server at capacity"` and return without creating a room when the cap is reached
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ] 8.2 Add a `room:error` socket listener in `public/app.js` that displays the error reason to the user and re-enables the Create Room button
    - _Requirements: 4.4_
  - [ ] 8.3 Write unit tests for the room cap logic
    - Test that `room:error` is emitted at capacity and that room creation proceeds below the cap
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 9. Add room cleanup on empty disconnect
  - [ ] 9.1 In the `disconnect` handler in `server.js`, after removing the user, check if the room is now empty; if so, schedule deletion via `setTimeout` with a 5-minute grace period and store the timer reference on the room object
    - _Requirements: 11.1, 11.4_
  - [ ] 9.2 In the `room:join` handler, cancel any pending deletion timer (`clearTimeout`) on the room before adding the new user
    - _Requirements: 11.2_
  - [ ] 9.3 Verify the existing hourly `setInterval` cleanup remains in place as a safety net
    - _Requirements: 11.3_
  - [ ] 9.4 Write unit tests for the grace-period cleanup logic
    - Test that the timer is set on last-user disconnect and cancelled on rejoin
    - _Requirements: 11.1, 11.2_

- [ ] 10. Sanitise story link before storage on the server
  - [ ] 10.1 Move the `normalizeUrl` function (or import it from `public/render.js` if the module boundary allows) into `server.js` as the authoritative implementation; apply it to the `link` field in the `storyQueue:add` handler before pushing to the queue
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ] 10.2 Write a property test for the URL round-trip property
    - **Property: For all valid HTTP/HTTPS URL strings, `normalizeUrl(url)` stored and then rendered produces a clickable anchor with the original URL**
    - **Validates: Requirements 12.4**

- [ ] 11. Replace magic strings with named constants
  - [ ] 11.1 Define named constants for all Socket.IO event names in `server.js` (e.g. `EVT_ROOM_CREATE`, `EVT_ROOM_JOIN`, `EVT_VOTE_SET`, `EVT_VOTE_CLEAR`, `EVT_VOTE_REVEAL`, `EVT_STORY_ADD`, `EVT_STORY_REMOVE`, `EVT_STORY_SET_ACTIVE`, `EVT_STORY_FINALIZE`, `EVT_ROOM_STATE`, `EVT_ROOM_CREATED`, `EVT_ROOM_ERROR`) and replace all raw string literals in `io.on` / `socket.emit` calls
    - _Requirements: 9.1_
  - [ ] 11.2 Define named constants for room phase values (`PHASE_VOTING = 'voting'`, `PHASE_REVEALED = 'revealed'`) in `server.js` and replace all raw phase string literals
    - _Requirements: 9.2_
  - [ ] 11.3 Export the event name constants from a shared file (e.g. `public/events.js`) and import them in `public/app.js` so client socket emits reference the same constants
    - _Requirements: 9.3, 9.4_

- [ ] 12. Optimise renderer DOM operations
  - [ ] 12.1 Audit `renderUsers` in `public/app.js` (and `public/render.js`) to confirm it uses a `DocumentFragment` before a single DOM append; fix if not
    - _Requirements: 6.2_
  - [ ] 12.2 Audit `renderQueue` in `public/app.js` to confirm it uses a `DocumentFragment`; fix the empty-queue branch which currently appends directly without a fragment
    - _Requirements: 6.3_
  - [ ] 12.3 Audit each renderer to ensure `document.getElementById` is called at most once per unique element ID per invocation; refactor any repeated lookups to use a local variable
    - _Requirements: 6.4_
  - [ ] 12.4 Update `renderResults` so that when `state.phase !== 'revealed'` it only updates `textContent` and `className` without rebuilding child nodes
    - _Requirements: 6.5_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases
