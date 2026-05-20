# Requirements Document

## Introduction

FLAPS (Fibonacci Lean Agile Pointing System) is a real-time story estimation tool built with Node.js/Express on the server and vanilla JavaScript on the client, communicating via Socket.IO. This optimization effort targets performance, code quality, security, and maintainability across the entire codebase — `server.js`, `public/app.js`, `public/styles.css`, `public/index.html`, and the test suite.

The analysis identified the following categories of improvement:

- **Performance**: Redundant DOM queries, repeated `innerHTML` resets, missing HTTP caching headers, no room-count cap, unbounded memory growth.
- **Code quality**: Debug `console.log` statements left in production client code, duplicated rendering logic between `app.js` and test files, magic strings scattered throughout, inconsistent state-management patterns.
- **Security**: Missing HTTP security headers (CSP, X-Frame-Options, HSTS, etc.), no input length validation on user-supplied strings, `localStorage.debug` enabled unconditionally in production.
- **Maintainability**: Rendering helpers copy-pasted verbatim into two test files, no JSDoc on public functions, `vitest.config.js` missing browser environment for client tests, CSS custom properties partially unused.

---

## Glossary

- **Server**: The Node.js/Express + Socket.IO backend defined in `server.js`.
- **Client**: The browser-side application defined in `public/app.js`.
- **Room**: An in-memory session object keyed by a normalised room ID.
- **Moderator**: A connected user who holds the `moderatorKey` for a Room.
- **Deck**: The ordered array of voting card values associated with a Room.
- **Story**: The currently active estimation item within a Room.
- **StoryQueue**: The ordered list of Story objects awaiting or having received estimates.
- **Socket**: A Socket.IO connection between the Client and the Server.
- **Renderer**: A pure function in `app.js` that writes DOM nodes from application state.
- **Security_Header**: An HTTP response header that instructs browsers to apply a security policy.
- **CSP**: Content Security Policy — a Security_Header that restricts resource origins.
- **Input_Validator**: Logic that checks and rejects user-supplied strings that exceed defined length limits.

---

## Requirements

### Requirement 1: Remove Debug Logging from Production Client Code

**User Story:** As a developer, I want production client code to be free of debug log statements, so that browser consoles are not polluted and sensitive state is not inadvertently exposed.

#### Acceptance Criteria

1. THE Client SHALL contain no `console.log` calls that reference `[DEBUG]` prefixes or internal state objects in the production build.
2. WHEN the `room:state` Socket event is received, THE Client SHALL NOT emit any `console.log` output describing moderator status or element presence.
3. WHERE a developer needs runtime diagnostics, THE Client SHALL retain only `console.error` and `console.warn` calls that correspond to genuine error or warning conditions.

---

### Requirement 2: Add HTTP Security Headers

**User Story:** As a security-conscious operator, I want the Server to send standard HTTP security headers on every response, so that common browser-based attacks are mitigated.

#### Acceptance Criteria

1. THE Server SHALL include a `Content-Security-Policy` header on every HTML response that restricts `script-src` to `'self'` and the Socket.IO path.
2. THE Server SHALL include an `X-Frame-Options: DENY` header on every response to prevent clickjacking.
3. THE Server SHALL include an `X-Content-Type-Options: nosniff` header on every response.
4. THE Server SHALL include a `Referrer-Policy: strict-origin-when-cross-origin` header on every response.
5. WHEN the Server is accessed over HTTPS, THE Server SHALL include a `Strict-Transport-Security` header with a `max-age` of at least 31536000 seconds.
6. IF a request arrives for a path that does not match a defined route or static asset, THEN THE Server SHALL respond with HTTP 404 and the security headers defined in criteria 1–4.

---

### Requirement 3: Validate and Bound User-Supplied Input Lengths

**User Story:** As a developer, I want all user-supplied string inputs to be validated for maximum length on both the Client and the Server, so that excessively long strings cannot cause memory exhaustion or UI layout breakage.

#### Acceptance Criteria

1. THE Input_Validator SHALL reject any `desiredRoomId` value whose trimmed length exceeds 40 characters.
2. THE Input_Validator SHALL reject any user `name` value whose trimmed length exceeds 60 characters.
3. THE Input_Validator SHALL reject any story `title` value whose trimmed length exceeds 200 characters.
4. THE Input_Validator SHALL reject any story `desc` value whose trimmed length exceeds 1000 characters.
5. THE Input_Validator SHALL reject any story `link` value whose trimmed length exceeds 500 characters.
6. WHEN the Server receives a Socket event containing a field that exceeds its defined maximum length, THE Server SHALL silently discard the event without broadcasting.
7. WHEN the Client detects that a field value exceeds its defined maximum length before emitting a Socket event, THE Client SHALL display an inline validation message and SHALL NOT emit the event.

---

### Requirement 4: Cap Maximum Concurrent Rooms

**User Story:** As an operator, I want the Server to enforce a maximum number of concurrent in-memory Rooms, so that memory exhaustion from unbounded room creation is prevented.

#### Acceptance Criteria

1. THE Server SHALL define a configurable `MAX_ROOMS` constant with a default value of 500.
2. WHEN a `room:create` event is received and the number of active Rooms equals `MAX_ROOMS`, THE Server SHALL emit a `room:error` event to the requesting Socket with a reason of `"Server at capacity"` and SHALL NOT create a new Room.
3. WHEN a `room:create` event is received and the number of active Rooms is less than `MAX_ROOMS`, THE Server SHALL proceed with normal room creation.
4. THE Client SHALL handle the `room:error` event by displaying the error reason to the user and re-enabling the Create Room button.

---

### Requirement 5: Eliminate Duplicated Rendering Logic

**User Story:** As a developer, I want rendering helper functions to exist in a single authoritative location, so that bug fixes and changes do not need to be applied in multiple files.

#### Acceptance Criteria

1. THE Client SHALL export `renderStory`, `renderQueueEntry`, `normalizeUrl`, and `escapeHtml` as named exports from a dedicated module (e.g., `public/render.js`).
2. THE Server unit test file (`server.unit.test.js`) SHALL import rendering helpers from the shared module rather than redefining them inline.
3. THE property test file (`public/app.property.test.js`) SHALL import rendering helpers from the shared module rather than redefining them inline.
4. WHEN the shared rendering module is modified, THE test suite SHALL reflect the change without requiring edits to test files.

---

### Requirement 6: Optimise Renderer DOM Operations

**User Story:** As a developer, I want Renderer functions to minimise unnecessary DOM mutations, so that rendering performance is improved and layout thrashing is reduced.

#### Acceptance Criteria

1. WHEN `renderDeck` is called, THE Client SHALL build all card elements into a `DocumentFragment` before appending to the DOM (already partially done — SHALL be verified consistent).
2. WHEN `renderUsers` is called, THE Client SHALL build all list items into a `DocumentFragment` before a single append to the DOM.
3. WHEN `renderQueue` is called, THE Client SHALL build all queue items into a `DocumentFragment` before a single append to the DOM.
4. THE Client SHALL NOT call `document.getElementById` more than once per unique element ID within a single Renderer invocation.
5. WHEN `renderResults` is called with `state.phase !== 'revealed'`, THE Client SHALL update only the `textContent` and `className` of the results element without rebuilding child nodes.

---

### Requirement 7: Add HTTP Cache-Control Headers for Static Assets

**User Story:** As a developer, I want static assets to be served with appropriate `Cache-Control` headers, so that repeat visitors experience faster load times.

#### Acceptance Criteria

1. THE Server SHALL serve files under `/public` with a `Cache-Control: public, max-age=86400` header for non-HTML assets (JS, CSS, images).
2. THE Server SHALL serve `index.html` with a `Cache-Control: no-cache` header to ensure clients always receive the latest HTML shell.
3. WHEN a browser requests a static asset with a matching `ETag` or `Last-Modified` header, THE Server SHALL respond with HTTP 304 Not Modified.

---

### Requirement 8: Disable Socket.IO Debug Logging in Production

**User Story:** As a developer, I want Socket.IO client debug logging to be disabled in production environments, so that browser storage is not polluted and performance is not degraded.

#### Acceptance Criteria

1. THE Client SHALL NOT set `localStorage.debug` to any Socket.IO debug value when the page is served from a non-localhost origin.
2. WHERE the application is running on `localhost`, THE Client MAY set `localStorage.debug` for developer convenience.
3. IF `localStorage` is unavailable, THEN THE Client SHALL silently skip the debug configuration without throwing an error.

---

### Requirement 9: Replace Magic Strings with Named Constants

**User Story:** As a developer, I want all repeated literal values (socket event names, phase names, deck card values) to be defined as named constants, so that typos are caught at development time and changes require a single edit.

#### Acceptance Criteria

1. THE Server SHALL define named string constants for all Socket event names used in `io.on` and `socket.emit` calls (e.g., `EVT_ROOM_CREATE`, `EVT_VOTE_SET`).
2. THE Server SHALL define named string constants for room phase values (`"voting"`, `"revealed"`).
3. THE Client SHALL reference the same event name constants when emitting Socket events.
4. WHEN a Socket event name constant is changed, THE Server and Client SHALL both reflect the change without requiring a search-and-replace across raw string literals.

---

### Requirement 10: Improve Test Environment Configuration

**User Story:** As a developer, I want the Vitest configuration to correctly declare the test environment for each test file, so that DOM-dependent tests run in a browser-like environment without manual JSDOM setup.

#### Acceptance Criteria

1. THE `vitest.config.js` SHALL declare an `environmentMatchGlobs` rule that assigns the `jsdom` environment to `public/**/*.test.js` files.
2. WHEN `public/app.property.test.js` runs under the `jsdom` environment, THE test SHALL be able to use `document` directly without constructing a `JSDOM` instance manually.
3. THE `server.unit.test.js` file SHALL continue to run under the `node` environment.
4. THE test suite SHALL pass without errors after the environment configuration change.

---

### Requirement 11: Add Room Cleanup on Empty Disconnect

**User Story:** As an operator, I want Rooms with zero connected users to be eligible for immediate cleanup rather than waiting up to one hour, so that memory is reclaimed promptly after all participants leave.

#### Acceptance Criteria

1. WHEN the last user disconnects from a Room, THE Server SHALL schedule that Room for deletion after a grace period of 5 minutes.
2. WHEN a new user joins a Room that is scheduled for deletion within the grace period, THE Server SHALL cancel the scheduled deletion.
3. THE Server SHALL continue to run the existing hourly cleanup interval as a safety net for Rooms that were not cleaned up by the grace-period mechanism.
4. IF the grace-period timer fires and the Room still has zero connected users, THEN THE Server SHALL delete the Room from memory.

---

### Requirement 12: Sanitise Story Link Before Storage

**User Story:** As a developer, I want story links to be normalised and validated on the Server before being stored in a Room, so that invalid or non-HTTP(S) URLs cannot be persisted and later rendered.

#### Acceptance Criteria

1. WHEN the Server receives a `storyQueue:add` event, THE Server SHALL apply URL normalisation to the `link` field using the same `http`/`https`-only logic used by the Client.
2. IF the normalised link is empty or invalid, THEN THE Server SHALL store an empty string for the `link` field rather than the raw user input.
3. THE Server SHALL define a `normalizeUrl` function that is the authoritative implementation shared with the Client module defined in Requirement 5.
4. FOR ALL valid HTTP or HTTPS URL strings, normalising then storing then rendering SHALL produce a clickable anchor with the original URL (round-trip property).
