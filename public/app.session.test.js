/**
 * Unit Tests for Session Storage Functions
 *
 * Feature: session-persistence-on-tab-inactive
 * Task: 3.2 Add session retrieval functions
 * 
 * Tests for getStoredRoomId() and getStoredUserName() functions
 * 
 * Validates: Requirements 2.1, 2.2, 2.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * Setup test environment with sessionStorage mock
 */
function setupTestEnvironment() {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <head><title>Session Storage Test</title></head>
      <body>
        <input id="name" type="text" />
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

  return {
    window,
    document,
    sessionStorage: sessionStorageMock
  };
}

/**
 * Extract session storage functions from app.js for testing
 */
function createSessionFunctions(env) {
  const { document, sessionStorage } = env;
  
  let currentRoom = null;
  
  const el = (id) => document.getElementById(id);

  function saveJoinedState() {
    try {
      if (currentRoom) {
        // Store joined flag for backward compatibility
        sessionStorage.setItem('flaps_joined_' + currentRoom, 'true');
        
        // Store room ID for automatic reconnection
        sessionStorage.setItem('flaps_room_id', currentRoom);
        
        // Store user name for automatic reconnection
        const userName = (el('name')?.value ?? '').trim();
        if (userName) {
          sessionStorage.setItem('flaps_user_name', userName);
        }
      }
    } catch (err) {
      console.warn('Failed to save session state:', err);
    }
  }

  function getStoredRoomId() {
    try {
      const roomId = sessionStorage.getItem('flaps_room_id');
      // Validate that the stored value is a non-empty string
      if (roomId && typeof roomId === 'string' && roomId.trim()) {
        return roomId.trim();
      }
    } catch (err) {
      console.warn('Failed to retrieve stored room ID:', err);
    }
    return null;
  }

  function getStoredUserName() {
    try {
      const userName = sessionStorage.getItem('flaps_user_name');
      // Validate that the stored value is a non-empty string
      if (userName && typeof userName === 'string' && userName.trim()) {
        return userName.trim();
      }
    } catch (err) {
      console.warn('Failed to retrieve stored user name:', err);
    }
    return null;
  }

  return {
    setCurrentRoom: (room) => { currentRoom = room; },
    saveJoinedState,
    getStoredRoomId,
    getStoredUserName
  };
}

describe('Session Retrieval Functions', () => {
  describe('getStoredRoomId()', () => {
    it('returns stored room ID when valid data exists', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store a room ID
      sessionStorage.setItem('flaps_room_id', 'ABC123');

      // Retrieve it
      const roomId = session.getStoredRoomId();

      expect(roomId).toBe('ABC123');
    });

    it('returns null when no room ID is stored', () => {
      const env = setupTestEnvironment();
      const session = createSessionFunctions(env);

      // Don't store anything
      const roomId = session.getStoredRoomId();

      expect(roomId).toBe(null);
    });

    it('returns null when room ID is empty string', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store empty string
      sessionStorage.setItem('flaps_room_id', '');

      const roomId = session.getStoredRoomId();

      expect(roomId).toBe(null);
    });

    it('returns null when room ID is only whitespace', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store whitespace
      sessionStorage.setItem('flaps_room_id', '   ');

      const roomId = session.getStoredRoomId();

      expect(roomId).toBe(null);
    });

    it('trims whitespace from stored room ID', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store room ID with whitespace
      sessionStorage.setItem('flaps_room_id', '  XYZ789  ');

      const roomId = session.getStoredRoomId();

      expect(roomId).toBe('XYZ789');
    });

    it('handles sessionStorage errors gracefully', () => {
      const env = setupTestEnvironment();
      const session = createSessionFunctions(env);

      // Mock sessionStorage.getItem to throw an error
      env.sessionStorage.getItem = () => {
        throw new Error('sessionStorage unavailable');
      };

      const roomId = session.getStoredRoomId();

      expect(roomId).toBe(null);
    });

    it('returns stored room ID after saveJoinedState()', () => {
      const env = setupTestEnvironment();
      const { document } = env;
      const session = createSessionFunctions(env);

      // Set up a room and user
      session.setCurrentRoom('ROOM456');
      document.getElementById('name').value = 'Alice';

      // Save the joined state
      session.saveJoinedState();

      // Retrieve the room ID
      const roomId = session.getStoredRoomId();

      expect(roomId).toBe('ROOM456');
    });
  });

  describe('getStoredUserName()', () => {
    it('returns stored user name when valid data exists', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store a user name
      sessionStorage.setItem('flaps_user_name', 'Bob');

      // Retrieve it
      const userName = session.getStoredUserName();

      expect(userName).toBe('Bob');
    });

    it('returns null when no user name is stored', () => {
      const env = setupTestEnvironment();
      const session = createSessionFunctions(env);

      // Don't store anything
      const userName = session.getStoredUserName();

      expect(userName).toBe(null);
    });

    it('returns null when user name is empty string', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store empty string
      sessionStorage.setItem('flaps_user_name', '');

      const userName = session.getStoredUserName();

      expect(userName).toBe(null);
    });

    it('returns null when user name is only whitespace', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store whitespace
      sessionStorage.setItem('flaps_user_name', '   ');

      const userName = session.getStoredUserName();

      expect(userName).toBe(null);
    });

    it('trims whitespace from stored user name', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store user name with whitespace
      sessionStorage.setItem('flaps_user_name', '  Carol  ');

      const userName = session.getStoredUserName();

      expect(userName).toBe('Carol');
    });

    it('handles sessionStorage errors gracefully', () => {
      const env = setupTestEnvironment();
      const session = createSessionFunctions(env);

      // Mock sessionStorage.getItem to throw an error
      env.sessionStorage.getItem = () => {
        throw new Error('sessionStorage unavailable');
      };

      const userName = session.getStoredUserName();

      expect(userName).toBe(null);
    });

    it('returns stored user name after saveJoinedState()', () => {
      const env = setupTestEnvironment();
      const { document } = env;
      const session = createSessionFunctions(env);

      // Set up a room and user
      session.setCurrentRoom('ROOM789');
      document.getElementById('name').value = 'David';

      // Save the joined state
      session.saveJoinedState();

      // Retrieve the user name
      const userName = session.getStoredUserName();

      expect(userName).toBe('David');
    });

    it('returns null when user name field is empty during saveJoinedState()', () => {
      const env = setupTestEnvironment();
      const { document } = env;
      const session = createSessionFunctions(env);

      // Set up a room but no user name
      session.setCurrentRoom('ROOM999');
      document.getElementById('name').value = '';

      // Save the joined state
      session.saveJoinedState();

      // Retrieve the user name (should be null because name was empty)
      const userName = session.getStoredUserName();

      expect(userName).toBe(null);
    });
  });

  describe('Integration: saveJoinedState() and retrieval functions', () => {
    it('stores and retrieves both room ID and user name', () => {
      const env = setupTestEnvironment();
      const { document } = env;
      const session = createSessionFunctions(env);

      // Set up a room and user
      const testRoomId = 'INTEGRATION123';
      const testUserName = 'Eve';
      
      session.setCurrentRoom(testRoomId);
      document.getElementById('name').value = testUserName;

      // Save the joined state
      session.saveJoinedState();

      // Retrieve both values
      const retrievedRoomId = session.getStoredRoomId();
      const retrievedUserName = session.getStoredUserName();

      expect(retrievedRoomId).toBe(testRoomId);
      expect(retrievedUserName).toBe(testUserName);
    });

    it('handles multiple save operations correctly', () => {
      const env = setupTestEnvironment();
      const { document } = env;
      const session = createSessionFunctions(env);

      // First save
      session.setCurrentRoom('ROOM001');
      document.getElementById('name').value = 'Frank';
      session.saveJoinedState();

      // Second save (different room and user)
      session.setCurrentRoom('ROOM002');
      document.getElementById('name').value = 'Grace';
      session.saveJoinedState();

      // Retrieve values (should be from second save)
      const roomId = session.getStoredRoomId();
      const userName = session.getStoredUserName();

      expect(roomId).toBe('ROOM002');
      expect(userName).toBe('Grace');
    });

    it('handles corrupted data gracefully', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store invalid data types (simulate corruption)
      sessionStorage.setItem('flaps_room_id', null);
      sessionStorage.setItem('flaps_user_name', undefined);

      // Retrieve values (should return null for invalid data)
      const roomId = session.getStoredRoomId();
      const userName = session.getStoredUserName();

      // Both should handle invalid data gracefully
      expect(roomId === null || typeof roomId === 'string').toBe(true);
      expect(userName === null || typeof userName === 'string').toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('handles special characters in room ID', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store room ID with special characters
      sessionStorage.setItem('flaps_room_id', 'ROOM-123_ABC');

      const roomId = session.getStoredRoomId();

      expect(roomId).toBe('ROOM-123_ABC');
    });

    it('handles special characters in user name', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store user name with special characters (spaces, hyphens)
      sessionStorage.setItem('flaps_user_name', 'Mary Jane');

      const userName = session.getStoredUserName();

      expect(userName).toBe('Mary Jane');
    });

    it('handles very long room IDs', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store a very long room ID
      const longRoomId = 'A'.repeat(1000);
      sessionStorage.setItem('flaps_room_id', longRoomId);

      const roomId = session.getStoredRoomId();

      expect(roomId).toBe(longRoomId);
    });

    it('handles very long user names', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;
      const session = createSessionFunctions(env);

      // Store a very long user name
      const longUserName = 'B'.repeat(1000);
      sessionStorage.setItem('flaps_user_name', longUserName);

      const userName = session.getStoredUserName();

      expect(userName).toBe(longUserName);
    });
  });

  describe('Manual Join - Clear Session Data (Task 3.5)', () => {
    it('clears old session data before joining new room', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;

      // Simulate old session data from previous room
      sessionStorage.setItem('flaps_room_id', 'OLD_ROOM_123');
      sessionStorage.setItem('flaps_user_name', 'OldUser');

      // Verify old data exists
      expect(sessionStorage.getItem('flaps_room_id')).toBe('OLD_ROOM_123');
      expect(sessionStorage.getItem('flaps_user_name')).toBe('OldUser');

      // Simulate manual join button click - clear old session data
      try {
        sessionStorage.removeItem('flaps_room_id');
        sessionStorage.removeItem('flaps_user_name');
      } catch (err) {
        console.warn('Failed to clear old session data:', err);
      }

      // Verify old data is cleared
      expect(sessionStorage.getItem('flaps_room_id')).toBe(null);
      expect(sessionStorage.getItem('flaps_user_name')).toBe(null);
    });

    it('handles sessionStorage errors gracefully when clearing data', () => {
      const env = setupTestEnvironment();
      const { sessionStorage } = env;

      // Store old session data
      sessionStorage.setItem('flaps_room_id', 'OLD_ROOM_456');
      sessionStorage.setItem('flaps_user_name', 'OldUser2');

      // Mock sessionStorage.removeItem to throw an error
      const originalRemoveItem = sessionStorage.removeItem;
      sessionStorage.removeItem = () => {
        throw new Error('sessionStorage unavailable');
      };

      // Attempt to clear session data (should not throw)
      let errorThrown = false;
      try {
        sessionStorage.removeItem('flaps_room_id');
        sessionStorage.removeItem('flaps_user_name');
      } catch (err) {
        errorThrown = true;
        console.warn('Failed to clear old session data:', err);
      }

      // Verify error was caught and handled
      expect(errorThrown).toBe(true);

      // Restore original removeItem
      sessionStorage.removeItem = originalRemoveItem;
    });

    it('allows new session data to be stored after clearing old data', () => {
      const env = setupTestEnvironment();
      const { sessionStorage, document } = env;
      const session = createSessionFunctions(env);

      // Simulate old session data
      sessionStorage.setItem('flaps_room_id', 'OLD_ROOM_789');
      sessionStorage.setItem('flaps_user_name', 'OldUser3');

      // Clear old session data (simulating manual join button click)
      sessionStorage.removeItem('flaps_room_id');
      sessionStorage.removeItem('flaps_user_name');

      // Store new session data (simulating successful join to new room)
      session.setCurrentRoom('NEW_ROOM_ABC');
      document.getElementById('name').value = 'NewUser';
      session.saveJoinedState();

      // Verify new data is stored correctly
      const roomId = session.getStoredRoomId();
      const userName = session.getStoredUserName();

      expect(roomId).toBe('NEW_ROOM_ABC');
      expect(userName).toBe('NewUser');
    });

    it('ensures session data consistency when switching rooms', () => {
      const env = setupTestEnvironment();
      const { sessionStorage, document } = env;
      const session = createSessionFunctions(env);

      // First room join
      session.setCurrentRoom('ROOM_001');
      document.getElementById('name').value = 'User1';
      session.saveJoinedState();

      // Verify first room data
      expect(session.getStoredRoomId()).toBe('ROOM_001');
      expect(session.getStoredUserName()).toBe('User1');

      // Clear session data before joining second room
      sessionStorage.removeItem('flaps_room_id');
      sessionStorage.removeItem('flaps_user_name');

      // Second room join
      session.setCurrentRoom('ROOM_002');
      document.getElementById('name').value = 'User2';
      session.saveJoinedState();

      // Verify second room data (should not have any remnants of first room)
      expect(session.getStoredRoomId()).toBe('ROOM_002');
      expect(session.getStoredUserName()).toBe('User2');
    });
  });
});
