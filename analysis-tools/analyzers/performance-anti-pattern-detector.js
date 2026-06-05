/**
 * Performance Anti-Pattern Detector - Task 4.4
 * 
 * Detects performance anti-patterns in JavaScript code:
 * - DOM queries inside loops
 * - Repeated querySelector/getElementById calls for same element
 * - Unnecessary array iterations
 * - Inefficient string concatenation in loops
 * - Missing debounce/throttle on frequent events
 * - Synchronous operations that could be async
 * - Redundant re-renders from unchanged state
 * - Missing early-return opportunities (delegates to nesting-depth-analyzer)
 * 
 * Uses AST parser infrastructure from analysis-tools/parser.js
 * Outputs findings to reports/ directory
 * 
 * Validates Requirements 2.4, 2.5, 2.6
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseFile, traverse, extractSnippet, getNestingDepth } from '../parser.js';
import { createFinding } from '../models.js';

/**
 * Analyze files for performance anti-patterns
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object} Analysis results with findings
 */
export function analyzePerformanceAntiPatterns(filePaths) {
  const results = {
    findings: [],
    patterns: {
      domQueriesInLoops: [],
      repeatedDOMQueries: [],
      unnecessaryIterations: [],
      inefficientStringConcat: [],
      missingDebounceThrottle: [],
      syncOperationsThatCouldBeAsync: [],
      redundantReRenders: []
    }
  };

  for (const filePath of filePaths) {
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = parseFile(filePath);
      
      // Detect various anti-patterns
      detectDOMQueriesInLoops(ast, filePath, code, results);
      detectRepeatedDOMQueries(ast, filePath, code, results);
      detectUnnecessaryIterations(ast, filePath, code, results);
      detectInefficientStringConcat(ast, filePath, code, results);
      detectMissingDebounceThrottle(ast, filePath, code, results);
      detectSyncOperationsThatCouldBeAsync(ast, filePath, code, results);
      detectRedundantReRenders(ast, filePath, code, results);
      
    } catch (error) {
      console.error(`[analyzePerformanceAntiPatterns] Error analyzing ${filePath}:`, error.message);
    }
  }

  return results;
}

/**
 * Detect DOM queries inside loops
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectDOMQueriesInLoops(ast, filePath, code, results) {
  const loopNodes = [];
  
  // First pass: collect all loop nodes
  traverse(ast, {
    ForStatement(node) {
      loopNodes.push({ node, type: 'ForStatement' });
    },
    WhileStatement(node) {
      loopNodes.push({ node, type: 'WhileStatement' });
    },
    DoWhileStatement(node) {
      loopNodes.push({ node, type: 'DoWhileStatement' });
    }
  });
  
  // Check each loop for DOM queries
  for (const { node, type } of loopNodes) {
    const domQueries = [];
    
    // Traverse the loop body to find DOM queries
    traverse(node.body || node, {
      CallExpression(callNode) {
        if (isDOMQueryCall(callNode)) {
          domQueries.push({
            line: callNode.loc ? callNode.loc.start.line : 0,
            column: callNode.loc ? callNode.loc.start.column : 0,
            query: getQueryDescription(callNode)
          });
        }
      }
    });
    
    // Generate findings for DOM queries in this loop
    if (domQueries.length > 0) {
      const line = node.loc ? node.loc.start.line : 0;
      const column = node.loc ? node.loc.start.column : 0;
      const endLine = node.loc ? node.loc.end.line : line + 1;
      
      const snippet = extractSnippet(code, line, Math.min(line + 5, endLine));
      
      results.patterns.domQueriesInLoops.push({ filePath, line, domQueries });
      
      results.findings.push(createFinding({
        category: 'optimization',
        subcategory: 'dom-query-in-loop',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 70,
        file: filePath,
        line,
        column,
        description: `DOM query inside ${type} loop - ${domQueries.length} query/queries found`,
        recommendation: `Cache DOM references before the loop to avoid repeated queries. Store the result in a variable before the loop and reuse it.`,
        codeSnippet: snippet
      }));
    }
  }
}

/**
 * Check if a call expression is a DOM query
 * @param {Object} node - CallExpression node
 * @returns {boolean}
 */
function isDOMQueryCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  
  const callee = node.callee;
  
  // document.getElementById, document.querySelector, document.querySelectorAll
  if (callee.type === 'MemberExpression') {
    const object = callee.object;
    const property = callee.property;
    
    if (object && object.name === 'document' && property) {
      const methodName = property.name || property.value;
      return ['getElementById', 'querySelector', 'querySelectorAll', 
              'getElementsByClassName', 'getElementsByTagName', 
              'getElementsByName'].includes(methodName);
    }
  }
  
  // el() helper function (common pattern in this codebase)
  if (callee.type === 'Identifier' && callee.name === 'el') {
    return true;
  }
  
  return false;
}

/**
 * Get a description of the DOM query
 * @param {Object} node - CallExpression node
 * @returns {string}
 */
function getQueryDescription(node) {
  const callee = node.callee;
  
  if (callee.type === 'MemberExpression' && callee.property) {
    return callee.property.name || callee.property.value || 'DOM query';
  }
  
  if (callee.type === 'Identifier') {
    return callee.name + '()';
  }
  
  return 'DOM query';
}

/**
 * Detect repeated DOM queries for the same element
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectRepeatedDOMQueries(ast, filePath, code, results) {
  const queryMap = new Map(); // selector -> [{line, column}]
  
  traverse(ast, {
    CallExpression(node) {
      if (isDOMQueryCall(node)) {
        const selector = getQuerySelector(node);
        if (selector) {
          if (!queryMap.has(selector)) {
            queryMap.set(selector, []);
          }
          queryMap.get(selector).push({
            line: node.loc ? node.loc.start.line : 0,
            column: node.loc ? node.loc.start.column : 0,
            node
          });
        }
      }
    }
  });
  
  // Find selectors queried multiple times
  for (const [selector, occurrences] of queryMap) {
    if (occurrences.length >= 3) { // Only flag if 3+ occurrences
      const firstOccurrence = occurrences[0];
      const snippet = extractSnippet(code, firstOccurrence.line, firstOccurrence.line);
      
      results.patterns.repeatedDOMQueries.push({
        filePath,
        selector,
        count: occurrences.length,
        locations: occurrences.map(o => ({ line: o.line, column: o.column }))
      });
      
      results.findings.push(createFinding({
        category: 'optimization',
        subcategory: 'repeated-dom-query',
        severity: 'minor',
        effort: 'quick-win',
        impact: 50,
        file: filePath,
        line: firstOccurrence.line,
        column: firstOccurrence.column,
        description: `Element '${selector}' is queried ${occurrences.length} times`,
        recommendation: `Cache the element reference in a variable and reuse it instead of querying multiple times.`,
        codeSnippet: snippet
      }));
    }
  }
}

/**
 * Extract the selector from a DOM query call
 * @param {Object} node - CallExpression node
 * @returns {string|null}
 */
function getQuerySelector(node) {
  if (!node.arguments || node.arguments.length === 0) return null;
  
  const firstArg = node.arguments[0];
  
  if (firstArg.type === 'StringLiteral' || firstArg.type === 'Literal') {
    return firstArg.value;
  }
  
  return null;
}

/**
 * Detect unnecessary array iterations (multiple passes over same array)
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectUnnecessaryIterations(ast, filePath, code, results) {
  // Track array method chains and multiple iterations over same array
  const arrayOperations = new Map(); // arrayName -> [{method, line}]
  
  traverse(ast, {
    CallExpression(node) {
      if (isArrayIterationMethod(node)) {
        const arrayName = getArrayName(node);
        if (arrayName) {
          const method = getMethodName(node);
          const line = node.loc ? node.loc.start.line : 0;
          
          if (!arrayOperations.has(arrayName)) {
            arrayOperations.set(arrayName, []);
          }
          arrayOperations.get(arrayName).push({ method, line, node });
        }
      }
    }
  });
  
  // Check for multiple separate iterations
  for (const [arrayName, operations] of arrayOperations) {
    // Filter, map, forEach operations that could be combined
    const filterOps = operations.filter(op => op.method === 'filter');
    const mapOps = operations.filter(op => op.method === 'map');
    const forEachOps = operations.filter(op => op.method === 'forEach');
    
    // Flag if there are multiple separate operations of the same type
    if (filterOps.length >= 2 || mapOps.length >= 2 || forEachOps.length >= 2) {
      const firstOp = operations[0];
      const snippet = extractSnippet(code, firstOp.line, firstOp.line);
      
      results.patterns.unnecessaryIterations.push({
        filePath,
        arrayName,
        operations: operations.map(op => ({ method: op.method, line: op.line }))
      });
      
      results.findings.push(createFinding({
        category: 'optimization',
        subcategory: 'unnecessary-iterations',
        severity: 'minor',
        effort: 'medium',
        impact: 45,
        file: filePath,
        line: firstOp.line,
        column: firstOp.node.loc ? firstOp.node.loc.start.column : 0,
        description: `Array '${arrayName}' is iterated ${operations.length} times with separate operations`,
        recommendation: `Consider combining multiple array operations into a single pass using method chaining or reduce.`,
        codeSnippet: snippet
      }));
    }
  }
}

/**
 * Check if a call is an array iteration method
 * @param {Object} node - CallExpression node
 * @returns {boolean}
 */
function isArrayIterationMethod(node) {
  if (node.callee.type === 'MemberExpression' && node.callee.property) {
    const methodName = node.callee.property.name || node.callee.property.value;
    return ['map', 'filter', 'forEach', 'reduce', 'some', 'every', 'find'].includes(methodName);
  }
  return false;
}

/**
 * Get the array name from a method call
 * @param {Object} node - CallExpression node
 * @returns {string|null}
 */
function getArrayName(node) {
  if (node.callee.type === 'MemberExpression' && node.callee.object) {
    if (node.callee.object.type === 'Identifier') {
      return node.callee.object.name;
    }
  }
  return null;
}

/**
 * Get the method name from a call expression
 * @param {Object} node - CallExpression node
 * @returns {string|null}
 */
function getMethodName(node) {
  if (node.callee.type === 'MemberExpression' && node.callee.property) {
    return node.callee.property.name || node.callee.property.value;
  }
  return null;
}

/**
 * Detect inefficient string concatenation in loops
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectInefficientStringConcat(ast, filePath, code, results) {
  const loopNodes = [];
  
  // Collect all loop nodes
  traverse(ast, {
    ForStatement(node) {
      loopNodes.push({ node, type: 'ForStatement' });
    },
    WhileStatement(node) {
      loopNodes.push({ node, type: 'WhileStatement' });
    }
  });
  
  // Check each loop for string concatenation
  for (const { node, type } of loopNodes) {
    const stringConcats = [];
    
    traverse(node.body || node, {
      AssignmentExpression(assignNode) {
        // Check for += with strings
        if (assignNode.operator === '+=' || assignNode.operator === '=') {
          // Check if right side is a BinaryExpression with + operator
          if (assignNode.right && assignNode.right.type === 'BinaryExpression' && 
              assignNode.right.operator === '+') {
            stringConcats.push({
              line: assignNode.loc ? assignNode.loc.start.line : 0,
              column: assignNode.loc ? assignNode.loc.start.column : 0
            });
          }
        }
      },
      BinaryExpression(binNode) {
        // Also check for direct += string concatenation
        if (binNode.operator === '+') {
          // Heuristic: if it's in a loop and involves concatenation, flag it
          const line = binNode.loc ? binNode.loc.start.line : 0;
          const column = binNode.loc ? binNode.loc.start.column : 0;
          
          // Only add if not already added
          if (!stringConcats.some(sc => sc.line === line)) {
            stringConcats.push({ line, column });
          }
        }
      }
    });
    
    // Generate finding if string concatenation found in loop
    if (stringConcats.length > 0) {
      const line = node.loc ? node.loc.start.line : 0;
      const column = node.loc ? node.loc.start.column : 0;
      const endLine = node.loc ? node.loc.end.line : line + 1;
      const snippet = extractSnippet(code, line, Math.min(line + 5, endLine));
      
      results.patterns.inefficientStringConcat.push({
        filePath,
        line,
        count: stringConcats.length
      });
      
      results.findings.push(createFinding({
        category: 'optimization',
        subcategory: 'inefficient-string-concat',
        severity: 'minor',
        effort: 'quick-win',
        impact: 40,
        file: filePath,
        line,
        column,
        description: `String concatenation inside ${type} loop detected`,
        recommendation: `Use an array with push() and join() at the end, or template literals, for better performance in loops.`,
        codeSnippet: snippet
      }));
    }
  }
}

/**
 * Detect missing debounce/throttle on frequent events
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectMissingDebounceThrottle(ast, filePath, code, results) {
  const frequentEvents = ['scroll', 'resize', 'mousemove', 'keyup', 'input'];
  
  traverse(ast, {
    CallExpression(node) {
      // Check for addEventListener with frequent events
      if (isAddEventListenerCall(node)) {
        const eventType = getEventType(node);
        
        if (eventType && frequentEvents.includes(eventType.toLowerCase())) {
          // Check if the handler is wrapped in debounce/throttle
          const handler = node.arguments[1];
          const isDebounced = handler && isWrappedInDebounceOrThrottle(handler);
          
          if (!isDebounced) {
            const line = node.loc ? node.loc.start.line : 0;
            const column = node.loc ? node.loc.start.column : 0;
            const snippet = extractSnippet(code, line, line);
            
            results.patterns.missingDebounceThrottle.push({
              filePath,
              line,
              eventType
            });
            
            results.findings.push(createFinding({
              category: 'optimization',
              subcategory: 'missing-debounce-throttle',
              severity: 'moderate',
              effort: 'medium',
              impact: 65,
              file: filePath,
              line,
              column,
              description: `Frequent event '${eventType}' listener without debounce/throttle`,
              recommendation: `Wrap the event handler in a debounce or throttle function to avoid excessive calls and improve performance.`,
              codeSnippet: snippet
            }));
          }
        }
      }
    }
  });
}

/**
 * Check if a call is addEventListener
 * @param {Object} node - CallExpression node
 * @returns {boolean}
 */
function isAddEventListenerCall(node) {
  if (node.callee.type === 'MemberExpression' && node.callee.property) {
    const methodName = node.callee.property.name || node.callee.property.value;
    return methodName === 'addEventListener';
  }
  return false;
}

/**
 * Get the event type from addEventListener call
 * @param {Object} node - CallExpression node
 * @returns {string|null}
 */
function getEventType(node) {
  if (node.arguments && node.arguments.length > 0) {
    const firstArg = node.arguments[0];
    if (firstArg.type === 'StringLiteral' || firstArg.type === 'Literal') {
      return firstArg.value;
    }
  }
  return null;
}

/**
 * Check if handler is wrapped in debounce/throttle
 * @param {Object} node - Handler node
 * @returns {boolean}
 */
function isWrappedInDebounceOrThrottle(node) {
  // Check if the handler is a call expression to debounce/throttle
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (callee.type === 'Identifier') {
      const name = callee.name.toLowerCase();
      return name.includes('debounce') || name.includes('throttle');
    }
  }
  return false;
}

/**
 * Detect synchronous operations that could be async
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectSyncOperationsThatCouldBeAsync(ast, filePath, code, results) {
  traverse(ast, {
    CallExpression(node) {
      // Check for sync file operations (fs.readFileSync, etc.)
      if (isSyncFileOperation(node)) {
        const line = node.loc ? node.loc.start.line : 0;
        const column = node.loc ? node.loc.start.column : 0;
        const snippet = extractSnippet(code, line, line);
        const methodName = getMethodName(node);
        
        results.patterns.syncOperationsThatCouldBeAsync.push({
          filePath,
          line,
          method: methodName
        });
        
        results.findings.push(createFinding({
          category: 'optimization',
          subcategory: 'sync-could-be-async',
          severity: 'moderate',
          effort: 'medium',
          impact: 60,
          file: filePath,
          line,
          column,
          description: `Synchronous operation '${methodName}' could be async`,
          recommendation: `Consider using the async version ('${methodName.replace('Sync', '')}') with await to avoid blocking the event loop.`,
          codeSnippet: snippet
        }));
      }
    }
  });
}

/**
 * Check if a call is a synchronous file operation
 * @param {Object} node - CallExpression node
 * @returns {boolean}
 */
function isSyncFileOperation(node) {
  if (node.callee.type === 'MemberExpression' && node.callee.property) {
    const methodName = node.callee.property.name || node.callee.property.value;
    const syncMethods = ['readFileSync', 'writeFileSync', 'appendFileSync', 
                        'readdirSync', 'statSync', 'mkdirSync', 'unlinkSync'];
    return syncMethods.includes(methodName);
  }
  return false;
}

/**
 * Detect redundant re-renders from unchanged state
 * This detects render functions that don't check if state has changed before updating the DOM
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to append findings to
 */
function detectRedundantReRenders(ast, filePath, code, results) {
  const renderFunctions = [];
  
  // Find all render functions (functions with 'render' in their name)
  traverse(ast, {
    FunctionDeclaration(node) {
      if (node.id && node.id.name && node.id.name.toLowerCase().includes('render')) {
        renderFunctions.push({
          node,
          name: node.id.name,
          type: 'FunctionDeclaration'
        });
      }
    },
    VariableDeclarator(node) {
      if (node.id && node.id.name && node.id.name.toLowerCase().includes('render')) {
        if (node.init && (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression')) {
          renderFunctions.push({
            node: node.init,
            name: node.id.name,
            type: 'FunctionExpression'
          });
        }
      }
    }
  });
  
  // Check each render function for state comparison before DOM updates
  for (const { node, name, type } of renderFunctions) {
    let hasDOMUpdate = false;
    let hasStateCheck = false;
    let domUpdateLines = [];
    
    // Check for DOM updates (innerHTML, textContent, appendChild, etc.)
    traverse(node.body || node, {
      AssignmentExpression(assignNode) {
        if (assignNode.left && assignNode.left.property) {
          const propName = assignNode.left.property.name || assignNode.left.property.value;
          if (['innerHTML', 'textContent', 'innerText', 'value', 'className'].includes(propName)) {
            hasDOMUpdate = true;
            if (assignNode.loc) {
              domUpdateLines.push(assignNode.loc.start.line);
            }
          }
        }
      },
      CallExpression(callNode) {
        if (callNode.callee && callNode.callee.property) {
          const methodName = callNode.callee.property.name || callNode.callee.property.value;
          if (['appendChild', 'removeChild', 'replaceChild', 'insertBefore', 'remove', 
               'setAttribute', 'removeAttribute', 'classList'].includes(methodName)) {
            hasDOMUpdate = true;
            if (callNode.loc) {
              domUpdateLines.push(callNode.loc.start.line);
            }
          }
        }
      }
    });
    
    // Check for state comparison (if statements, equality checks with previous state)
    traverse(node.body || node, {
      IfStatement(ifNode) {
        // Look for comparisons that might be checking previous state
        if (ifNode.test) {
          traverse(ifNode.test, {
            BinaryExpression(binNode) {
              if (['===', '!==', '==', '!='].includes(binNode.operator)) {
                // Check if comparing with something that looks like "previous" state
                const leftStr = getExpressionString(binNode.left);
                const rightStr = getExpressionString(binNode.right);
                if (leftStr.includes('prev') || rightStr.includes('prev') ||
                    leftStr.includes('last') || rightStr.includes('last') ||
                    leftStr.includes('current') || rightStr.includes('current')) {
                  hasStateCheck = true;
                }
              }
            }
          });
        }
      }
    });
    
    // Generate finding if DOM updates without state checks
    if (hasDOMUpdate && !hasStateCheck) {
      const line = node.loc ? node.loc.start.line : 0;
      const column = node.loc ? node.loc.start.column : 0;
      const endLine = node.loc ? node.loc.end.line : line + 1;
      const snippet = extractSnippet(code, line, Math.min(line + 10, endLine));
      
      results.patterns.redundantReRenders.push({
        filePath,
        functionName: name,
        line,
        domUpdateCount: domUpdateLines.length
      });
      
      results.findings.push(createFinding({
        category: 'optimization',
        subcategory: 'redundant-re-render',
        severity: 'moderate',
        effort: 'medium',
        impact: 60,
        file: filePath,
        line,
        column,
        description: `Render function '${name}' may cause redundant re-renders without state change detection`,
        recommendation: `Add a check to compare new state with previous state before updating the DOM. Consider caching previous values and only updating if they've changed. Example: if (prevValue !== newValue) { el.textContent = newValue; }`,
        codeSnippet: snippet
      }));
    }
  }
}

/**
 * Get a string representation of an AST expression node
 * @param {Object} node - AST node
 * @returns {string}
 */
function getExpressionString(node) {
  if (!node) return '';
  
  if (node.type === 'Identifier') {
    return node.name;
  }
  
  if (node.type === 'MemberExpression') {
    const object = getExpressionString(node.object);
    const property = node.property.name || node.property.value || '';
    return `${object}.${property}`;
  }
  
  if (node.type === 'Literal' || node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
    return String(node.value);
  }
  
  return '';
}

/**
 * Generate a report from performance anti-pattern findings
 * @param {Object} results - Analysis results
 * @returns {string} Formatted report
 */
export function generatePerformanceReport(results) {
  const { findings, patterns } = results;
  
  let report = '# Performance Anti-Pattern Analysis Report\n\n';
  
  // Summary
  report += `## Summary\n\n`;
  report += `- Total Issues Found: ${findings.length}\n`;
  report += `- DOM Queries in Loops: ${patterns.domQueriesInLoops.length}\n`;
  report += `- Repeated DOM Queries: ${patterns.repeatedDOMQueries.length}\n`;
  report += `- Unnecessary Iterations: ${patterns.unnecessaryIterations.length}\n`;
  report += `- Inefficient String Concatenation: ${patterns.inefficientStringConcat.length}\n`;
  report += `- Missing Debounce/Throttle: ${patterns.missingDebounceThrottle.length}\n`;
  report += `- Sync Operations That Could Be Async: ${patterns.syncOperationsThatCouldBeAsync.length}\n`;
  report += `- Redundant Re-Renders: ${patterns.redundantReRenders.length}\n\n`;
  
  // Group findings by subcategory
  const bySubcategory = findings.reduce((acc, f) => {
    if (!acc[f.subcategory]) acc[f.subcategory] = [];
    acc[f.subcategory].push(f);
    return acc;
  }, {});
  
  // Detailed findings
  for (const [subcategory, subFindings] of Object.entries(bySubcategory)) {
    report += `## ${formatSubcategory(subcategory)}\n\n`;
    
    subFindings.forEach((finding, index) => {
      report += `### ${index + 1}. ${finding.description}\n`;
      report += `- **File**: ${finding.file}\n`;
      report += `- **Line**: ${finding.line}\n`;
      report += `- **Severity**: ${finding.severity}\n`;
      report += `- **Impact**: ${finding.impact}\n`;
      report += `- **Recommendation**: ${finding.recommendation}\n`;
      if (finding.codeSnippet) {
        report += `- **Code**:\n\`\`\`javascript\n${finding.codeSnippet}\n\`\`\`\n`;
      }
      report += `\n`;
    });
  }
  
  return report;
}

/**
 * Format subcategory name for display
 * @param {string} subcategory - Subcategory identifier
 * @returns {string} Formatted name
 */
function formatSubcategory(subcategory) {
  const names = {
    'dom-query-in-loop': 'DOM Queries Inside Loops',
    'repeated-dom-query': 'Repeated DOM Queries',
    'unnecessary-iterations': 'Unnecessary Array Iterations',
    'inefficient-string-concat': 'Inefficient String Concatenation',
    'missing-debounce-throttle': 'Missing Debounce/Throttle',
    'sync-could-be-async': 'Synchronous Operations That Could Be Async',
    'redundant-re-render': 'Redundant Re-Renders From Unchanged State'
  };
  return names[subcategory] || subcategory;
}

export default {
  analyzePerformanceAntiPatterns,
  generatePerformanceReport
};
