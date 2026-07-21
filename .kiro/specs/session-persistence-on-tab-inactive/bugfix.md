# Bugfix Requirements Document

## Introduction

During testing with facilitator and participant roles, users who switched away from the FLAPS estimation app (to another app, browser tab, or window) were disconnected from the server. When they returned to the session, they experienced multiple connection errors, were forced to join again, ran into problems while re-joining, and were ultimately blocked from continuing in the same session under their prior role and state.

The app is a real-time collaborative story-point estimation tool built on Socket.IO. When a browser backgrounds a tab/window, it throttles timers and can suspend the socket, causing the heartbeat to time out. The server treats this as a hard disconnect and immediately removes the user from the room, and because user identity is keyed on the transient socket id, returning users lose their place in the session rather than seamlessly resuming it.

This fix targets session persistence and resilient reconnection across tab/window/app inactivity, while preserving all existing behavior for users who remain active or who intentionally leave.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when a user backgrounds the app and later returns to an active session.

1.1 WHEN a user with an active session backgrounds the app (switches to another app, tab, or window) long enough for the socket heartbeat to lapse THEN the system drops the connection and immediately removes the user from the room
1.2 WHEN the user returns to the backgrounded app THEN the system surfaces multiple connection errors (repeated "Connection error" / "Disconnected" notifications)
1.3 WHEN the user returns after being disconnected THEN the system forces the user to join the session again instead of restoring their existing session
1.4 WHEN the user attempts to re-join after returning THEN the re-join fails or does not restore their prior role (facilitator/participant) and session state
1.5 WHEN re-join does not succeed THEN the system leaves the user blocked from continuing in the same session they were previously part of

### Expected Behavior (Correct)

What should happen instead when a user backgrounds the app and later returns to an active session.

2.1 WHEN a user with an active session backgrounds the app (switches to another app, tab, or window) THEN the system SHALL preserve the user's session so that a brief lapse does not permanently remove them from the room
2.2 WHEN the user returns to the app THEN the system SHALL re-establish the connection without surfacing repeated connection error notifications to the user
2.3 WHEN the connection is re-established after returning THEN the system SHALL automatically restore the user's session without requiring a manual re-join
2.4 WHEN the user's session is restored THEN the system SHALL restore their prior role (facilitator/participant) and current session state (active story, voting phase, and their own vote where still applicable)
2.5 WHEN the user returns to an active session THEN the system SHALL allow them to continue estimating stories in the same session uninterrupted

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved for users who remain active or who intentionally leave.

3.1 WHEN a user remains active in the foreground with a healthy connection THEN the system SHALL CONTINUE TO deliver real-time room state updates and estimation functionality as before
3.2 WHEN a user intentionally leaves the session (closes the tab/window or navigates away permanently) THEN the system SHALL CONTINUE TO remove that user from the room
3.3 WHEN a facilitator creates a room or a participant joins for the first time THEN the system SHALL CONTINUE TO create and join sessions with the correct role assignment
3.4 WHEN users vote, reveal, clear, queue, activate, or finalize stories while connected THEN the system SHALL CONTINUE TO process these actions and broadcast updated room state correctly
3.5 WHEN a room has been empty and idle beyond the idle timeout THEN the system SHALL CONTINUE TO clean up the room

## Deriving the Bug Condition

**Definitions**

- **F**: The original (unfixed) session/connection handling — background lapse leads to immediate user removal and forced manual re-join.
- **F'**: The fixed handling — background lapse is tolerated and the user's session is automatically restored on return.

**Bug Condition Function** — identifies inputs that trigger the bug:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type SessionEvent
  OUTPUT: boolean

  // A user who is part of an active room becomes inactive
  // (tab/window/app backgrounded) causing a transient connection
  // lapse, and then returns to resume the same session.
  RETURN X.userHasActiveSession
     AND X.wentInactive          // backgrounded app/tab/window
     AND X.connectionLapsed      // socket dropped due to inactivity
     AND X.userReturns           // user comes back to the app
     AND NOT X.userIntentionallyLeft
END FUNCTION
```

**Property Specification** — defines correct behavior for buggy inputs:

```pascal
// Property: Fix Checking - Seamless Session Persistence on Return
FOR ALL X WHERE isBugCondition(X) DO
  result <- F'(X)
  ASSERT result.sessionRestored = true
     AND result.roleRestored = X.priorRole
     AND result.requiredManualRejoin = false
     AND result.repeatedConnectionErrorsShown = false
     AND result.canContinueInSameSession = true
END FOR
```

**Preservation Goal** — behavior must be identical for all non-buggy inputs:

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

This ensures foreground activity, intentional leaves, first-time create/join, in-session actions, and idle-room cleanup all behave exactly as they did before the fix.
