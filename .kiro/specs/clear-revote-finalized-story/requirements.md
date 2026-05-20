# Requirements Document

## Introduction

This feature extends the existing Clear / Revote flow in FLAPS (Fibonacci Lean Agile Pointing System). Currently, when a facilitator clicks "Clear / Revote", all user votes are cleared and the room returns to the voting phase — but the active story's previously finalized point value is left intact. This feature ensures that triggering a Clear / Revote on a finalized story also clears the finalized point value, so the team can re-vote and reach a new consensus before finalizing again.

## Glossary

- **FLAPS**: The Fibonacci Lean Agile Pointing System — the planning poker web application.
- **Facilitator**: The moderator of a room who controls voting flow, story activation, and finalization.
- **Active_Story**: The story currently selected for estimation in a room, identified by `activeStoryId`.
- **Finalized_Story**: An Active_Story that has had a `finalPoints` value assigned via the Finalize Estimate action.
- **Clear_Revote**: The action triggered when the Facilitator clicks the "Clear / Revote" button, resetting votes and returning the room to the voting phase.
- **Story_Queue**: The ordered list of stories in a room, each of which may have a `finalPoints` value.
- **Server**: The Node.js/Socket.IO backend (`server.js`) that manages room state.
- **Client**: The browser-based frontend (`public/app.js`) that renders room state.

## Requirements

### Requirement 1: Clear Finalized Points on Revote

**User Story:** As a Facilitator, I want clicking "Clear / Revote" on a finalized story to also clear its finalized point value, so that the team can re-vote without the previous result influencing the session.

#### Acceptance Criteria

1. WHEN the Facilitator triggers Clear_Revote and the Active_Story has a `finalPoints` value, THE Server SHALL set `finalPoints` to `null` on the Active_Story in room state.
2. WHEN the Facilitator triggers Clear_Revote and the Active_Story has a `finalPoints` value, THE Server SHALL set `finalPoints` to `null` on the corresponding entry in the Story_Queue.
3. WHEN the Facilitator triggers Clear_Revote and the Active_Story does NOT have a `finalPoints` value, THE Server SHALL preserve existing Clear_Revote behavior without modification.
4. WHEN the Facilitator triggers Clear_Revote, THE Server SHALL reset all user votes to `null` and set the room phase to `"voting"`, regardless of whether the Active_Story was finalized.

### Requirement 2: Client Reflects Cleared Finalized Points

**User Story:** As a Participant or Facilitator, I want the UI to immediately reflect that the finalized point value has been cleared after a revote is triggered, so that there is no confusion about the story's current state.

#### Acceptance Criteria

1. WHEN the Client receives an updated room state after Clear_Revote, THE Client SHALL render the Active_Story without a `finalPoints` badge in the story view.
2. WHEN the Client receives an updated room state after Clear_Revote, THE Client SHALL render the corresponding Story_Queue entry with `"Final: —"` instead of the previously finalized value.
3. WHEN the Client receives an updated room state after Clear_Revote, THE Client SHALL re-enable voting deck cards so Participants can cast new votes.

### Requirement 3: Finalize Estimate Remains Available After Revote

**User Story:** As a Facilitator, I want to be able to finalize the estimate again after a revote, so that the team can reach a new consensus and record the updated point value.

#### Acceptance Criteria

1. WHEN the room phase transitions to `"revealed"` after a revote, THE Client SHALL enable the Finalize Estimate button and the final points dropdown for the Facilitator.
2. WHEN the Facilitator finalizes the estimate after a revote, THE Server SHALL store the new `finalPoints` value on the Active_Story and the corresponding Story_Queue entry, replacing the previously cleared value.
