/**
 * Preservation Property Tests for Session Persistence on Tab Inactive
 *
 * Feature: session-persistence-on-tab-inactive
 * Property 2: Preservation - Non-Reconnection Behavior Unchanged
 * 
 * **IMPORTANT**: These tests run on UNFIXED code and should PASS
 * **GOAL**: Capture baseline behavior that must be preserved after the fix
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
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
 * These are the UNFIXED functions that we're testing for preservation
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
        sessionStorage.setItem('flaps_joined_' + currentRoom, 'true');
      }
    } catch {}
  }

  function isAlreadyJoined() {
    try {
      if (currentRoom) {
        return sessionStorage.getItem('flaps_joined_' + currentRoom) === 'true';
      }
    } catch {}
    return false;
  }

  // This is the UNFIXED connect handler
  function handleSocketConnect() {
    if (currentRoom && modKey) {
      // Facilitator: auto-rejoin
      const nameVal = (el('name').value ?? '').trim() || 'Facilitator';
      socket.emit('room:join', { roomId: currentRoom, name: nameVal, modKey });
    } else if (socket.recovered === false && joinButtonClicked) {
      // Participant reconnect after disconnect: re-enable join button
      joinButtonClicked = false;
      setDisabled('joinBtn', false);
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
    isAlreadyJoined,
    getMainContentDisplay: () => document.querySelector('main')?.style.display,
    getFooterDisplay: () => document.querySelector('footer')?.style.display
  };
}

/**
 * Arbitraries for property-based testing
 */
// Generate realistic user names (letters and spaces only, trimmed)
const arbUserName = fc.stringMatching(/^[A-Za-z]+( [A-Za-z]+)*$/, { maxLength: 50 });

// Generate realistic room IDs (alphanumeric uppercase)
const arbRoomId = fc.stringMatching(/^[A-Z0-9]{3,10}$/);

// Generate realistic modKeys (alphanumeric with hyphens)
const arbModKey = fc.stringMatching(/^[A-Za-z0-9-]{10,20}$/);

const arbFirstTimeUserScenario = fc.record({
  userName: arbUserName,
  roomId: arbRoomId
});

const arbFacilitatorScenario = fc.record({
  facilitatorName: arbUserName,
  roomId: arbRoomId,
  modKey: arbModKey
});

describe('Property 2: Preservation - Non-Reconnection Behavior Unchanged', () => {
  /**
   * **Validates: Requirement 3.1**
   * 
   * First-time join flow: Users visiting room for first time see enabled join button and name input
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code (baseline behavior)
   */
  it('first-time users see enabled join button and name input', () => {
    fc.assert(
      fc.property(arbFirstTimeUserScenario, ({ userName, roomId }) => {
        // Setup environment
        const env = setupClientEnvironment();
        const { document, sessionStorage, socket } = env;
        const app = createAppFunctions(env);

        // Simulate first-time user visiting a room link
        app.setCurrentRoom(roomId);
        app.setModKey(null); // No modKey = participant

        // Set the name field
        document.getElementById('name').value = userName;

        // Initial connection (first time, no prior session)
        socket.simulateConnect();

        // Verify join button is enabled for first-time users
        const joinButtonDisabled = app.isJoinButtonDisabled();
        
        // Verify name field is enabled for first-time users
        const nameFieldDisabled = app.isNameFieldDisabled();

        // First-time users should have enabled join button and name field
        return !joinButtonDisabled && !nameFieldDisabled;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirement 3.2**
   * 
   * Facilitator auto-rejoin: Facilitators with modKey automatically rejoin on reconnection
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code (baseline behavior)
   */
  it('facilitators with modKey automatically rejoin on reconnection', () => {
    fc.assert(
      fc.property(arbFacilitatorScenario, ({ facilitatorName, roomId, modKey }) => {
        // Setup environment
        const env = setupClientEnvironment();
        const { document, socket } = env;
        const app = createAppFunctions(env);

        // Set the name field
        document.getElementById('name').value = facilitatorName;

        // Simulate facilitator with modKey
        app.setCurrentRoom(roomId);
        app.setModKey(modKey);

        // Initial connection
        socket.simulateConnect();

        // Verify facilitator auto-join was attempted
        const initialJoinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
        if (initialJoinEvents.length === 0) {
          return false; // Facilitator should auto-join on initial connect
        }

        // Simulate server accepting the join
        socket.trigger('room:state', {
          roomId: roomId,
          users: { [socket.id]: { name: facilitatorName, vote: null, isModerator: true } },
          youAreModerator: true,
          phase: 'voting',
          deck: ['1', '2', '3', '5', '8'],
          story: { title: 'Test Story', desc: '', finalPoints: null },
          storyQueue: [],
          activeStoryId: null,
          mySocketId: socket.id
        });

        // Clear emitted events
        socket.clearEmittedEvents();

        // Simulate disconnect
        socket.simulateDisconnect('transport close');

        // Simulate reconnect
        socket.recovered = false;
        socket.simulateConnect();

        // Verify facilitator auto-rejoin was attempted after reconnection
        const rejoinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
        
        if (rejoinEvents.length === 0) {
          return false; // Facilitator should auto-rejoin
        }

        const rejoinEvent = rejoinEvents[0];
        
        // Verify the rejoin event has correct data
        return rejoinEvent.data.roomId === roomId &&
               rejoinEvent.data.modKey === modKey &&
               rejoinEvent.data.name === facilitatorName;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirement 3.3**
   * 
   * Manual join capability: Users can manually join by clicking join button
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code (baseline behavior)
   */
  it('users can manually join by clicking join button', () => {
    fc.assert(
      fc.property(arbFirstTimeUserScenario, ({ userName, roomId }) => {
        // Setup environment
        const env = setupClientEnvironment();
        const { document, socket } = env;
        const app = createAppFunctions(env);

        // Set the name field
        document.getElementById('name').value = userName;

        // Simulate user visiting a room link
        app.setCurrentRoom(roomId);
        app.setModKey(null);

        // Initial connection
        socket.simulateConnect();

        // User clicks join button
        app.handleJoinClick();

        // Verify join was attempted
        const joinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
        
        if (joinEvents.length === 0) {
          return false; // Join should be emitted
        }

        const joinEvent = joinEvents[0];
        
        // Verify the join event has correct data
        return joinEvent.data.roomId === roomId &&
               joinEvent.data.name === userName &&
               joinEvent.data.modKey === null;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirement 3.3**
   * 
   * Join button state: Join button and name field disabled after successful join
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code (baseline behavior)
   */
  it('join button and name field disabled after successful join', () => {
    fc.assert(
      fc.property(arbFirstTimeUserScenario, ({ userName, roomId }) => {
        // Setup environment
        const env = setupClientEnvironment();
        const { document, socket } = env;
        const app = createAppFunctions(env);

        // Set the name field
        document.getElementById('name').value = userName;

        // Simulate user visiting a room link
        app.setCurrentRoom(roomId);
        app.setModKey(null);

        // Initial connection
        socket.simulateConnect();

        // User clicks join button
        app.handleJoinClick();

        // Verify join button is disabled after click
        const joinButtonDisabledAfterClick = app.isJoinButtonDisabled();
        const nameFieldDisabledAfterClick = app.isNameFieldDisabled();

        // Simulate server accepting the join
        socket.trigger('room:state', {
          roomId: roomId,
          users: { [socket.id]: { name: userName, vote: null } },
          youAreModerator: false,
          phase: 'voting',
          deck: ['1', '2', '3', '5', '8'],
          story: { title: 'Test Story', desc: '', finalPoints: null },
          storyQueue: [],
          activeStoryId: null,
          mySocketId: socket.id
        });

        // Verify join button and name field remain disabled after successful join
        const joinButtonDisabledAfterState = app.isJoinButtonDisabled();
        const nameFieldDisabledAfterState = app.isNameFieldDisabled();

        // Both should be disabled after join
        return joinButtonDisabledAfterClick && 
               nameFieldDisabledAfterClick &&
               joinButtonDisabledAfterState &&
               nameFieldDisabledAfterState;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirement 3.4**
   * 
   * Multiple user sessions: Each user maintains separate session state
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code (baseline behavior)
   */
  it('each user maintains separate session state', () => {
    fc.assert(
      fc.property(
        arbUserName,
        arbUserName,
        arbRoomId,
        (userName1, userName2, roomId) => {
          // Ensure different user names
          if (userName1 === userName2) return true; // Skip if same name

          // Setup environment for user 1
          const env1 = setupClientEnvironment();
          const app1 = createAppFunctions(env1);
          env1.document.getElementById('name').value = userName1;
          app1.setCurrentRoom(roomId);
          app1.setModKey(null);

          // Setup environment for user 2 (separate sessionStorage)
          const env2 = setupClientEnvironment();
          const app2 = createAppFunctions(env2);
          env2.document.getElementById('name').value = userName2;
          app2.setCurrentRoom(roomId);
          app2.setModKey(null);

          // User 1 connects and joins
          env1.socket.simulateConnect();
          app1.handleJoinClick();
          env1.socket.trigger('room:state', {
            roomId: roomId,
            users: { [env1.socket.id]: { name: userName1, vote: null } },
            youAreModerator: false,
            phase: 'voting',
            deck: ['1', '2', '3', '5', '8'],
            story: { title: 'Test Story', desc: '', finalPoints: null },
            storyQueue: [],
            activeStoryId: null,
            mySocketId: env1.socket.id
          });

          // User 2 connects and joins
          env2.socket.simulateConnect();
          app2.handleJoinClick();
          env2.socket.trigger('room:state', {
            roomId: roomId,
            users: { 
              [env1.socket.id]: { name: userName1, vote: null },
              [env2.socket.id]: { name: userName2, vote: null }
            },
            youAreModerator: false,
            phase: 'voting',
            deck: ['1', '2', '3', '5', '8'],
            story: { title: 'Test Story', desc: '', finalPoints: null },
            storyQueue: [],
            activeStoryId: null,
            mySocketId: env2.socket.id
          });

          // Verify both users have separate session states
          const user1Joined = app1.isUserJoined();
          const user2Joined = app2.isUserJoined();
          
          const user1SessionStored = app1.isAlreadyJoined();
          const user2SessionStored = app2.isAlreadyJoined();

          // Both users should have their own separate session state
          return user1Joined && user2Joined && user1SessionStored && user2SessionStored;
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * **Validates: Requirement 3.1**
   * 
   * Concrete test: First-time user "Charlie" visiting room "TEST123" sees enabled controls
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code
   */
  it('concrete case: first-time user Charlie sees enabled join button', () => {
    const env = setupClientEnvironment();
    const { document, socket } = env;
    const app = createAppFunctions(env);

    const userName = 'Charlie';
    const roomId = 'TEST123';

    // Set the name field
    document.getElementById('name').value = userName;

    // Simulate first-time user
    app.setCurrentRoom(roomId);
    app.setModKey(null);

    // Initial connection
    socket.simulateConnect();

    // Verify join button is enabled
    expect(app.isJoinButtonDisabled()).toBe(false);
    expect(app.isNameFieldDisabled()).toBe(false);
  });

  /**
   * **Validates: Requirement 3.2**
   * 
   * Concrete test: Facilitator "Dave" with modKey auto-rejoins after disconnect
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code
   */
  it('concrete case: facilitator Dave auto-rejoins after disconnect', () => {
    const env = setupClientEnvironment();
    const { document, socket } = env;
    const app = createAppFunctions(env);

    const facilitatorName = 'Dave';
    const roomId = 'ROOM456';
    const modKey = 'facilitator-key-123';

    // Set the name field
    document.getElementById('name').value = facilitatorName;

    // Simulate facilitator
    app.setCurrentRoom(roomId);
    app.setModKey(modKey);

    // Initial connection
    socket.simulateConnect();

    // Verify facilitator auto-join
    const initialJoinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
    expect(initialJoinEvents.length).toBeGreaterThan(0);

    // Simulate server accepting the join
    socket.trigger('room:state', {
      roomId: roomId,
      users: { [socket.id]: { name: facilitatorName, vote: null, isModerator: true } },
      youAreModerator: true,
      phase: 'voting',
      deck: ['1', '2', '3', '5', '8'],
      story: { title: 'Test Story', desc: '', finalPoints: null },
      storyQueue: [],
      activeStoryId: null,
      mySocketId: socket.id
    });

    // Clear events
    socket.clearEmittedEvents();

    // Simulate disconnect and reconnect
    socket.simulateDisconnect('transport close');
    socket.recovered = false;
    socket.simulateConnect();

    // Verify facilitator auto-rejoin
    const rejoinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
    expect(rejoinEvents.length).toBeGreaterThan(0);
    
    const rejoinEvent = rejoinEvents[0];
    expect(rejoinEvent.data.roomId).toBe(roomId);
    expect(rejoinEvent.data.modKey).toBe(modKey);
    expect(rejoinEvent.data.name).toBe(facilitatorName);
  });

  /**
   * **Validates: Requirement 3.3**
   * 
   * Concrete test: User "Eve" can manually join room "MANUAL789"
   * 
   * **EXPECTED OUTCOME**: This test PASSES on unfixed code
   */
  it('concrete case: user Eve can manually join room', () => {
    const env = setupClientEnvironment();
    const { document, socket } = env;
    const app = createAppFunctions(env);

    const userName = 'Eve';
    const roomId = 'MANUAL789';

    // Set the name field
    document.getElementById('name').value = userName;

    // Simulate user
    app.setCurrentRoom(roomId);
    app.setModKey(null);

    // Initial connection
    socket.simulateConnect();

    // User clicks join button
    app.handleJoinClick();

    // Verify join was attempted
    const joinEvents = socket.getEmittedEvents().filter(e => e.event === 'room:join');
    expect(joinEvents.length).toBeGreaterThan(0);
    
    const joinEvent = joinEvents[0];
    expect(joinEvent.data.roomId).toBe(roomId);
    expect(joinEvent.data.name).toBe(userName);
    expect(joinEvent.data.modKey).toBe(null);
  });
});
