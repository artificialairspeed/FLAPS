# Session Persistence on Tab Inactive Bugfix Design

## Overview

This bugfix addresses a critical session persistence issue where participant/voter users who have successfully joined a session are unable to rejoin after their tab becomes inactive, they navigate away, or they refresh the page. The current implementation stores join state in sessionStorage but does not handle Socket.IO reconnection properly for participants, leaving users in a state where they appear to have joined (join button disabled) but are not actually connected to the room on the server. This prevents participants from continuing their session after brief interruptions.

The fix will implement automatic reconnection logic that stores the necessary session information (room ID and user name) in sessionStorage and automatically attempts to rejoin participants when their Socket.IO connection is re-established. This ensures seamless session continuity for participants while maintaining the existing facilitator auto-rejoin behavior.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when a participant/voter loses their Socket.IO connection (tab inactive, navigation, refresh) after successfully joining a room
- **Property (P)**: The desired behavior when the bug condition occurs - participants should automatically rejoin with their stored identity upon reconnection
- **Preservation**: Existing behaviors that must remain unchanged - facilitator auto-rejoin, first-time join flow, manual rejoin capability, and all other room functionality
- **sessionStorage**: Browser storage mechanism that persists data for the duration of the page session (survives page refresh but not tab close)
- **Socket.IO connection**: The WebSocket/polling connection between client and server that enables real-time communication
- **Participant/Voter**: A user who joins a room without a moderator key (non-facilitator role)
- **Facilitator**: A user who creates a room and has a moderator key, with special privileges
- **socket.recovered**: Socket.IO flag indicating whether the connection was recovered from a previous session

## Bug Details

### Bug Condition

The bug manifests when a participant/voter user has successfully joined a room and their Socket.IO connection is lost due to tab inactivity, navigation away from the page, or page refresh. The client-side code stores the joined state in sessionStorage (`flaps_joined_<roomId>`) but does not store the room ID or user name needed for automatic reconnection. When the Socket.IO connection is re-established, the `connect` event handler only auto-rejoins facilitators (who have a `modKey`), leaving participants in a disconnected state with a disabled join button.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { userRole: string, connectionState: string, sessionStorage: object }
  OUTPUT: boolean
  
  RETURN input.userRole === 'participant'
         AND input.connectionState === 'reconnected'
         AND sessionStorage.hasJoinedFlag === true
         AND sessionStorage.hasRoomId === false
         AND sessionStorage.hasUserName === false
         AND NOT automaticRejoinAttempted
END FUNCTION
```

### Examples

- **Participant tab becomes inactive**: User "Alice" joins room "ABC123", her tab becomes inactive for 30 seconds, Socket.IO disconnects. When she returns, the join button is disabled but she's not in the server's room state. She cannot participate in voting.

- **Participant navigates away and returns**: User "Bob" joins room "XYZ789", clicks a link that navigates away, then uses browser back button. The join button is disabled but he's not connected to the room. He cannot see real-time updates.

- **Participant refreshes page**: User "Carol" joins room "DEF456", refreshes the page. The join button is disabled but she's not in the room. She must manually clear sessionStorage or use a different browser to rejoin.

- **Facilitator reconnection (working correctly)**: User "Dave" creates room "GHI789" with modKey, his tab becomes inactive. When he returns, he automatically rejoins as facilitator. This behavior should be preserved.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- First-time join flow: Users visiting a room link for the first time must see the name input field and enabled join button
- Facilitator auto-rejoin: Facilitators with a modKey must continue to automatically rejoin on reconnection
- Manual join capability: Users must be able to manually join by clicking the join button when appropriate
- Join button state: The join button and name field must remain disabled after successful join to prevent duplicate joins
- Room functionality: All existing room features (voting, story management, user presence, real-time updates) must continue to work
- Room cleanup: Idle rooms with no users must continue to be cleaned up after the configured timeout period
- Multiple user sessions: Each user must maintain their own separate session state

**Scope:**
All inputs that do NOT involve participant/voter reconnection after Socket.IO disconnection should be completely unaffected by this fix. This includes:
- Facilitator reconnection behavior (already working)
- First-time user join flow (no prior session)
- Active connections that never disconnect
- Manual join button clicks
- All server-side room management logic

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Incomplete Session Storage**: The current implementation only stores a boolean flag (`flaps_joined_<roomId>`) indicating the user has joined, but does not store the room ID or user name needed for automatic reconnection. This makes it impossible to automatically rejoin on reconnection.

2. **Participant-Only Reconnection Gap**: The Socket.IO `connect` event handler in `app.js` (lines ~280-295) only handles facilitator auto-rejoin (checks for `currentRoom && modKey`). There is no logic to handle participant reconnection, even though participants are the primary users affected by connection loss.

3. **Disabled Join Button State**: When a participant reconnects, the code checks `isAlreadyJoined()` and disables the join button (lines ~180-183), but does not attempt to rejoin. This leaves the user in a locked-out state with no way to recover without clearing sessionStorage.

4. **Missing Reconnection Trigger**: The `socket.recovered === false` check (line ~287) re-enables the join button for participants, but this only works if `joinButtonClicked` is true. If the page was refreshed, `joinButtonClicked` is reset to false, so the button remains disabled.

## Correctness Properties

Property 1: Bug Condition - Automatic Participant Reconnection

_For any_ participant/voter user who has successfully joined a room and whose Socket.IO connection is lost (tab inactive, navigation, refresh), the fixed code SHALL automatically attempt to rejoin the user with their stored name and room information upon reconnection, restoring their session state and connection to the room without requiring manual rejoin.

**Validates: Requirements 2.1, 2.2, 2.4**

Property 2: Preservation - Non-Reconnection Behavior

_For any_ user interaction that is NOT a participant reconnection scenario (first-time joins, facilitator reconnection, active connections, manual joins), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality for first-time users, facilitators, and all other room operations.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Property 3: Preservation - Manual Rejoin Fallback

_For any_ participant reconnection attempt that fails (stored session data is invalid, room no longer exists, server rejects join), the fixed code SHALL enable the join button and allow the user to manually rejoin with their previously stored name or a new name, providing a recovery path when automatic reconnection is not possible.

**Validates: Requirements 2.3**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `public/app.js`

**Function**: Multiple functions and event handlers related to session storage and Socket.IO connection

**Specific Changes**:

1. **Enhance Session Storage Functions**: Modify `saveJoinedState()` to store room ID and user name in addition to the joined flag
   - Store `flaps_room_id` with the current room ID
   - Store `flaps_user_name` with the user's name
   - Keep existing `flaps_joined_<roomId>` flag for backward compatibility

2. **Add Session Retrieval Functions**: Create new functions to retrieve stored session data
   - `getStoredRoomId()`: Retrieve the stored room ID from sessionStorage
   - `getStoredUserName()`: Retrieve the stored user name from sessionStorage
   - Handle errors gracefully if sessionStorage is unavailable

3. **Implement Automatic Reconnection Logic**: Modify the Socket.IO `connect` event handler to handle participant reconnection
   - After facilitator auto-rejoin logic, check if stored session data exists
   - If room ID and user name are stored, automatically emit `room:join` event
   - Set `joinButtonClicked` and `userJoined` flags to maintain UI state
   - Disable join button and name field after successful auto-rejoin

4. **Add Reconnection Failure Handling**: Implement fallback logic for failed reconnection attempts
   - Listen for server errors or timeout after auto-rejoin attempt
   - If auto-rejoin fails, clear stored session data and re-enable join button
   - Show user-friendly error message explaining they need to rejoin manually

5. **Clear Session Data on Manual Join**: Ensure session data is properly managed
   - Clear old session data when user manually joins a different room
   - Update session data when user successfully joins or rejoins

### Pseudocode for Automatic Reconnection

```
FUNCTION onSocketConnect()
  // Existing facilitator auto-rejoin (preserve)
  IF currentRoom AND modKey THEN
    autoRejoinAsFacilitator()
    RETURN
  END IF
  
  // New participant auto-rejoin logic
  storedRoomId := getStoredRoomId()
  storedUserName := getStoredUserName()
  
  IF storedRoomId AND storedUserName AND isAlreadyJoined(storedRoomId) THEN
    // Attempt automatic reconnection
    currentRoom := storedRoomId
    socket.emit('room:join', {
      roomId: storedRoomId,
      name: storedUserName,
      modKey: null
    })
    
    // Update UI state
    joinButtonClicked := true
    setDisabled('joinBtn', true)
    setDisabled('name', true)
    
    // Set timeout for failure handling
    setTimeout(() => {
      IF NOT userJoined THEN
        handleReconnectionFailure()
      END IF
    }, 5000)
  END IF
END FUNCTION

FUNCTION handleReconnectionFailure()
  clearStoredSessionData()
  joinButtonClicked := false
  setDisabled('joinBtn', false)
  setDisabled('name', false)
  showToast('Unable to rejoin. Please join manually.', 'warn')
END FUNCTION
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate participant join followed by Socket.IO disconnection and reconnection. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Participant Tab Inactive Test**: Simulate participant joining, then Socket.IO disconnect/reconnect (will fail on unfixed code - user not rejoined)
2. **Participant Page Refresh Test**: Simulate participant joining, then page refresh (will fail on unfixed code - user not rejoined)
3. **Participant Navigation Test**: Simulate participant joining, navigation away, then return (will fail on unfixed code - user not rejoined)
4. **SessionStorage Missing Test**: Simulate reconnection with no stored session data (may fail on unfixed code - should show join button)

**Expected Counterexamples**:
- Participant is not automatically rejoined to the room after reconnection
- Join button remains disabled but user is not in server's room state
- User cannot participate in voting or see real-time updates after reconnection
- Possible causes: missing session data storage, no reconnection logic for participants, disabled join button with no recovery path

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := handleSocketConnect_fixed(input)
  ASSERT expectedBehavior(result)
  ASSERT userIsRejoinedToRoom(result)
  ASSERT userCanParticipateInVoting(result)
  ASSERT userReceivesRealTimeUpdates(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT handleSocketConnect_original(input) = handleSocketConnect_fixed(input)
  ASSERT firstTimeJoinFlow_original(input) = firstTimeJoinFlow_fixed(input)
  ASSERT facilitatorAutoRejoin_original(input) = facilitatorAutoRejoin_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for first-time joins, facilitator reconnection, and other interactions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **First-Time Join Preservation**: Observe that first-time users see enabled join button on unfixed code, then verify this continues after fix
2. **Facilitator Auto-Rejoin Preservation**: Observe that facilitators auto-rejoin on unfixed code, then verify this continues after fix
3. **Manual Join Preservation**: Observe that manual join button clicks work on unfixed code, then verify this continues after fix
4. **Room Functionality Preservation**: Observe that voting, story management, and real-time updates work on unfixed code, then verify this continues after fix

### Unit Tests

- Test session storage functions (save, retrieve, clear) with valid and invalid data
- Test automatic reconnection logic with various stored session states
- Test reconnection failure handling and fallback to manual join
- Test that facilitator auto-rejoin continues to work correctly
- Test that first-time join flow is unaffected by new reconnection logic

### Property-Based Tests

- Generate random participant join/disconnect/reconnect sequences and verify automatic reconnection works
- Generate random room states and verify preservation of first-time join flow
- Generate random facilitator scenarios and verify preservation of facilitator auto-rejoin
- Test that all non-reconnection interactions continue to work across many scenarios

### Integration Tests

- Test full participant flow: join → disconnect → reconnect → vote → verify vote received
- Test participant page refresh: join → refresh → verify auto-rejoin → participate in session
- Test facilitator flow remains unchanged: create room → disconnect → reconnect → verify auto-rejoin as facilitator
- Test mixed scenarios: multiple participants and facilitators with various connection states
- Test reconnection failure scenarios: invalid room ID, room no longer exists, server error
