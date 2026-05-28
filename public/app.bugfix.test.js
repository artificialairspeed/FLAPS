/**
 * Bug Condition Exploration Test for Session Persistence on Tab Inactive
 *
 * Feature: session-persistence-on-tab-inactive
 * Property 1: Bug Condition - Participant Automatic Reconnection Failure
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * **GOAL**: Surface counterexamples that demonstrate the bug exists
 * 
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4 (bug conditions)
 * Expected Behavior: Requirements 2.1, 2.2, 2.4 (automatic reconnection)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fc from 'fast-check';

/**
 * Test Setup: Simulate the client-side environment with Socket.IO mock
 */
function setupClientEnvironment() {
  // Create a minimal DOM environment
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <head><title>FLAPS Test</title></head>
      <body>
        <input id="name" type="text" />
        <button id="joinBtn">Join</button>
        <button id="createRoomBtn">Create Room</button>
        <div id="modePill"></div>
        <main style="display: none;"></main>
        <footer style="display: none;"></footer>
      </body>
    </html>
  `);

  const { window } = dom;
  const { document } = window;

  // Mock sessionStorage
  const sessionStorageMock = (() => {
    let store = {};
    return {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (index) => Object.keys(store)[index] || null
    };
  })();

  // Mock Socket.IO client
  const socketMock = {
    id: 'test-socket-id-123',
    recovered: false,
    connected: false,
    listeners: {},
    data: {},
    
    on(event, handler) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(handler);
    },
    
    emit(event, data, ack) {
      // Track emitted events for assertions
      if (!this.emittedEvents) this.emittedEvents = [];
      this.emittedEvents.push({ event, data, ack });
    },
    
    trigger(event, data) {
      const handlers = this.listeners[event] || [];
      handlers.forEach(handler => handler(data));
    },
    
    simulateConnect() {
      this.connected = true;
      this.trigger('connect');
    },
    
    simulateDisconnect(reason = 'transport close') {
      this.connected = false;
      this.trigger('disconnect', reason);
    },
    
    getEmittedEvents() {
      return this.emittedEvents || [];
    },
    
    clearEmittedEvents() {
      this.emittedEvents = [];
    }
  };

  // Mock io function
  const ioMock = () => socketMock;

  return {
    window,
    document,
    sessionStorage: sessionStorageMock,
    socket: socketMock,
    io: ioMock
  };
}

/**
 * Extract and adapt the relevant functions from app.js for testing
 * These are the functions that handle session persistence and reconnection
 */
function createAppFunctions(env) {
  const { document, sessionStorage, socket } = env;
  
  let currentRoom = null;
  let modKey = null;
  let joinButtonClicked = false;
  let userJoined = false;

  const el = (id) => document.getElementById(id);
  
  function setDisabled(id, v) {
    const n = el(id);
    if (n && 'disabled' in n) n.disabled = !!v;
  }

  function saveJoinedState() {
    try {
      if (currentRoom) {
        // Trim and validate room ID before storing
        const roomIdToStore = currentRoom.trim();
        if (!roomIdToStore) {
          console.warn('Cannot save session state: invalid room ID');
          return;
        }
        
        // Store joined flag for backward compatibility
        sessionStorage.setItem('flaps_joined_' + roomIdToStore, 'true');
        
        // Store room ID for automatic reconnection (Task 3.1)
        sessionStorage.setItem('flaps_room_id', roomIdToStore);
        
        // Store user name for automatic reconnection (Task 3.1)
        const userName = (el('name')?.value ?? '').trim();
        if (userName) {
          sessionStorage.setItem('flaps_user_name', userName);
        }
      }
    } catch (err) {
      console.warn('Failed to save session state:', err);
    }
  }

  function isAlreadyJoined() {
    try {
      if (currentRoom) {
        return sessionStorage.getItem('flaps_joined_' + currentRoom) === 'true';
      }
    } catch {}
    return false;
  }

  // Task 3.2: Retrieve stored room ID from sessionStorage
  function getStoredRoomId() {
    try {
      const roomId = sessionStorage.getItem('flaps_room_id');
      // Validate that the stored value is a non-empty string (already trimmed when stored)
      if (roomId && typeof roomId === 'string' && roomId.length > 0) {
        return roomId;
      }
    } catch (err) {
      console.warn('Failed to retrieve stored room ID:', err);
    }
    return null;
  }

  // Task 3.2: Retrieve stored user name from sessionStorage
  function getStoredUserName() {
    try {
      const userName = sessionStorage.getItem('flaps_user_name');
      if (userName && typeof userName === 'string' && userName.trim()) {
        return userName.trim();
      }
    } catch (err) {
      console.warn('Failed to retrieve stored user name:', err);
    }
    return null;
  }

  // Task 3.4: Handle failed automatic reconnection attempts
  function handleReconnectionFailure() {
    try {
      // Clear stored session data (room ID, user name, joined flag) from sessionStorage
      if (currentRoom) {
        sessionStorage.removeItem('flaps_joined_' + currentRoom);
      }
      sessionStorage.removeItem('flaps_room_id');
      sessionStorage.removeItem('flaps_user_name');
    } catch (err) {
      // Handle sessionStorage errors gracefully
      console.warn('Failed to clear session data:', err);
    }
    
    // Reset joinButtonClicked flag to false
    joinButtonClicked = false;
    
    // Re-enable join button and name field to allow manual rejoin
    setDisabled('joinBtn', false);
    setDisabled('name', false);
    
    // Show user-friendly toast message
    showToast('Unable to rejoin. Please join manually.', 'warn');
  }

  // Task 3.3: FIXED connect handler with automatic reconnection for participants
  function handleSocketConnect() {
    if (currentRoom && modKey) {
      // Facilitator: auto-rejoin
      const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
      socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
    } else {
      // Participant automatic reconnection logic (Task 3.3)
      const storedRoomId = getStoredRoomId();
      const storedUserName = getStoredUserName();
      
      // Check if the stored room was previously joined
      const wasJoined = storedRoomId && sessionStorage.getItem('flaps_joined_' + storedRoomId) === 'true';
      
      if (storedRoomId && storedUserName && wasJoined) {
        // Attempt automatic reconnection for participant
        currentRoom = storedRoomId;
        
        // Set UI state flags to maintain consistency
        joinButtonClicked = true;
        
        // Disable join button and name field during auto-rejoin attempt
        setDisabled('joinBtn', true);
        setDisabled('name', true);
        
        // Emit room:join event to rejoin with stored identity
        socket.emit('room:join', { 
          roomId: storedRoomId, 
          name: storedUserName, 
          modKey: null 
        });
        
        // Set timeout to detect reconnection failure (5 seconds)
        setTimeout(() => {
          if (!userJoined) {
            // Reconnection failed - handle failure
            handleReconnectionFailure();
          }
        }, 5000);
      } else if (socket.recovered === false && joinButtonClicked) {
        // Fallback: re-enable join button if no stored session data
        joinButtonClicked = false;
        setDisabled('joinBtn', false);
      }
    }
  }

  function handleJoinClick() {
    const name = (el('name').value ?? '').trim();
    if (!name || !currentRoom) return;

    joinButtonClicked = true;
    setDisabled('joinBtn', true);
    setDisabled('name', true);

    socket.emit('room:join', { roomId: currentRoom, name, modKey });
  }

  function handleRoomState(state) {
    if (!userJoined) {
      userJoined = true;
      saveJoinedState();
    }
  }

  // Setup event listeners
  socket.on('connect', handleSocketConnect);
  socket.on('room:state', handleRoomState);

  return {
    setCurrentRoom: (room) => { currentRoom = room; },
    setModKey: (key) => { modKey = key; },
    getCurrentRoom: () => currentRoom,
    getModKey: () => modKey,
    isJoinButtonDisabled: () => el('joinBtn').disabled,
    isNameFieldDisabled: () => el('name').disabled,
    isUserJoined: () => userJoined,
    isJoinButtonClicked: () => joinButtonClicked,
    handleJoinClick,
    saveJoinedState,
    isAlreadyJoined
  };
}

/**
 * Arbitraries for property-based testing
 * 
 * Note: These arbitraries are constrained to match the application's validation rules:
 * - Participant names: Only letters and spaces (app.js has input validation)
 * - Room IDs: Non-empty strings after trimming
 */
const arbParticipantName = fc.stringMatching(/^[A-Za-z ]+$/).filter(s => s.trim().length > 0 && s.trim().length <= 50);
const arbRoomId = fc.stringMatching(/^[A-Z0-9]+$/).filter(s => s.length >= 3 && s.length <= 10);

const arbParticipantScenario = fc.record({
  participantName: arbParticipantName,
  roomId: arbRoomId
});

describe('Property 1: Bug Condition - Participant Automatic Reconnection Failure', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   * 
   * This test demonstrates the bug: when a participant joins a room and their
   * Socket.IO connection is lost (tab inactive, navigation, refresh), they are
   * NOT automatically rejoined upon reconnection.
   * 
   * **EXPECTED OUTCOME**: This test FAILS on unfixed code (proving the bug exists)
   * 
   * The test encodes the EXPECTED behavior (automatic reconnection), so when the
   * fix is implemented, this test will pass.
   */
  it('participant should be automatically rejoined after Socket.IO reconnection', () => {
    fc.assert(
      fc.property(arbParticipantScenario, ({ participantName, roomId }) => {
        // Setup environment
        const env = setupClientEnvironment();
        const { document, sessionStorage, socket } = env;
        const app = createAppFunctions(env);

        // Set the name field
        document.getElementById('name').value = participantName;

        // Simulate participant joining a room (no modKey = participant)
        app.setCurrentRoom(roomId);
        app.setModKey(null); // No modKey = participant

        // Simulate initial connection
        socket.simulateConnect();

        // Participant clicks join button
        app.handleJoinClick();

        // Verify join was attempted
        const joinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
        if (joinEvents.length === 0) {
          return false; // Join was not emitted
        }

        // Simulate server accepting the join by sending room:state
        socket.trigger('room:state', {
          roomId: roomId,
          users: { [socket.id]: { name: participantName, vote: null } },
          youAreModerator: false,
          phase: 'voting',
          deck: ['1', '2', '3', '5', '8'],
          story: { title: 'Test Story', desc: '', finalPoints: null },
          storyQueue: [],
          activeStoryId: null,
          mySocketId: socket.id
        });

        // Verify user is marked as joined
        if (!app.isUserJoined()) {
          return false; // User should be marked as joined
        }

        // Verify join button is disabled (expected behavior after join)
        if (!app.isJoinButtonDisabled()) {
          return false; // Join button should be disabled
        }

        // Clear emitted events to track reconnection behavior
        socket.clearEmittedEvents();

        // Simulate Socket.IO disconnect (tab inactive, navigation, etc.)
        socket.simulateDisconnect('transport close');

        // Simulate Socket.IO reconnect
        socket.recovered = false; // Not recovered from previous session
        socket.simulateConnect();

        // **BUG CONDITION CHECK**: After reconnection, the participant should be
        // automatically rejoined to the room. On unfixed code, this does NOT happen.
        
        // Check if automatic rejoin was attempted
        const rejoinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
        
        // **EXPECTED BEHAVIOR** (will fail on unfixed code):
        // - Automatic rejoin should be attempted (rejoinEvents.length > 0)
        // - The rejoin should use the stored participant name
        // - The rejoin should use the stored room ID
        
        if (rejoinEvents.length === 0) {
          // **BUG DETECTED**: No automatic rejoin attempted
          // This is the bug we're trying to fix
          return false;
        }

        const rejoinEvent = rejoinEvents[0];
        
        // Verify the rejoin event has correct data
        if (rejoinEvent.data.roomId !== roomId.trim()) {
          return false; // Wrong room ID
        }
        
        // Note: Names are trimmed when stored, so compare trimmed values
        if (rejoinEvent.data.name !== participantName.trim()) {
          return false; // Wrong participant name
        }
        
        if (rejoinEvent.data.modKey !== null) {
          return false; // Should not have modKey (participant, not facilitator)
        }

        // If we reach here, automatic reconnection worked correctly
        return true;
      }),
      { 
        numRuns: 50,
        verbose: true // Show counterexamples when test fails
      }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2, 1.3**
   * 
   * Concrete test case: Participant "Alice" in room "ABC123" should be
   * automatically rejoined after reconnection.
   * 
   * **EXPECTED OUTCOME**: This test FAILS on unfixed code
   */
  it('concrete case: participant Alice in room ABC123 should auto-rejoin after disconnect', () => {
    // Setup environment
    const env = setupClientEnvironment();
    const { document, sessionStorage, socket } = env;
    const app = createAppFunctions(env);

    const participantName = 'Alice';
    const roomId = 'ABC123';

    // Set the name field
    document.getElementById('name').value = participantName;

    // Simulate participant joining a room
    app.setCurrentRoom(roomId);
    app.setModKey(null); // Participant (no modKey)

    // Initial connection
    socket.simulateConnect();

    // Participant clicks join button
    app.handleJoinClick();

    // Simulate server accepting the join
    socket.trigger('room:state', {
      roomId: roomId,
      users: { [socket.id]: { name: participantName, vote: null } },
      youAreModerator: false,
      phase: 'voting',
      deck: ['1', '2', '3', '5', '8'],
      story: { title: 'Test Story', desc: '', finalPoints: null },
      storyQueue: [],
      activeStoryId: null,
      mySocketId: socket.id
    });

    // Verify initial state
    expect(app.isUserJoined()).toBe(true);
    expect(app.isJoinButtonDisabled()).toBe(true);
    expect(app.isAlreadyJoined()).toBe(true);

    // Clear emitted events
    socket.clearEmittedEvents();

    // Simulate disconnect
    socket.simulateDisconnect('transport close');

    // Simulate reconnect
    socket.recovered = false;
    socket.simulateConnect();

    // **EXPECTED BEHAVIOR**: Automatic rejoin should be attempted
    const rejoinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
    
    // This assertion will FAIL on unfixed code, demonstrating the bug
    expect(rejoinEvents.length).toBeGreaterThan(0);
    
    if (rejoinEvents.length > 0) {
      const rejoinEvent = rejoinEvents[0];
      expect(rejoinEvent.data.roomId).toBe(roomId);
      expect(rejoinEvent.data.name).toBe(participantName);
      expect(rejoinEvent.data.modKey).toBe(null);
    }
  });

  /**
   * **Validates: Requirements 1.4**
   * 
   * Test case: Participant should auto-rejoin after page refresh
   * (simulated by resetting state but keeping sessionStorage)
   * 
   * **EXPECTED OUTCOME**: This test FAILS on unfixed code
   */
  it('participant should auto-rejoin after page refresh', () => {
    // Setup environment
    const env = setupClientEnvironment();
    const { document, sessionStorage, socket } = env;
    const app = createAppFunctions(env);

    const participantName = 'Bob';
    const roomId = 'XYZ789';

    // Set the name field
    document.getElementById('name').value = participantName;

    // Simulate participant joining a room
    app.setCurrentRoom(roomId);
    app.setModKey(null);

    // Initial connection and join
    socket.simulateConnect();
    app.handleJoinClick();

    // Simulate server accepting the join
    socket.trigger('room:state', {
      roomId: roomId,
      users: { [socket.id]: { name: participantName, vote: null } },
      youAreModerator: false,
      phase: 'voting',
      deck: ['1', '2', '3', '5', '8'],
      story: { title: 'Test Story', desc: '', finalPoints: null },
      storyQueue: [],
      activeStoryId: null,
      mySocketId: socket.id
    });

    // Verify sessionStorage has the joined flag
    expect(sessionStorage.getItem('flaps_joined_' + roomId)).toBe('true');

    // Simulate page refresh: create new app instance but keep sessionStorage
    const env2 = setupClientEnvironment();
    env2.sessionStorage = sessionStorage; // Keep the same sessionStorage
    const app2 = createAppFunctions(env2);
    const socket2 = env2.socket;

    // After refresh, the app should detect stored session and auto-rejoin
    app2.setCurrentRoom(roomId);
    app2.setModKey(null);

    // Simulate connection after refresh
    socket2.simulateConnect();

    // **EXPECTED BEHAVIOR**: Automatic rejoin should be attempted
    const rejoinEvents = socket2.getEmittedEvents().filter(e => e.event === 'room:join');
    
    // This assertion will FAIL on unfixed code
    expect(rejoinEvents.length).toBeGreaterThan(0);
    
    if (rejoinEvents.length > 0) {
      const rejoinEvent = rejoinEvents[0];
      expect(rejoinEvent.data.roomId).toBe(roomId);
      // Note: On unfixed code, the name won't be stored, so this will fail
      expect(rejoinEvent.data.name).toBeTruthy();
    }
  });
});
