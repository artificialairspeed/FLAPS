# Requirements Document

## Introduction

FLAPS finalizes a story estimate by writing a `finalPoints` value onto the queue entry, which moves the card into the "Estimate Done" section and removes all of its action buttons. Today that transition is one-way: a story finalized by mistake, or a story the team decides to re-estimate after new information, cannot be returned to estimation without deleting and re-adding it (losing the story entry).

This feature adds a Re-Vote control to finalized story cards. Activating it clears the stored final estimate, returns the story to the "Need Estimate" section, makes it the active story, and puts the room back into voting mode, so the normal estimate → reveal → finalize flow can run again on the same story entry.

This feature also adds a Delete control to finalized story cards, behaving exactly as the delete control already does on "Need Estimate" cards: facilitator only, immediate removal with no confirmation prompt, emitted on the existing `storyQueue:remove` event. A finalized story added in error, or a story the team decides to drop after estimating it, can then be removed from the queue without first re-voting it. Deleting a finalized story removes its points from the exported total, and deleting one that is also the active story clears the active story slot.

## Glossary

- **FLAPS_Server**: The Socket.IO server process (`server.js`) that owns authoritative room state and broadcasts it to clients.
- **Client**: The browser-side application (`public/app.js`) for a single connected user.
- **Facilitator**: A user whose room state carries `youAreModerator === true`. Referred to as moderator in code.
- **Participant**: A connected user whose room state carries `youAreModerator === false`.
- **Story_Queue**: The ordered `room.storyQueue` array of story entries, each holding `id`, `number`, `title`, and `finalPoints`.
- **Finalized_Story**: A Story_Queue entry whose `finalPoints` is a non-empty value.
- **Pending_Story**: A Story_Queue entry whose `finalPoints` is `null`.
- **Active_Story**: The Story_Queue entry identified by `room.activeStoryId`, mirrored into `room.story`.
- **Need_Estimate_Section**: The queue section rendered into `queuePendingList` for Pending_Stories.
- **Estimate_Done_Section**: The queue section rendered into `queueDoneList` for Finalized_Stories.
- **Queue_Renderer**: The Client rendering path (`renderQueue`, `partitionStoryQueue`, `createQueueActions`) that draws the two queue sections and each story card.
- **Story_Card**: The rendered list item for one Story_Queue entry.
- **Re_Vote_Control**: The button rendered on a Finalized_Story card that starts a re-vote.
- **Re_Vote_Request**: The `storyQueue:revote` socket event emitted by the Client, carrying `roomId` and `storyId`.
- **Re_Vote_Handler**: The FLAPS_Server handler bound to the `storyQueue:revote` event.
- **Delete_Control**: The button rendered on a Story_Card that removes that story from the Story_Queue, built by the shared control builder (`createDeleteButton`) already used on Pending_Story cards.
- **Story_Delete_Request**: The `storyQueue:remove` socket event emitted by the Client, carrying `roomId` and `storyId`.
- **Delete_Handler**: The FLAPS_Server handler bound to the `storyQueue:remove` event (`handleStoryQueueRemove`).
- **Story_Placeholder**: The `room.story` value `{ number: "", title: "Add Story to Queue", finalPoints: null }` that the FLAPS_Server writes when no story is active.
- **Finalize_Controls**: The final-points chip radiogroup rendered by `renderFinalPointsChips` into `finalPointsChips`.
- **Room_Broadcast**: The `room:state` payload the FLAPS_Server sends to every socket in a room via `broadcastRoom`.
- **Voting_Phase**: The room state where `room.phase === "voting"`, votes are hidden, and users may cast or change a vote.
- **Cast_Vote**: A non-null `vote` value on a user record in `room.users`.

## Verified Existing Behavior (Delete Enhancement)

These facts were read from the current tree and constrain Requirements 9 through 11. They are recorded here so the delete requirements describe the existing contract rather than inventing new behavior.

- `public/app.js` already provides `createDeleteButton(storyId, currentRoom, socket)`. It builds a `button.queueBtn` with `type="button"`, the text `❌`, a `data-story-id` attribute, and an `onclick` that calls `stopPropagation()` and then emits `storyQueue:remove` with `{ roomId, storyId }`. There is no confirmation prompt and no acknowledgement callback. Pending_Story cards use this builder and add the `queueIconBtn` class.
- `createQueueActions(story, state, li)` has an early-return branch for Finalized_Stories that appends the final estimate pill, then appends the Re_Vote_Control when `state.youAreModerator` is true, then returns. The Delete_Control belongs in that same branch, facilitator-gated.
- `server.js` already registers `handleStoryQueueRemove` for `storyQueue:remove`. It is moderator-gated via `requireModerator`, filters the matching entry out of `room.storyQueue`, and when the removed story was the active story it sets `activeStoryId = null`, `phase = "voting"`, `room.story` to the Story_Placeholder, and every user record's `vote` to `null`. It then sets `lastActiveAt` and calls `broadcastRoom`. It does not validate that the story exists, does not acknowledge, and applies no rate limit.
- Because `handleStoryQueueRemove` already operates on any story id regardless of finalized status, **the FLAPS_Server requires no change for this enhancement**. Requirements 10 and 11 restate the server contract that finalized-card deletion depends on, so it is covered by tests, not because new server behavior is being added.
- The export path sums `finalPoints` over the remaining Story_Queue entries, so deleting a Finalized_Story reduces the exported points total.
- A Finalized_Story can also be the Active_Story, so the active-story reset path in `handleStoryQueueRemove` is reachable from a finalized-card delete.

## Requirements

### Requirement 1: Re-Vote and Delete Controls on Finalized Story Cards

**User Story:** As a facilitator, I want Re-Vote and Delete buttons on a finalized story card, so that I can send a story back for re-estimation or remove it from the queue without deleting and re-adding it.

#### Acceptance Criteria

1. WHERE the viewing user is the Facilitator, WHEN the Queue_Renderer renders a Story_Card for a Finalized_Story, THE Queue_Renderer SHALL render exactly one Re_Vote_Control in that card's action area, in the enabled state, positioned as the last element of that action area, after the final estimate pill that shows the story's stored final estimate value and after the Delete_Control.
2. WHERE the viewing user is a Participant, WHEN the Queue_Renderer renders a Story_Card for a Finalized_Story, THE Queue_Renderer SHALL render the final estimate pill showing the story's stored final estimate value as the only element in that card's action area and SHALL render zero Re_Vote_Controls and zero Delete_Controls on that card.
3. WHEN the Queue_Renderer renders a Story_Card for a Pending_Story, THE Queue_Renderer SHALL render zero Re_Vote_Controls on that card and SHALL leave the existing Pending_Story action set unchanged, namely the Vote, edit, and delete controls for the Facilitator and no action controls for a Participant.
4. WHEN the Queue_Renderer renders the Re_Vote_Control, THE Queue_Renderer SHALL render it as a `button` element with `type="button"` and an accessible name of "Re-vote story".
5. WHEN the Queue_Renderer renders the Re_Vote_Control, THE Queue_Renderer SHALL render it with the visible label "Re-Vote".
6. WHEN the Queue_Renderer renders a Story_Card for a Finalized_Story, THE Queue_Renderer SHALL omit the Vote control and the edit control for every viewing role, so that the finalized card action set is the final estimate pill alone for a Participant and the final estimate pill followed by the Delete_Control followed by the Re_Vote_Control for the Facilitator.
7. WHERE the viewing user is the Facilitator, WHEN the Queue_Renderer renders an Estimate_Done_Section containing 2 through 100 Finalized_Story cards, THE Queue_Renderer SHALL render exactly one Re_Vote_Control and exactly one Delete_Control per card and SHALL associate each Re_Vote_Control and each Delete_Control with the `id` of the Story_Queue entry rendered on its own Story_Card.
8. WHEN the Queue_Renderer re-renders the queue on a Room_Broadcast in which the viewing user's Facilitator status has changed, THE Queue_Renderer SHALL add the Re_Vote_Control and the Delete_Control to every Finalized_Story card if the viewing user is now the Facilitator, SHALL remove the Re_Vote_Control and the Delete_Control from every Finalized_Story card if the viewing user is now a Participant, and SHALL complete this change within the same render pass without requiring a page reload.
9. WHERE the viewing user is the Facilitator, WHILE a Finalized_Story is also the story identified by `room.activeStoryId`, WHEN the Queue_Renderer renders that Story_Card, THE Queue_Renderer SHALL render the Re_Vote_Control in the enabled state and SHALL render the Delete_Control in the enabled state.
10. IF a Story_Queue entry's `finalPoints` is an empty string or a whitespace-only string, THEN THE Queue_Renderer SHALL treat that entry as a Pending_Story, SHALL render no final estimate pill on its Story_Card, SHALL render zero Re_Vote_Controls on that card, and SHALL render the Pending_Story action set on that card.
11. WHERE the viewing user is the Facilitator, WHEN the Queue_Renderer renders a Story_Card for a Finalized_Story, THE Queue_Renderer SHALL render exactly one Delete_Control in that card's action area, in the enabled state, positioned immediately after the final estimate pill and immediately before the Re_Vote_Control.
12. WHEN the Queue_Renderer renders the Delete_Control on a Story_Card for a Finalized_Story, THE Queue_Renderer SHALL render it as a `button` element with `type="button"`, the visible label `❌`, and an accessible name of "Delete story".

### Requirement 2: Requesting a Re-Vote from the Client

**User Story:** As a facilitator, I want the Re-Vote button to act on a single click, so that re-estimating a story is as fast as starting a vote on a pending story.

#### Acceptance Criteria

1. WHEN the Facilitator activates the Re_Vote_Control by pointer click or by pressing Enter or Space while the Re_Vote_Control holds keyboard focus, THE Client SHALL emit exactly one Re_Vote_Request within 200 ms of the activation, carrying the room id held in Client state and the `id` of the Story_Queue entry whose Story_Card contains the activated Re_Vote_Control.
2. WHEN the Facilitator activates the Re_Vote_Control, THE Client SHALL emit the Re_Vote_Request with no intermediate confirmation prompt, dialog, or further user action required between the activation and the emission.
3. IF the Client socket is disconnected WHEN the Facilitator activates the Re_Vote_Control, THEN THE Client SHALL display an error toast reading "Not connected to server" for at least 3 seconds, SHALL leave the rendered queue unchanged, SHALL leave the stored room id and active story id in Client state unchanged, and SHALL emit no Re_Vote_Request.
4. IF no room id is present in Client state WHEN the Facilitator activates the Re_Vote_Control, THEN THE Client SHALL display an error toast reading "Join a room first" for at least 3 seconds, SHALL leave the rendered queue unchanged, and SHALL emit no Re_Vote_Request.
5. WHILE the Client socket is connected AND a room id is present in Client state, WHEN the Facilitator activates the Re_Vote_Control, THE Client SHALL emit the Re_Vote_Request, SHALL display no error toast, and SHALL leave the rendered queue and the Active_Story unchanged until the next Room_Broadcast is received.
6. WHEN the Facilitator activates the Re_Vote_Control, THE Client SHALL prevent the activation event from propagating to the enclosing Story_Card, such that no Story_Card selection or other Story_Card action is triggered and no additional socket event is emitted by that activation.
7. IF the FLAPS_Server returns an error response to a Re_Vote_Request, THEN THE Client SHALL display an error toast indicating the reported failure for at least 3 seconds, SHALL leave the rendered queue unchanged, and SHALL keep the Re_Vote_Control in the enabled state so the Facilitator can activate it again.
8. IF the Story_Card containing the activated Re_Vote_Control carries an absent or empty story id, THEN THE Client SHALL emit no Re_Vote_Request, SHALL display an error toast indicating that the story could not be identified for at least 3 seconds, and SHALL leave the rendered queue unchanged.

### Requirement 3: Server-Side Re-Vote State Transition

**User Story:** As a facilitator, I want a re-vote to reset the story and the room in one step, so that the team can start voting immediately.

#### Acceptance Criteria

1. WHILE the requested Story_Queue entry is a Finalized_Story, WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set that entry's `finalPoints` to `null` and SHALL leave the `finalPoints` value of every other Story_Queue entry unchanged.
2. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set `room.activeStoryId` to a value character-for-character equal to the requested story id, whether the previous `room.activeStoryId` was `null`, the same id, or a different id.
3. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set `room.story` to exactly three fields: `number` and `title` character-for-character equal to the requested entry's `number` and `title`, and `finalPoints` set to `null`.
4. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set `room.phase` to `"voting"`, whether its previous value was `"voting"` or `"revealed"`.
5. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set the `vote` field of every user record in `room.users` to `null`, including records for users that are currently disconnected, and SHALL leave every other field of each user record unchanged.
6. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL preserve the requested story's `id`, `number`, and `title` values character-for-character, including empty-string values.
7. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL preserve the length of the Story_Queue, the relative order of its entries, and the `id`, `number`, and `title` values of every entry.
8. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL discard the cleared final estimate value such that, after the transition, neither the re-voted Story_Queue entry's `finalPoints` nor `room.story.finalPoints` nor any other field of room state holds that value.
9. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set `room.lastActiveAt` to the epoch-millisecond timestamp taken while processing that request, and that value SHALL be greater than or equal to its value before the request.
10. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL send exactly one Room_Broadcast, after all state changes of criteria 1 through 9 have been applied and within 1000 ms of receiving the request, carrying the updated Story_Queue, `room.activeStoryId`, `room.story`, `room.phase`, and cleared votes.
11. WHEN a Re_Vote_Request arrives from the Facilitator of an existing room and its story id matches a Story_Queue entry that is a Finalized_Story, THE Re_Vote_Handler SHALL accept that Re_Vote_Request.
12. IF the Re_Vote_Handler cannot apply every state change of criteria 1 through 9 for an accepted Re_Vote_Request, THEN THE Re_Vote_Handler SHALL restore all room state to its values immediately before the request, SHALL send no Room_Broadcast, and SHALL return an error response indicating the re-vote was not applied to the requesting socket.

### Requirement 4: Re-Vote Authorization and Invalid Requests

**User Story:** As a facilitator, I want re-vote restricted to the facilitator and guarded against bad input, so that a finalized estimate cannot be discarded accidentally or by a participant.

#### Acceptance Criteria

1. IF a Re_Vote_Request arrives from a socket that is not the Facilitator of the room, THEN THE Re_Vote_Handler SHALL leave every Story_Queue entry's `finalPoints`, `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged, and SHALL return the existing moderator-required rejection response to the requesting socket only and to no other socket joined to the room.
2. IF a Re_Vote_Request carries a room id with no matching room, THEN THE Re_Vote_Handler SHALL leave the state of every room held by the FLAPS_Server unchanged and SHALL create no room for that room id.
3. IF a Re_Vote_Request carries a story id that matches no Story_Queue entry in the target room, THEN THE Re_Vote_Handler SHALL leave every Story_Queue entry's `finalPoints`, `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged, and SHALL add no entry to the Story_Queue.
4. IF a Re_Vote_Request carries a story id that is absent, `null`, an empty string, a whitespace-only string, or a value of any non-string type, THEN THE Re_Vote_Handler SHALL treat the request as matching no Story_Queue entry and SHALL leave every Story_Queue entry's `finalPoints`, `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged.
5. IF a Re_Vote_Request targets a Pending_Story, THEN THE Re_Vote_Handler SHALL leave every Story_Queue entry's `finalPoints`, `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged.
6. WHEN a second Re_Vote_Request carrying the same room id and story id is processed after a first Re_Vote_Request for that story id has been accepted, THE Re_Vote_Handler SHALL produce room state identical in every field except `room.lastActiveAt` to the room state produced by the first Re_Vote_Request.
7. WHEN the Re_Vote_Handler processes a Re_Vote_Request that fails more than one validation check, THE Re_Vote_Handler SHALL evaluate the checks in the order room existence, Facilitator authorization, story id validity, story existence, Finalized_Story status, and SHALL respond according to the first failed check only.
8. IF the Re_Vote_Handler rejects a Re_Vote_Request for any reason, THEN THE Re_Vote_Handler SHALL send no Room_Broadcast to any socket and SHALL leave `room.lastActiveAt` unchanged.

### Requirement 5: Re-Vote While Another Story Is Being Estimated

**User Story:** As a facilitator, I want re-vote to take over the active story slot, so that the re-voted story is the one the room is estimating.

#### Acceptance Criteria

1. WHILE `room.activeStoryId` holds a non-null value that differs from the requested story id, WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set `room.activeStoryId` to the requested story id and SHALL set `room.story` to the requested story's `number` and `title` with `finalPoints` set to `null`.
2. WHILE `room.phase` holds any value other than `"voting"`, WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set `room.phase` to `"voting"`.
3. WHILE one or more Cast_Votes exist in `room.users`, WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL set the `vote` field of every user record in `room.users` to `null`, regardless of how many user records the room holds, so that zero Cast_Votes remain after the request is applied.
4. WHILE `room.activeStoryId` holds a non-null value that differs from the requested story id, WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL leave the previously active story's Story_Queue entry unchanged in `id`, `number`, `title`, and `finalPoints`, and SHALL leave it at its existing position in the Story_Queue.
5. WHILE `room.activeStoryId` already equals the requested story id, WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE Re_Vote_Handler SHALL apply the same state changes as for a takeover from a different Active_Story, setting the requested entry's `finalPoints` to `null`, `room.phase` to `"voting"`, and every user record's `vote` to `null`.
6. WHEN the Re_Vote_Handler completes a Re_Vote_Request that changes the Active_Story, THE Re_Vote_Handler SHALL send exactly one Room_Broadcast, within 1 second of accepting the request, carrying the requested story with `finalPoints` set to `null` as the Active_Story and the previously active story with its `finalPoints` value unchanged.
7. IF a Re_Vote_Request is rejected for any reason WHILE a different story is the Active_Story, THEN THE Re_Vote_Handler SHALL leave `room.activeStoryId`, `room.story`, `room.phase`, every `vote` field in `room.users`, and every Story_Queue entry's `finalPoints` unchanged, and SHALL return an error response to the requesting socket indicating the request was not applied.

### Requirement 6: Post-Re-Vote Queue and Vote UI

**User Story:** As a team member, I want the re-voted story to appear as the active story needing an estimate, so that voting proceeds exactly as it does for any other story.

#### Acceptance Criteria

1. WHEN the Queue_Renderer receives a Room_Broadcast in which a previously finalized story has `finalPoints` set to `null`, THE Queue_Renderer SHALL render that story in the Need_Estimate_Section, SHALL omit it from the Estimate_Done_Section, and SHALL render its Story_Card without a final estimate pill and without the Re_Vote_Control.
2. WHILE `room.activeStoryId` matches a Pending_Story, WHEN the Queue_Renderer renders the Need_Estimate_Section, THE Queue_Renderer SHALL position that story first within the section and SHALL render the remaining Pending_Stories after it in their Story_Queue order.
3. WHEN the Queue_Renderer renders the queue sections, THE Queue_Renderer SHALL set the Need_Estimate_Section count and the Estimate_Done_Section count to the integer number of Story_Cards rendered in that section, using the value 0 when a section renders no Story_Cards.
4. WHILE a re-voted story is the Active_Story, THE Queue_Renderer SHALL apply the active-story highlight class to that story's Story_Card only, SHALL render that card's Vote button in the disabled state, and SHALL render the Vote button in the enabled state on every other Pending_Story card.
5. WHERE the viewing user is the Facilitator, WHILE the Active_Story has a `finalPoints` value of `null`, THE Finalize_Controls SHALL render every numeric chip in the enabled state and SHALL render no chip in the selected state.
6. WHILE `room.phase` is `"voting"` AND the Active_Story has a `finalPoints` value of `null`, WHEN the Client receives a Room_Broadcast, THE Client SHALL render every voting deck card in the enabled state for the viewing user and SHALL render no deck card in the selected state.
7. WHEN the Client receives a Room_Broadcast in which the Active_Story has a `finalPoints` value of `null` and every user record carries a `null` vote, THE Client SHALL render no Cast_Vote indicator on any user entry.
8. WHEN the Facilitator exports the Story_Queue after a re-vote, THE Client SHALL list the re-voted story as not finalized and SHALL set the exported points total to the sum of the `finalPoints` values of the Story_Queue entries whose `finalPoints` is non-null, excluding the re-voted story.
9. IF a Room_Broadcast carries a `room.activeStoryId` that is `null` or that matches no Pending_Story, THEN THE Queue_Renderer SHALL render the Need_Estimate_Section in Story_Queue order and SHALL apply the active-story highlight class to no Story_Card.
10. WHERE the viewing user is a Participant, WHILE the Active_Story has a `finalPoints` value of `null`, THE Finalize_Controls SHALL render no numeric chip in the enabled state.
11. WHEN the Client receives a Room_Broadcast in which the Active_Story has a `finalPoints` value of `null`, THE Client SHALL complete rendering of both queue sections, the voting deck, and the Finalize_Controls within 1000 milliseconds and without any further user action.

### Requirement 7: Multi-Client Consistency

**User Story:** As a team member, I want every connected client to reflect a re-vote at the same time, so that nobody votes against stale story state.

#### Acceptance Criteria

1. WHEN the Re_Vote_Handler accepts a Re_Vote_Request, THE FLAPS_Server SHALL send exactly one Room_Broadcast to every socket joined to that room within 1 second of applying the re-vote, in which the Story_Queue entries, `activeStoryId`, `room.story`, and `room.phase` values are identical for every recipient and differ only in the per-viewer `youAreModerator` value and the recipient's own user identity.
2. WHEN a Client receives a Room_Broadcast in which the re-voted story has `finalPoints` set to `null`, THE Client SHALL render that story in the Need_Estimate_Section within 1 second of receiving the broadcast, without a page reload and without any user interaction, for both Facilitator and Participant viewers.
3. WHILE no finalize and no Active_Story change has been applied since the re-vote, WHEN a socket joins or rejoins the room, THE FLAPS_Server SHALL send that socket room state in which the re-voted story has `finalPoints` set to `null` and is the Active_Story, for a joining Facilitator and a joining Participant alike, and without requiring a further Re_Vote_Request.
4. WHEN the FLAPS_Server sends a Room_Broadcast after a re-vote, THE FLAPS_Server SHALL persist the re-voted story's `finalPoints` value of `null` and the room's `activeStoryId` within 1 second of that Room_Broadcast.
5. IF delivery of a Room_Broadcast to a Client fails because that Client's socket is disconnected or its transport reports an error, THEN THE FLAPS_Server SHALL leave the applied re-vote values of `finalPoints`, `activeStoryId`, and `room.phase` unchanged, SHALL perform no rollback of those values, and SHALL send the re-voted room state to that Client on its next join or rejoin.
6. IF delivery of a Room_Broadcast fails for one or more sockets in the room, THEN THE FLAPS_Server SHALL still deliver that same Room_Broadcast to every remaining connected socket joined to the room.
7. WHEN the FLAPS_Server restores persisted room state after a restart that followed a re-vote, THE FLAPS_Server SHALL restore the re-voted story as a Pending_Story and as the Active_Story, with its `id`, `number`, and `title` values unchanged from before the restart.

### Requirement 8: Finalize and Re-Vote Round Trip

**User Story:** As a facilitator, I want finalize and re-vote to be reversible against each other, so that repeated correction cycles leave the queue in a predictable state.

#### Acceptance Criteria

1. WHEN the FLAPS_Server applies a finalize to a Pending_Story and then applies an accepted Re_Vote_Request to that same story, THE FLAPS_Server SHALL produce a Story_Queue entry whose `id`, `number`, and `title` match the pre-finalize values exactly and whose `finalPoints` is `null`.
2. WHEN the FLAPS_Server applies a finalize with a points value selectable from the Finalize_Controls to a story, then an accepted Re_Vote_Request to that story, then a finalize with that same points value, THE FLAPS_Server SHALL produce a Story_Queue entry whose `id`, `number`, `title`, and `finalPoints` match the values of the entry produced by the first finalize exactly.
3. WHEN the FLAPS_Server processes a sequence of 1 to 20 finalize and re-vote operations in any order on a room, THE FLAPS_Server SHALL keep the Story_Queue length equal to its length before the sequence, as observed in the Room_Broadcast following each operation in the sequence.
4. WHEN the FLAPS_Server processes a sequence of 1 to 20 finalize and re-vote operations in any order on a room, THE FLAPS_Server SHALL keep the set of Story_Queue entry ids equal to the set before the sequence, as observed in the Room_Broadcast following each operation in the sequence.
5. WHEN a re-vote is applied to a story and then a finalize with a points value is applied to that same story, THE Queue_Renderer SHALL render that story in the Estimate_Done_Section and SHALL omit it from the Need_Estimate_Section.
6. WHEN a re-vote is applied to a story and then a finalize with a points value is applied to that same story, THE Queue_Renderer SHALL render that Story_Card's final estimate pill showing the most recently finalized points value.
7. WHEN the FLAPS_Server processes a sequence of 1 to 20 finalize and re-vote operations in any order on a room, THE FLAPS_Server SHALL keep the relative order of Story_Queue entries equal to their order before the sequence.
8. IF an operation within a sequence of finalize and re-vote operations is rejected, THEN THE FLAPS_Server SHALL leave the Story_Queue length, entry ids, entry order, and every entry's `finalPoints` value unchanged by that operation, and SHALL apply the next accepted operation in the sequence to that unchanged Story_Queue.

### Requirement 9: Requesting Deletion of a Finalized Story from the Client

**User Story:** As a facilitator, I want the Delete button on a finalized story card to act on a single click, so that removing a finalized story is as fast as removing a story that still needs an estimate.

#### Acceptance Criteria

1. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story by pointer click, THE Client SHALL emit exactly one Story_Delete_Request within 200 ms of the activation, carrying the room id held in Client state and the `id` of the Story_Queue entry whose Story_Card contains the activated Delete_Control, and SHALL emit zero Story_Delete_Requests carrying the `id` of any other Story_Queue entry, including when the Estimate_Done_Section renders 2 through 100 Finalized_Story cards.
2. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story by pressing Enter or Space while that Delete_Control holds keyboard focus, THE Client SHALL emit exactly one Story_Delete_Request within 200 ms of the activation, carrying the same room id and story id as a pointer-click activation of that same Delete_Control.
3. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story, THE Client SHALL emit the Story_Delete_Request with no intermediate confirmation prompt, dialog, or further user action required between the activation and the emission, and SHALL require no acknowledgement from the FLAPS_Server before the activation is complete.
4. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story, THE Client SHALL prevent the activation event from propagating to the enclosing Story_Card, such that no Story_Card selection or other Story_Card action is triggered and no additional socket event is emitted by that activation.
5. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story, THE Client SHALL emit the Story_Delete_Request on the same socket event name and with the same two payload fields, room id and story id, as the Story_Delete_Request emitted by the Delete_Control on a Pending_Story card, SHALL pass the story id value held by the activated Delete_Control unchanged even when that value is an empty string, and SHALL apply no client-side validation of the story id before emitting.
6. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story, THE Client SHALL leave the rendered queue, the stored room id, and the stored active story id in Client state unchanged until the next Room_Broadcast is received, SHALL remove no Story_Card from the Estimate_Done_Section or the Need_Estimate_Section before that Room_Broadcast, SHALL display no error toast, and SHALL keep the Delete_Control in the enabled state.
7. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story, THE Client SHALL emit no Re_Vote_Request for that activation.
8. WHEN the Facilitator activates the Re_Vote_Control on a Story_Card for a Finalized_Story, THE Client SHALL emit no Story_Delete_Request for that activation.
9. IF the Client socket is disconnected or no room id is present in Client state WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story, THEN THE Client SHALL take the same actions it takes for an activation of the Delete_Control on a Pending_Story card under those same conditions, namely emitting the Story_Delete_Request carrying the room id value held in Client state with no connectivity check and no room-id check, displaying no error toast, leaving the rendered queue, the stored room id, and the stored active story id unchanged, and keeping the Delete_Control in the enabled state.
10. WHEN the Facilitator activates the Delete_Control on a Story_Card for a Finalized_Story 2 to 10 times consecutively within 1000 ms, THE Client SHALL emit exactly one Story_Delete_Request per activation, each carrying the same room id and story id, and SHALL neither disable the Delete_Control nor suppress any of those activations.

### Requirement 10: Server-Side Removal of a Finalized Story

**User Story:** As a facilitator, I want deleting a finalized story to remove exactly that story and leave the rest of the queue intact, so that the queue stays trustworthy after a correction.

#### Acceptance Criteria

1. WHILE the requested Story_Queue entry is a Finalized_Story, WHEN the Delete_Handler accepts a Story_Delete_Request, THE Delete_Handler SHALL remove exactly that entry from the Story_Queue, SHALL reduce the Story_Queue length by exactly 1, and SHALL preserve the relative order of the remaining entries and the `id`, `number`, `title`, and `finalPoints` values of every remaining entry.
2. WHEN a Story_Delete_Request arrives from the Facilitator of the target room and its requested story id matches a Story_Queue entry that is a Finalized_Story, THE Delete_Handler SHALL accept that Story_Delete_Request, where the target room is the room whose room id equals the request's room id after surrounding whitespace is removed and letters are case-folded to upper case, or, when the request's room id is absent, `null`, or empty after that removal, the room the requesting socket has already joined, and where the requested story id is the string form of the request's story id value with an absent or `null` value treated as the empty string.
3. WHILE the removed Finalized_Story is the entry identified by `room.activeStoryId`, WHEN the Delete_Handler accepts a Story_Delete_Request, THE Delete_Handler SHALL set `room.activeStoryId` to `null`, SHALL set `room.phase` to `"voting"`, SHALL set `room.story` to the Story_Placeholder holding exactly the three fields `number`, `title`, and `finalPoints`, SHALL set the `vote` field of every user record in `room.users` to `null`, including records for users that are currently disconnected, and SHALL leave every other field of each user record unchanged.
4. WHILE `room.activeStoryId` is `null` or identifies a Story_Queue entry other than the removed Finalized_Story, WHEN the Delete_Handler accepts a Story_Delete_Request, THE Delete_Handler SHALL leave `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged.
5. WHEN the Delete_Handler accepts a Story_Delete_Request, THE Delete_Handler SHALL set `room.lastActiveAt` to the epoch-millisecond timestamp taken while processing that request, and that value SHALL be greater than or equal to its value before the request.
6. WHEN the Delete_Handler accepts a Story_Delete_Request, THE Delete_Handler SHALL send exactly one Room_Broadcast, after all state changes of criteria 1 through 5 have been applied and within 1000 ms of receiving the request, carrying the updated Story_Queue, `room.activeStoryId`, `room.story`, `room.phase`, and vote values.
7. IF a Story_Delete_Request arrives from a socket that is not the Facilitator of the target room, THEN THE Delete_Handler SHALL leave the Story_Queue length, entry order, and every entry's `id`, `number`, `title`, and `finalPoints` unchanged, SHALL leave `room.activeStoryId`, `room.story`, `room.phase`, the `vote` field of every user record in `room.users`, and `room.lastActiveAt` unchanged, SHALL send no Room_Broadcast to any socket, and SHALL send no acknowledgement and no error response to the requesting socket.
8. IF a Story_Delete_Request resolves to no target room, because its room id matches no room held by the FLAPS_Server and the requesting socket has joined no room, THEN THE Delete_Handler SHALL leave the state of every room held by the FLAPS_Server unchanged, SHALL create no room for that room id, SHALL send no Room_Broadcast to any socket, and SHALL send no acknowledgement and no error response to the requesting socket.
9. IF a Story_Delete_Request from the Facilitator of the target room carries a story id that is absent, `null`, an empty string, a whitespace-only string, or any other value whose string form matches no Story_Queue entry in the target room, THEN THE Delete_Handler SHALL leave the Story_Queue length, entry order, and every entry's `id`, `number`, `title`, and `finalPoints` unchanged, SHALL add no entry to the Story_Queue, SHALL leave `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged, SHALL set `room.lastActiveAt` to the epoch-millisecond timestamp taken while processing that request, SHALL send exactly one Room_Broadcast carrying that unchanged Story_Queue and those unchanged room fields within 1000 ms of receiving the request, and SHALL send no acknowledgement and no error response to the requesting socket.
10. WHEN a second Story_Delete_Request carrying the same room id and story id is processed after a first Story_Delete_Request for that story id has been accepted, THE Delete_Handler SHALL produce a Story_Queue identical in length, entry order, and every entry's `id`, `number`, `title`, and `finalPoints` to the Story_Queue produced by the first Story_Delete_Request, SHALL leave `room.activeStoryId`, `room.story`, `room.phase`, and the `vote` field of every user record in `room.users` unchanged by the second request, and SHALL send exactly one Room_Broadcast carrying that unchanged state within 1000 ms of receiving the second request.
11. WHEN the Delete_Handler accepts a Story_Delete_Request, THE Delete_Handler SHALL discard the removed entry such that, after the transition, no Story_Queue entry holds the removed entry's `id`.
12. WHEN the Delete_Handler receives 2 to 20 Story_Delete_Requests from the Facilitator of the target room within any 1000 ms window, THE Delete_Handler SHALL process every one of those requests, SHALL apply the removal of criteria 1 and 3 for each request whose story id matches a Story_Queue entry, and SHALL send exactly one Room_Broadcast per processed request, rejecting no request on the grounds of request rate.
13. WHEN the FLAPS_Server processes a sequence of 1 to 20 finalize, re-vote, and delete operations in any order on a room, THE FLAPS_Server SHALL keep the set of Story_Queue entry ids equal to the set before the sequence minus the ids removed by the accepted delete operations, as observed in the Room_Broadcast following each operation in the sequence.
14. WHEN the FLAPS_Server processes a sequence of 1 to 20 finalize, re-vote, and delete operations in any order on a room, THE FLAPS_Server SHALL keep the relative order of the surviving Story_Queue entries equal to their relative order before the sequence.

### Requirement 11: Post-Delete Queue, Export, and Multi-Client Consistency

**User Story:** As a team member, I want a deleted finalized story to disappear from every client and from the export, so that the room and the report agree on what was estimated.

#### Acceptance Criteria

1. WHEN the Queue_Renderer receives a Room_Broadcast whose Story_Queue retains 1 to 100 entries and no longer contains a story that was present as a Finalized_Story in the immediately preceding Room_Broadcast, THE Queue_Renderer SHALL render no Story_Card for that story in the Need_Estimate_Section and no Story_Card for that story in the Estimate_Done_Section.
2. WHEN the Queue_Renderer receives a Room_Broadcast whose Story_Queue retains 1 to 100 entries and no longer contains a previously finalized story, THE Queue_Renderer SHALL set the Estimate_Done_Section count to the integer number of Story_Cards rendered in that section, using the value 0 when that section renders no Story_Cards.
3. WHERE the viewing user is the Facilitator, WHEN the Queue_Renderer receives a Room_Broadcast whose Story_Queue no longer contains a previously finalized story and retains 1 to 100 Finalized_Story entries, THE Queue_Renderer SHALL render each remaining Finalized_Story card with exactly one final estimate pill followed by exactly one Delete_Control followed by exactly one Re_Vote_Control.
4. WHEN the Facilitator exports the Story_Queue after a Finalized_Story has been deleted, THE Client SHALL omit the deleted story from the export and SHALL set the exported points total to the sum of the `finalPoints` values of the remaining Story_Queue entries whose `finalPoints` is non-null, using the value 0 when no remaining entry has a non-null `finalPoints`.
5. WHEN the Client receives a Room_Broadcast in which `room.activeStoryId` is `null` and `room.story` is the Story_Placeholder following the deletion of the Active_Story, THE Queue_Renderer SHALL apply the active-story highlight class to no Story_Card in either queue section and SHALL render no Cast_Vote indicator on any user entry.
6. WHEN the FLAPS_Server accepts a Story_Delete_Request for a Finalized_Story, THE FLAPS_Server SHALL send exactly one Room_Broadcast to each of the 1 to 20 sockets joined to that room within 1 second of applying the removal, in which the Story_Queue entries, `activeStoryId`, `room.story`, and `room.phase` values are identical for every recipient and differ only in the per-viewer `youAreModerator` value and the recipient's own user identity.
7. WHEN a Client receives a Room_Broadcast whose Story_Queue no longer contains a previously finalized story, THE Client SHALL complete rendering of both queue sections, the voting deck, and the Finalize_Controls within 1000 milliseconds of receiving that Room_Broadcast, without a page reload and without any further user action, for both Facilitator and Participant viewers.
8. WHEN the FLAPS_Server sends a Room_Broadcast after deleting a Finalized_Story, THE FLAPS_Server SHALL persist the Story_Queue without the deleted entry and the room's `activeStoryId` within 1 second of that Room_Broadcast.
9. WHEN the FLAPS_Server restores persisted room state after a restart that followed the deletion of a Finalized_Story, THE FLAPS_Server SHALL restore a Story_Queue containing no entry whose `id` equals the deleted entry's `id`, with the `id`, `number`, `title`, and `finalPoints` values of each of the 0 to 100 remaining entries unchanged from before the restart.
10. WHEN a socket joins or rejoins a room in which a Finalized_Story has been deleted, THE FLAPS_Server SHALL send that socket the room's current Story_Queue within 1 second of that join, which contains no entry that an accepted Story_Delete_Request has removed and that no later Story_Queue add operation has introduced, for a joining Facilitator and a joining Participant alike.
11. WHEN a Finalized_Story that is not the Active_Story is deleted, THE Queue_Renderer SHALL leave the Need_Estimate_Section Story_Cards, their order, the Need_Estimate_Section count, and the active-story highlight unchanged.
12. WHEN the Client receives a Room_Broadcast in which `room.activeStoryId` is `null` and `room.story` is the Story_Placeholder following the deletion of the Active_Story, THE Client SHALL discard any locally stored deck-card selection and any locally stored final-points chip selection for the deleted story, SHALL render no deck card in the selected state, SHALL render every voting deck card in the disabled state because no story is active after the deletion, and SHALL render no final-points chip of the Finalize_Controls in the selected state. (The disabled deck state here is intentional and differs from Requirement 6 criterion 6, where the re-voted story becomes the Active_Story and the deck is therefore enabled; after a delete there is no Active_Story to vote on, so the deck stays disabled.)
13. IF the Story_Queue contains 0 entries after an accepted Story_Delete_Request removed the last remaining Finalized_Story, THEN THE Queue_Renderer SHALL render the whole-queue empty placeholder in the visible state, SHALL render both the Need_Estimate_Section and the Estimate_Done_Section in the hidden state, and SHALL render no Story_Card.
