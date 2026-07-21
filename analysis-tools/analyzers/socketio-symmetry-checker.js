/**
 * Socket.IO Event Symmetry Checker
 * 
 * Analyzes Socket.IO event symmetry between server.js and app.js:
 * - Finds all socket.emit() calls in both files
 * - Finds all socket.on() listeners in both files
 * - Identifies events emitted but not listened to
 * - Identifies listeners with no corresponding emitter
 * - Checks for typos in event names (similar names)
 * 
 * Requirements: 1.5, 4.2, 6.4
 */

import fs from 'fs';
import path from 'path';
import { parseFile, traverse } from '../parser.js';
import { createFinding } from '../models.js';

/**
 * Calculate Levenshtein distance between two strings
 * Used for detecting typos in event names
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Find similar event names that might be typos
 * @param {string} eventName - Event name to check
 * @param {string[]} allEvents - All event names
 * @returns {string[]} Similar event names
 */
function findSimilarEventNames(eventName, allEvents) {
  const similar = [];
  const threshold = 2; // Max edit distance to consider similar
  
  for (const other of allEvents) {
    if (eventName !== other) {
      const distance = levenshteinDistance(eventName, other);
      if (distance <= threshold) {
        similar.push(other);
      }
    }
  }
  
  return similar;
}

/**
 * Extract Socket.IO event operations from an AST
 * @param {Object} ast - Babel AST
 * @param {string} filePath - Path to the file being analyzed
 * @returns {Object} Object containing emits and listeners
 */
function extractSocketIOEvents(ast, filePath) {
  const emits = []; // { event, line, column, context }
  const listeners = []; // { event, line, column, context }
  
  traverse(ast, {
    CallExpression(node) {
      // Check for socket.emit() or io.emit() or s.emit()
      if (node.callee.type === 'MemberExpression' &&
          node.callee.property &&
          node.callee.property.name === 'emit') {
        
        // Get the event name (first argument)
        if (node.arguments.length > 0 && node.arguments[0].type === 'StringLiteral') {
          const eventName = node.arguments[0].value;
          const line = node.loc ? node.loc.start.line : 0;
          const column = node.loc ? node.loc.start.column : 0;
          
          // Determine context (what object is emitting)
          let context = 'unknown';
          if (node.callee.object) {
            if (node.callee.object.type === 'Identifier') {
              context = node.callee.object.name; // socket, io, s, etc.
              
              // Skip non-Socket.IO emitters (process, EventEmitter, etc.)
              const nonSocketIOObjects = ['process', 'events', 'emitter', 'EventEmitter'];
              if (nonSocketIOObjects.includes(context)) {
                return;
              }
            } else if (node.callee.object.type === 'MemberExpression') {
              // Handle io.to(room).emit() or io.in(room).emit()
              if (node.callee.object.property &&
                  (node.callee.object.property.name === 'to' ||
                   node.callee.object.property.name === 'in')) {
                context = 'broadcast';
              }
            }
          }
          
          emits.push({ event: eventName, line, column, context });
        }
      }
      
      // Check for socket.on() or io.on()
      if (node.callee.type === 'MemberExpression' &&
          node.callee.property &&
          node.callee.property.name === 'on') {
        
        // Get the event name (first argument)
        if (node.arguments.length > 0 && node.arguments[0].type === 'StringLiteral') {
          const eventName = node.arguments[0].value;
          const line = node.loc ? node.loc.start.line : 0;
          const column = node.loc ? node.loc.start.column : 0;
          
          // Determine context
          let context = 'unknown';
          if (node.callee.object) {
            if (node.callee.object.type === 'Identifier') {
              context = node.callee.object.name; // socket, io, etc.
              
              // Skip non-Socket.IO event listeners (process, EventEmitter, etc.)
              const nonSocketIOObjects = ['process', 'events', 'emitter', 'EventEmitter'];
              if (nonSocketIOObjects.includes(context)) {
                return;
              }
            }
          }
          
          listeners.push({ event: eventName, line, column, context });
        }
      }
    }
  });
  
  return { emits, listeners };
}

/**
 * Categorize Socket.IO events by direction
 * @param {Object} serverEvents - Events from server.js
 * @param {Object} clientEvents - Events from app.js
 * @returns {Object} Categorized events
 */
function categorizeEvents(serverEvents, clientEvents) {
  // Client-to-server events: emitted by client, listened by server
  const clientToServer = {
    emitted: new Set(clientEvents.emits.map(e => e.event)),
    listened: new Set(serverEvents.listeners.map(e => e.event))
  };
  
  // Server-to-client events: emitted by server, listened by client
  const serverToClient = {
    emitted: new Set(serverEvents.emits.map(e => e.event)),
    listened: new Set(clientEvents.listeners.map(e => e.event))
  };
  
  // Built-in Socket.IO events that don't need symmetry checks
  const builtInEvents = new Set([
    'connect',
    'connect_error',
    'disconnect',
    'disconnecting',
    'newListener',
    'removeListener',
    'connection'
  ]);
  
  return {
    clientToServer,
    serverToClient,
    builtInEvents
  };
}

/**
 * Analyze Socket.IO event symmetry
 * @param {string} projectRoot - Path to the project root
 * @returns {Array<Finding>} Array of findings for event symmetry issues
 */
export function analyzeSocketIOSymmetry(projectRoot) {
  const findings = [];
  
  // File paths
  const serverPath = path.join(projectRoot, 'server.js');
  const clientPath = path.join(projectRoot, 'public', 'app.js');
  
  // Read and parse files
  let serverAst, clientAst;
  try {
    serverAst = parseFile(serverPath);
    clientAst = parseFile(clientPath);
  } catch (error) {
    console.error('Error parsing files:', error.message);
    return findings;
  }
  
  // Extract events
  const serverEvents = extractSocketIOEvents(serverAst, serverPath);
  const clientEvents = extractSocketIOEvents(clientAst, clientPath);
  
  // Categorize by direction
  const { clientToServer, serverToClient, builtInEvents } = categorizeEvents(serverEvents, clientEvents);
  
  // Collect all unique event names for typo detection
  const allEventNames = new Set([
    ...clientToServer.emitted,
    ...clientToServer.listened,
    ...serverToClient.emitted,
    ...serverToClient.listened
  ]);
  
  // Remove built-in events from checks
  for (const builtIn of builtInEvents) {
    allEventNames.delete(builtIn);
  }
  
  const allEventNamesArray = Array.from(allEventNames);
  
  // Check client-to-server: events emitted by client but not listened by server
  for (const event of clientToServer.emitted) {
    if (builtInEvents.has(event)) continue;
    
    if (!clientToServer.listened.has(event)) {
      // Find the emit location in client code
      const emitInfo = clientEvents.emits.find(e => e.event === event);
      
      // Check for similar event names (potential typos)
      const similar = findSimilarEventNames(event, allEventNamesArray);
      const typoNote = similar.length > 0 
        ? ` Did you mean: ${similar.join(', ')}?`
        : '';
      
      findings.push(createFinding({
        category: 'event',
        subcategory: 'unhandled-client-event',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 60,
        file: clientPath,
        line: emitInfo ? emitInfo.line : 0,
        column: emitInfo ? emitInfo.column : 0,
        description: `Client emits '${event}' but server has no listener for this event.${typoNote}`,
        recommendation: `Add a socket.on('${event}', ...) listener in server.js or remove the unused emit from app.js`,
        codeSnippet: `socket.emit('${event}', ...)`
      }));
    }
  }
  
  // Check client-to-server: events listened by server but not emitted by client
  for (const event of clientToServer.listened) {
    if (builtInEvents.has(event)) continue;
    
    if (!clientToServer.emitted.has(event)) {
      // Find the listener location in server code
      const listenerInfo = serverEvents.listeners.find(e => e.event === event);
      
      // Check for similar event names
      const similar = findSimilarEventNames(event, allEventNamesArray);
      const typoNote = similar.length > 0 
        ? ` Did you mean: ${similar.join(', ')}?`
        : '';
      
      findings.push(createFinding({
        category: 'event',
        subcategory: 'orphaned-server-listener',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 50,
        file: serverPath,
        line: listenerInfo ? listenerInfo.line : 0,
        column: listenerInfo ? listenerInfo.column : 0,
        description: `Server listens for '${event}' but client never emits this event.${typoNote}`,
        recommendation: `Add a socket.emit('${event}', ...) call in app.js or remove the unused listener from server.js`,
        codeSnippet: `socket.on('${event}', ...)`
      }));
    }
  }
  
  // Check server-to-client: events emitted by server but not listened by client
  for (const event of serverToClient.emitted) {
    if (builtInEvents.has(event)) continue;
    
    if (!serverToClient.listened.has(event)) {
      // Find the emit location in server code
      const emitInfo = serverEvents.emits.find(e => e.event === event);
      
      // Check for similar event names
      const similar = findSimilarEventNames(event, allEventNamesArray);
      const typoNote = similar.length > 0 
        ? ` Did you mean: ${similar.join(', ')}?`
        : '';
      
      findings.push(createFinding({
        category: 'event',
        subcategory: 'unhandled-server-event',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 60,
        file: serverPath,
        line: emitInfo ? emitInfo.line : 0,
        column: emitInfo ? emitInfo.column : 0,
        description: `Server emits '${event}' but client has no listener for this event.${typoNote}`,
        recommendation: `Add a socket.on('${event}', ...) listener in app.js or remove the unused emit from server.js`,
        codeSnippet: `socket.emit('${event}', ...)`
      }));
    }
  }
  
  // Check server-to-client: events listened by client but not emitted by server
  for (const event of serverToClient.listened) {
    if (builtInEvents.has(event)) continue;
    
    if (!serverToClient.emitted.has(event)) {
      // Find the listener location in client code
      const listenerInfo = clientEvents.listeners.find(e => e.event === event);
      
      // Check for similar event names
      const similar = findSimilarEventNames(event, allEventNamesArray);
      const typoNote = similar.length > 0 
        ? ` Did you mean: ${similar.join(', ')}?`
        : '';
      
      findings.push(createFinding({
        category: 'event',
        subcategory: 'orphaned-client-listener',
        severity: 'minor',
        effort: 'quick-win',
        impact: 40,
        file: clientPath,
        line: listenerInfo ? listenerInfo.line : 0,
        column: listenerInfo ? listenerInfo.column : 0,
        description: `Client listens for '${event}' but server never emits this event.${typoNote}`,
        recommendation: `Add a socket.emit('${event}', ...) call in server.js or remove the unused listener from app.js`,
        codeSnippet: `socket.on('${event}', ...)`
      }));
    }
  }
  
  return findings;
}

/**
 * Generate a summary report of Socket.IO event symmetry analysis
 * @param {Array<Finding>} findings - Findings from Socket.IO analysis
 * @returns {Object} Summary report
 */
export function generateSocketIOSymmetrySummary(findings) {
  const bySubcategory = {
    'unhandled-client-event': findings.filter(f => f.subcategory === 'unhandled-client-event').length,
    'orphaned-server-listener': findings.filter(f => f.subcategory === 'orphaned-server-listener').length,
    'unhandled-server-event': findings.filter(f => f.subcategory === 'unhandled-server-event').length,
    'orphaned-client-listener': findings.filter(f => f.subcategory === 'orphaned-client-listener').length
  };
  
  return {
    totalIssues: findings.length,
    bySubcategory,
    bySeverity: {
      critical: findings.filter(f => f.severity === 'critical').length,
      moderate: findings.filter(f => f.severity === 'moderate').length,
      minor: findings.filter(f => f.severity === 'minor').length
    },
    totalImpact: findings.reduce((sum, f) => sum + f.impact, 0),
    averageImpact: findings.length > 0 
      ? Math.round(findings.reduce((sum, f) => sum + f.impact, 0) / findings.length)
      : 0
  };
}

export default {
  analyzeSocketIOSymmetry,
  generateSocketIOSymmetrySummary
};
