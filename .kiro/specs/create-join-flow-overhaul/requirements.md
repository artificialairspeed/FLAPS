# Requirements Document

## Introduction

FLAPS is a real-time collaborative story-point estimation tool built on a Node.js + Socket.IO
backend (`server.js`) with a vanilla JavaScript client (`public/app.js`). Today the create/join
and session lifecycle is spread across many independent client functions (`applyInitialRoleView`,
`updateRoombar`, `updateButtonStates`, `handleParticipantReconnection`, and the `room:created` /
`room:state` handlers), each toggling visibility, disabled states, and ad hoc boolean flags
(`joinButtonClicked`, `userJoined`, `roomCreated`). Identity, name, and emoji live in
`sessionStorage`. This scattering makes the UI state inconsistent across refresh, disconnect, and
reconnect.

This feature is a ground-up redesign that introduces a single explicit join/session state machine
as the one source of truth driving every button and field's visibility and enabled state, moves
durable identity to `localStorage` so sessions survive browser restarts, requires a non-empty name
before Join is enabled, remembers the last-used name and emoji as defaults, and consolidates the
server-side create/join/disconnect/resume logic into one coherent design that reconciles (rather
than regresses) the existing disconnect grace-period and resume-on-reconnect behavior delivered by
the `session-persistence-on-tab-inactive` spec.

## Glossary

- **FLAPS_Client**: The vanilla JavaScript client in `public/app.js` responsible for rendering the
  create/join UI and managing the local session lifecycle.
- **FLAPS_Server**: The Node.js + Socket.IO backend in `server.js` that owns room membership,
  role assignment, disconnect handling, and session resume.
- **Session_State_Machine**: The single explicit client-side state machine that owns the current
  join/session state and is the sole authority for the visibility and enabled state of all
  create/join controls and fields.
- **Session_State**: One of the defined states of the Session_State_Machine: `INITIAL`, `CREATING`,
  `JOINING`, `JOINED`, `DISCONNECTED`, `RESUMING`.
- **Facilitator**: A user who creates a room and holds the moderator role, resolved server-side via
  `isModerator(room, modKey)`.
- **Participant**: A user who joins an existing room without moderator privileges.
- **Client_Identity**: The stable per-tab `clientId` used as the user key for a room session,
  together with the user's name and emoji. Scoped to a single tab/window (`sessionStorage`) so each
  tab is a distinct participant.
- **Remembered_Defaults**: The last-used name and emoji retained in `localStorage` and pre-filled
  into the join fields on a fresh load.
- **Grace_Period**: The server-side bounded interval (existing `DISCONNECT_GRACE_MS`) during which a
  disconnected user's session record is retained rather than deleted.
- **Resume**: Server-side re-attachment of a returning `clientId` to its existing user record,
  preserving role and vote, as implemented in `handleRoomJoin`.
- **Name_Field**: The client input control for the user's display name.
- **Join_Control**: The client Join button.
- **Create_Control**: The client Create Room button.

## Requirements

### Requirement 1: Single Source of Truth State Machine

**User Story:** As a developer maintaining FLAPS, I want a single explicit join/session state
machine to drive all create/join UI, so that control visibility and enabled state are consistent
and derived from one source of truth.

#### Acceptance Criteria

1. THE Session_State_Machine SHALL define exactly the states `INITIAL`, `CREATING`, `JOINING`,
   `JOINED`, `DISCONNECTED`, and `RESUMING`.
2. THE Session_State_Machine SHALL be the single authority that determines the visibility and enabled
   state of the Create_Control, Name_Field, Join_Control, and emoji control.
3. WHEN the Session_State changes, THE FLAPS_Client SHALL update the visibility and enabled state of
   all create/join controls from the current Session_State in one place.
4. THE FLAPS_Client SHALL derive create/join control visibility and enabled state from the
   Session_State rather than from the separate `joinButtonClicked`, `userJoined`, and `roomCreated`
   flags.
5. WHILE the Session_State is `INITIAL`, THE FLAPS_Client SHALL present the create/join controls in
   their pre-join configuration.

### Requirement 2: Facilitator Create Flow States

**User Story:** As a facilitator, I want the create flow to move through explicit states, so that
the UI reflects room creation accurately from click through joined.

#### Acceptance Criteria

1. WHEN the Facilitator activates the Create_Control, THE Session_State_Machine SHALL transition to
   the `CREATING` state.
2. WHILE the Session_State is `CREATING`, THE FLAPS_Client SHALL disable the Create_Control.
3. WHEN the FLAPS_Server confirms room creation via the `room:created` event, THE
   Session_State_Machine SHALL transition to the `JOINED` state.
4. WHILE the Session_State is `JOINED` for a Facilitator, THE FLAPS_Client SHALL display the
   Create_Control in its created configuration and enable moderator controls.
5. WHILE the Session_State is `INITIAL` and no room is present in the URL, THE FLAPS_Client SHALL
   display the Name_Field and emoji control alongside the Create_Control so the Facilitator can set
   their own name and emoji before creating a room.
6. WHEN the Facilitator activates the Create_Control, THE FLAPS_Client SHALL use the current
   Name_Field and emoji control values for the Facilitator's session, defaulting the name to
   "Facilitator" only when the Name_Field is empty.

### Requirement 3: Participant Join Flow States

**User Story:** As a participant, I want the join flow to move through explicit states, so that the
Join button and name field reflect my join progress accurately.

#### Acceptance Criteria

1. WHEN the Participant activates the Join_Control, THE Session_State_Machine SHALL transition to the
   `JOINING` state.
2. WHILE the Session_State is `JOINING`, THE FLAPS_Client SHALL disable the Join_Control and the
   Name_Field.
3. WHEN the FLAPS_Server confirms membership via the first `room:state` event, THE
   Session_State_Machine SHALL transition to the `JOINED` state.
4. WHILE the Session_State is `JOINED` for a Participant, THE FLAPS_Client SHALL keep the Name_Field
   and Join_Control disabled.

### Requirement 4: Name Required to Join

**User Story:** As a participant, I want the Join button disabled until I enter a name, so that I
cannot join without a display name.

#### Acceptance Criteria

1. WHILE the Name_Field is empty or contains only whitespace, THE FLAPS_Client SHALL keep the
   Join_Control disabled.
2. WHEN the Name_Field contains at least one non-whitespace character, THE FLAPS_Client SHALL enable
   the Join_Control.
3. IF the Name_Field value is empty or whitespace-only when a join is attempted, THEN THE FLAPS_Client
   SHALL prevent the join and keep the Session_State unchanged.

### Requirement 5: Per-Tab Client Identity

**User Story:** As a user, I want each browser tab/window to be a distinct participant, so that two
people (or two sessions) in the same browser are never merged into one user or allowed to inherit
each other's role.

#### Rationale

Client identity is scoped per tab (stored in `sessionStorage`) rather than per browser
(`localStorage`). A per-browser identity is shared across all tabs of the same origin, which caused a
second user opening the participant link in the same browser to resume the first user's server
record — inheriting their role (including moderator) and vote. A per-tab identity still survives page
reloads and tab-inactive/background lapses within the same tab (the scenario the
`session-persistence-on-tab-inactive` behavior targets), but a separate tab/window or a full browser
restart correctly starts a fresh identity. This deliberately trades away silent resume across a full
browser restart in favor of correct multi-user isolation.

#### Acceptance Criteria

1. THE FLAPS_Client SHALL store the Client_Identity `clientId` in `sessionStorage` (per tab).
2. WHEN the FLAPS_Client loads and no `clientId` exists in `sessionStorage`, THE FLAPS_Client SHALL
   generate a stable `clientId` and store it in `sessionStorage`.
3. THE FLAPS_Client SHALL include the stored `clientId` in every `room:create` and `room:join` emit.
4. WHEN the FLAPS_Client loads and a `clientId` exists in `sessionStorage` for the tab, THE
   FLAPS_Client SHALL reuse the stored `clientId` rather than generating a new one.
5. THE FLAPS_Client SHALL NOT share the `clientId` across separate tabs/windows of the same browser.

### Requirement 6: Remembered Name and Emoji Defaults

**User Story:** As a returning user, I want my last-used name and emoji remembered, so that they are
pre-filled the next time I open FLAPS.

#### Acceptance Criteria

1. WHEN a user completes a join with a name and emoji, THE FLAPS_Client SHALL store that name and
   emoji as Remembered_Defaults in `localStorage`.
2. WHEN the FLAPS_Client loads and Remembered_Defaults exist, THE FLAPS_Client SHALL pre-fill the
   Name_Field and emoji control with the Remembered_Defaults.
3. WHERE no Remembered_Defaults exist, THE FLAPS_Client SHALL present the Name_Field empty and the
   emoji control at its default value.

### Requirement 7: Page-Refresh Session Restoration

**User Story:** As a user who refreshes the page, I want my joined session restored, so that I return
to the room without manually re-joining.

#### Acceptance Criteria

1. WHEN the FLAPS_Client loads with a stored joined session for the current room, THE
   Session_State_Machine SHALL enter the `RESUMING` state and attempt to rejoin using the stored
   `clientId`.
2. WHEN the FLAPS_Server confirms the resumed session via `room:state`, THE Session_State_Machine
   SHALL transition to the `JOINED` state and restore the user's role and vote in the UI.
3. WHILE the Session_State is `RESUMING`, THE FLAPS_Client SHALL keep the Name_Field and Join_Control
   disabled.
4. WHEN the FLAPS_Client loads without a stored joined session for the current room, THE
   Session_State_Machine SHALL enter the `INITIAL` state.

### Requirement 8: Connectivity Drop and Restore

**User Story:** As a user whose connection drops, I want the UI to reflect the disconnection and
automatically recover, so that I resume my session without manual intervention or noisy errors.

#### Acceptance Criteria

1. WHEN the socket connection is lost while the Session_State is `JOINED`, THE Session_State_Machine
   SHALL transition to the `DISCONNECTED` state.
2. WHEN a reconnect attempt begins from the `DISCONNECTED` state, THE Session_State_Machine SHALL
   transition to the `RESUMING` state and re-emit `room:join` with the stored `clientId`, room, name,
   emoji, and `modKey`.
3. WHEN the FLAPS_Server confirms the resumed session via `room:state`, THE Session_State_Machine
   SHALL transition to the `JOINED` state and preserve the user's prior role and vote.
4. WHILE the Session_State is `DISCONNECTED` or `RESUMING` during a transient auto-recovering lapse,
   THE FLAPS_Client SHALL suppress repeated connection-error notifications and show a single quiet
   connection-status indication.
5. WHILE the Session_State is `DISCONNECTED` or `RESUMING`, THE FLAPS_Client SHALL keep the in-session
   UI controls in their `JOINED` configuration rather than reverting to the pre-join configuration.

### Requirement 9: Server-Side Consolidation

**User Story:** As a maintainer, I want the server create/join/disconnect/resume logic consolidated
into one coherent design, so that identity, role, and session handling are centralized and the
existing grace-period behavior is preserved.

#### Acceptance Criteria

1. THE FLAPS_Server SHALL key `room.users` by the stable `clientId`, falling back to `socket.id` when
   no `clientId` is supplied.
2. WHEN a `room:join` arrives with a `clientId` that matches an existing user record, THE FLAPS_Server
   SHALL resume that record by re-attaching the current `socketId`, marking it connected, and
   preserving the existing role and vote.
3. WHEN a `room:join` arrives with a `clientId` that matches no existing user record, THE FLAPS_Server
   SHALL create a new user record with role resolved via `isModerator(room, modKey)`.
4. WHEN a socket disconnects while its user record exists, THE FLAPS_Server SHALL retain the record
   for the Grace_Period and mark it disconnected rather than deleting it immediately.
5. IF the Grace_Period elapses without a reconnect for a disconnected user, THEN THE FLAPS_Server
   SHALL remove that user record and broadcast the updated room state.
6. THE FLAPS_Server SHALL expose the user's stable `clientId` and role in the room state produced by
   `makeRoomState`.

### Requirement 10: Role Restoration on Resume

**User Story:** As a facilitator or participant returning after a lapse, I want my role restored
correctly, so that moderators keep moderator controls and participants keep participant status.

#### Acceptance Criteria

1. WHEN a Facilitator resumes a session via a matching `clientId`, THE FLAPS_Server SHALL retain the
   moderator role without downgrading it when the reconnect omits the `modKey`.
2. WHEN a Participant resumes a session via a matching `clientId`, THE FLAPS_Server SHALL retain the
   participant role and the participant's prior vote where the voting phase still applies.
3. WHEN the FLAPS_Client receives room state after a resume, THE FLAPS_Client SHALL render the
   moderator controls for a Facilitator and the participant controls for a Participant according to
   the role in the room state.
