/**
 * Event Listener Analyzer
 * 
 * Analyzes DOM event listeners in JavaScript files to identify:
 * - addEventListener() calls without corresponding removeEventListener()
 * - Anonymous functions that prevent proper cleanup
 * - Listeners attached before existence checks
 * - Duplicate event listener registrations
 * 
 * Validates Requirement 6.1, 6.2, 6.3, 6.5: Event handler memory leak detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseFile, traverse } from '../parser.js';
import { createFinding } from '../models.js';

/**
 * Extract all addEventListener calls from JavaScript file
 * @param {string} jsFilePath - Path to JavaScript file
 * @returns {Array<{target: string, event: string, isAnonymous: boolean, line: number, column: number, code: string}>}
 */
export function extractAddEventListeners(jsFilePath) {
  const code = fs.readFileSync(jsFilePath, 'utf-8');
  const ast = parseFile(jsFilePath);
  const listeners = [];
  const lines = code.split('\n');
  
  traverse(ast, {
    CallExpression(node) {
      processEventListener(node, lines, listeners);
    },
    OptionalCallExpression(node) {
      // Handle optional chaining: element?.addEventListener(...)
      processEventListener(node, lines, listeners, true);
    }
  });
  
  return listeners;
}

/**
 * Process an event listener node (CallExpression or OptionalCallExpression)
 * @param {Object} node - AST node
 * @param {Array} lines - Source code lines
 * @param {Array} listeners - Array to append listeners to
 * @param {boolean} isOptional - Whether this uses optional chaining
 */
function processEventListener(node, lines, listeners, isOptional = false) {
  // Check for addEventListener pattern (including optional chaining)
  // The callee might be MemberExpression or OptionalMemberExpression
  const callee = node.callee;
  const isMember = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression';
  
  if (isMember &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'addEventListener') {
    
    // Extract target (element/object)
    let target = '<unknown>';
    if (callee.object.type === 'Identifier') {
      target = callee.object.name;
    } else if (callee.object.type === 'CallExpression' || callee.object.type === 'OptionalCallExpression') {
      // Handle cases like el('id').addEventListener
      if (callee.object.callee && callee.object.callee.type === 'Identifier') {
        target = `${callee.object.callee.name}(...)`;
      }
    } else if (callee.object.type === 'MemberExpression' || callee.object.type === 'OptionalMemberExpression') {
      // Handle cases like document.body.addEventListener
      target = 'document';
    }
    
    // Extract event type
    let event = '<unknown>';
    if (node.arguments.length > 0 && node.arguments[0].type === 'StringLiteral') {
      event = node.arguments[0].value;
    }
    
    // Check if handler is anonymous
    let isAnonymous = false;
    let handlerName = '<unknown>';
    if (node.arguments.length > 1) {
      const handler = node.arguments[1];
      if (handler.type === 'ArrowFunctionExpression' || 
          handler.type === 'FunctionExpression') {
        isAnonymous = true;
        handlerName = '<anonymous>';
      } else if (handler.type === 'Identifier') {
        isAnonymous = false;
        handlerName = handler.name;
      }
    }
    
    // Check if there's an existence check (optional chaining or if statement)
    let hasExistenceCheck = isOptional || callee.optional || callee.type === 'OptionalMemberExpression' || false;
    
    // Get code snippet
    const line = node.loc ? node.loc.start.line : 0;
    const snippetLine = lines[line - 1] || '';
    
    listeners.push({
      target,
      event,
      isAnonymous,
      handlerName,
      hasExistenceCheck,
      line,
      column: node.loc ? node.loc.start.column : 0,
      code: snippetLine.trim()
    });
  }
}

/**
 * Extract all removeEventListener calls from JavaScript file
 * @param {string} jsFilePath - Path to JavaScript file
 * @returns {Array<{target: string, event: string, handlerName: string, line: number, column: number}>}
 */
export function extractRemoveEventListeners(jsFilePath) {
  const code = fs.readFileSync(jsFilePath, 'utf-8');
  const ast = parseFile(jsFilePath);
  const removals = [];
  
  traverse(ast, {
    CallExpression(node) {
      processRemoveEventListener(node, removals);
    },
    OptionalCallExpression(node) {
      processRemoveEventListener(node, removals);
    }
  });
  
  return removals;
}

/**
 * Process a removeEventListener node
 * @param {Object} node - AST node
 * @param {Array} removals - Array to append removals to
 */
function processRemoveEventListener(node, removals) {
  // Check for removeEventListener pattern
  const callee = node.callee;
  const isMember = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression';
  
  if (isMember &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'removeEventListener') {
    
    // Extract target
    let target = '<unknown>';
    if (callee.object.type === 'Identifier') {
      target = callee.object.name;
    } else if (callee.object.type === 'MemberExpression' || callee.object.type === 'OptionalMemberExpression') {
      target = 'document';
    }
    
    // Extract event type
    let event = '<unknown>';
    if (node.arguments.length > 0 && node.arguments[0].type === 'StringLiteral') {
      event = node.arguments[0].value;
    }
    
    // Extract handler name
    let handlerName = '<unknown>';
    if (node.arguments.length > 1 && node.arguments[1].type === 'Identifier') {
      handlerName = node.arguments[1].name;
    }
    
    removals.push({
      target,
      event,
      handlerName,
      line: node.loc ? node.loc.start.line : 0,
      column: node.loc ? node.loc.start.column : 0
    });
  }
}

/**
 * Analyze event listeners for potential issues
 * @param {string} jsFilePath - Path to JavaScript file
 * @returns {Array<Finding>} Array of findings
 */
export function analyzeEventListeners(jsFilePath) {
  const additions = extractAddEventListeners(jsFilePath);
  const removals = extractRemoveEventListeners(jsFilePath);
  const findings = [];
  
  // Track which listeners have corresponding removals
  const removalMap = new Map();
  removals.forEach(removal => {
    const key = `${removal.target}:${removal.event}:${removal.handlerName}`;
    removalMap.set(key, removal);
  });
  
  // Check each addEventListener for issues
  additions.forEach(listener => {
    const { target, event, isAnonymous, handlerName, hasExistenceCheck, line, column, code } = listener;
    
    // Issue 1: Anonymous function that can't be cleaned up
    if (isAnonymous) {
      findings.push(createFinding({
        category: 'event',
        subcategory: 'anonymous-event-handler',
        severity: 'moderate',
        effort: 'medium',
        impact: 50,
        file: jsFilePath,
        line,
        column,
        description: `Event listener uses anonymous function for '${event}' event on ${target}, preventing proper cleanup`,
        recommendation: `Convert to named function to enable removeEventListener() cleanup`,
        codeSnippet: code,
        relatedFindings: []
      }));
    }
    
    // Issue 2: No corresponding removeEventListener (only for named functions)
    if (!isAnonymous) {
      const key = `${target}:${event}:${handlerName}`;
      if (!removalMap.has(key)) {
        findings.push(createFinding({
          category: 'event',
          subcategory: 'missing-event-cleanup',
          severity: 'moderate',
          effort: 'quick-win',
          impact: 60,
          file: jsFilePath,
          line,
          column,
          description: `Event listener for '${event}' event on ${target} is added but never removed, potential memory leak`,
          recommendation: `Add removeEventListener('${event}', ${handlerName}) when the element is destroyed or no longer needed`,
          codeSnippet: code,
          relatedFindings: []
        }));
      }
    }
    
    // Issue 3: Missing existence check (if not using optional chaining)
    if (!hasExistenceCheck && target !== 'document' && target !== 'window') {
      findings.push(createFinding({
        category: 'event',
        subcategory: 'missing-existence-check',
        severity: 'minor',
        effort: 'quick-win',
        impact: 30,
        file: jsFilePath,
        line,
        column,
        description: `Event listener attached to ${target} without existence check, may cause runtime error if element doesn't exist`,
        recommendation: `Add existence check or use optional chaining: ${target}?.addEventListener(...)`,
        codeSnippet: code,
        relatedFindings: []
      }));
    }
  });
  
  // Check for duplicate listener registrations
  const listenerKeys = new Map();
  additions.forEach(listener => {
    const key = `${listener.target}:${listener.event}:${listener.handlerName}`;
    if (!listenerKeys.has(key)) {
      listenerKeys.set(key, []);
    }
    listenerKeys.get(key).push(listener);
  });
  
  listenerKeys.forEach((listeners, key) => {
    if (listeners.length > 1) {
      const [target, event, handlerName] = key.split(':');
      const lines = listeners.map(l => l.line).join(', ');
      
      findings.push(createFinding({
        category: 'event',
        subcategory: 'duplicate-event-listener',
        severity: 'minor',
        effort: 'quick-win',
        impact: 40,
        file: jsFilePath,
        line: listeners[0].line,
        column: listeners[0].column,
        description: `Event listener for '${event}' on ${target} registered ${listeners.length} times (lines: ${lines})`,
        recommendation: `Remove duplicate registrations or ensure single registration with conditional logic`,
        codeSnippet: listeners[0].code,
        relatedFindings: []
      }));
    }
  });
  
  return findings;
}

/**
 * Analyze event listeners across multiple JavaScript files
 * @param {Object} options - Analysis options
 * @param {string[]} options.files - Array of file paths to analyze
 * @returns {Array<Finding>} Array of findings
 */
export function analyzeEventListenersInFiles(options = {}) {
  const files = options.files || [path.join(process.cwd(), 'public', 'app.js')];
  const allFindings = [];
  
  files.forEach(file => {
    if (fs.existsSync(file)) {
      const findings = analyzeEventListeners(file);
      allFindings.push(...findings);
    }
  });
  
  return allFindings;
}

/**
 * Generate a summary report of event listener analysis
 * @param {Array<Finding>} findings - Array of findings
 * @returns {Object} Summary report
 */
export function generateEventListenerSummary(findings) {
  const summary = {
    totalIssues: findings.length,
    anonymousFunctions: 0,
    missingCleanup: 0,
    missingExistenceChecks: 0,
    duplicateListeners: 0,
    eventTypes: new Set(),
    targets: new Set()
  };
  
  findings.forEach(finding => {
    switch (finding.subcategory) {
      case 'anonymous-event-handler':
        summary.anonymousFunctions++;
        break;
      case 'missing-event-cleanup':
        summary.missingCleanup++;
        break;
      case 'missing-existence-check':
        summary.missingExistenceChecks++;
        break;
      case 'duplicate-event-listener':
        summary.duplicateListeners++;
        break;
    }
    
    // Extract event type from description
    const eventMatch = finding.description.match(/for '([^']+)' event/);
    if (eventMatch) {
      summary.eventTypes.add(eventMatch[1]);
    }
    
    // Extract target from description
    const targetMatch = finding.description.match(/on (\w+)/);
    if (targetMatch) {
      summary.targets.add(targetMatch[1]);
    }
  });
  
  return {
    ...summary,
    eventTypes: Array.from(summary.eventTypes),
    targets: Array.from(summary.targets)
  };
}

/**
 * Extract listener statistics (added vs removed)
 * @param {string} jsFilePath - Path to JavaScript file
 * @returns {Object} Statistics
 */
export function getListenerStatistics(jsFilePath) {
  const additions = extractAddEventListeners(jsFilePath);
  const removals = extractRemoveEventListeners(jsFilePath);
  
  const stats = {
    totalAddEventListener: additions.length,
    totalRemoveEventListener: removals.length,
    anonymousHandlers: additions.filter(l => l.isAnonymous).length,
    namedHandlers: additions.filter(l => !l.isAnonymous).length,
    withExistenceCheck: additions.filter(l => l.hasExistenceCheck).length,
    withoutExistenceCheck: additions.filter(l => !l.hasExistenceCheck).length,
    eventTypes: [...new Set(additions.map(l => l.event))],
    targets: [...new Set(additions.map(l => l.target))]
  };
  
  return stats;
}
