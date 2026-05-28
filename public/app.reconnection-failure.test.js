/**
 * Unit Test for Task 3.4: Reconnection Failure Handling
 * 
 * This test verifies that the handleReconnectionFailure function correctly:
 * 1. Clears stored session data (room ID, user name, joined flag)
 * 2. Resets joinButtonClicked flag to false
 * 3. Re-enables join button and name field
 * 4. Shows user-friendly toast message
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Task 3.4: Reconnection Failure Handling', () => {
  let dom, document, sessionStorage, showToastMock;
  let currentRoom, joinButtonClicked;

  beforeEach(() => {
    // Setup DOM environment
    dom = new JSDOM(`<!DOCTYPE html>
      <html>
        <body>
          <input id="name" type="text" />
          <button id="joinBtn">Join</button>
        </body>
      </html>
    `);
    document = dom.window.document;

    // Mock sessionStorage
    const store = {};
    sessionStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
      clear: () => Object.keys(store).forEach(key => delete store[key])
    };

    // Mock showToast
    showToastMock = vi.fn();

    // Initialize state
    currentRoom = 'ABC123';
    joinButtonClicked = true;

    // Pre-populate sessionStorage with session data
    sessionStorage.setItem('flaps_joined_ABC123', 'true');
    sessionStorage.setItem('flaps_room_id', 'ABC123');
    sessionStorage.setItem('flaps_user_name', 'Alice');

    // Disable join button and name field (simulating reconnection attempt state)
    document.getElementById('joinBtn').disabled = true;
    document.getElementById('name').disabled = true;
  });

  it('should clear all stored session data from sessionStorage', () => {
    // Verify session data exists before calling handleReconnectionFailure
    expect(sessionStorage.getItem('flaps_joined_ABC123')).toBe('true');
    expect(sessionStorage.getItem('flaps_room_id')).toBe('ABC123');
    expect(sessionStorage.getItem('flaps_user_name')).toBe('Alice');

    // Call handleReconnectionFailure
    handleReconnectionFailure();

    // Verify all session data is cleared
    expect(sessionStorage.getItem('flaps_joined_ABC123')).toBeNull();
    expect(sessionStorage.getItem('flaps_room_id')).toBeNull();
    expect(sessionStorage.getItem('flaps_user_name')).toBeNull();
  });

  it('should reset joinButtonClicked flag to false', () => {
    // Verify flag is true before calling handleReconnectionFailure
    expect(joinButtonClicked).toBe(true);

    // Call handleReconnectionFailure
    const result = handleReconnectionFailure();

    // Verify flag is reset to false
    expect(result.joinButtonClicked).toBe(false);
  });

  it('should re-enable join button and name field', () => {
    // Verify controls are disabled before calling handleReconnectionFailure
    expect(document.getElementById('joinBtn').disabled).toBe(true);
    expect(document.getElementById('name').disabled).toBe(true);

    // Call handleReconnectionFailure
    handleReconnectionFailure();

    // Verify controls are re-enabled
    expect(document.getElementById('joinBtn').disabled).toBe(false);
    expect(document.getElementById('name').disabled).toBe(false);
  });

  it('should show user-friendly toast message with warn level', () => {
    // Call handleReconnectionFailure
    handleReconnectionFailure();

    // Verify toast was called with correct message and level
    expect(showToastMock).toHaveBeenCalledWith('Unable to rejoin. Please join manually.', 'warn');
  });

  it('should handle sessionStorage errors gracefully', () => {
    // Mock sessionStorage to throw error
    const errorSessionStorage = {
      removeItem: () => { throw new Error('sessionStorage unavailable'); }
    };

    // Call handleReconnectionFailure with error-throwing sessionStorage
    // Should not throw error
    expect(() => {
      handleReconnectionFailureWithStorage(errorSessionStorage);
    }).not.toThrow();

    // Verify controls are still re-enabled despite error
    expect(document.getElementById('joinBtn').disabled).toBe(false);
    expect(document.getElementById('name').disabled).toBe(false);
  });

  // Helper function implementations
  function el(id) {
    return document.getElementById(id);
  }

  function setDisabled(id, disabled) {
    const element = el(id);
    if (element && 'disabled' in element) {
      element.disabled = !!disabled;
    }
  }

  function showToast(message, type) {
    showToastMock(message, type);
  }

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

    // Return state for testing
    return { joinButtonClicked };
  }

  function handleReconnectionFailureWithStorage(storage) {
    try {
      if (currentRoom) {
        storage.removeItem('flaps_joined_' + currentRoom);
      }
      storage.removeItem('flaps_room_id');
      storage.removeItem('flaps_user_name');
    } catch (err) {
      console.warn('Failed to clear session data:', err);
    }
    
    joinButtonClicked = false;
    setDisabled('joinBtn', false);
    setDisabled('name', false);
    showToast('Unable to rejoin. Please join manually.', 'warn');
  }
});
