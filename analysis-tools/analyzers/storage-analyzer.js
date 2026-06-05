/**
 * SessionStorage Operation Tracker
 * 
 * Scans app.js for all sessionStorage operations,
 * identifies write-only keys (stored but never retrieved),
 * identifies read-only keys (retrieved but never stored),
 * and finds all operations missing try-catch error handling.
 * 
 * Requirements: 1.6, 5.1, 5.2, 5.3, 5.4
 */

import fs from 'fs';
import path from 'path';
import { createFinding } from '../models.js';

/**
 * Extract all sessionStorage operations from JavaScript content
 * @param {string} jsContent - Content of the JavaScript file
 * @returns {Object} Object containing setItem, getItem, and removeItem operations
 */
function extractStorageOperations(jsContent) {
  const setOperations = [];
  const getOperations = [];
  const removeOperations = [];
  
  // Split into lines for line number tracking
  const lines = jsContent.split('\n');
  
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmedLine = line.trim();
    
    // Match sessionStorage.setItem('key', value) or sessionStorage.setItem("key", value)
    const setMatches = line.matchAll(/sessionStorage\.setItem\s*\(\s*['"]([^'"]+)['"]\s*,/g);
    for (const match of setMatches) {
      const key = match[1];
      const hasErrorHandling = checkErrorHandling(lines, index);
      setOperations.push({
        key,
        line: lineNumber,
        operation: 'setItem',
        hasErrorHandling,
        snippet: trimmedLine
      });
    }
    
    // Match sessionStorage.getItem('key') or sessionStorage.getItem("key")
    const getMatches = line.matchAll(/sessionStorage\.getItem\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of getMatches) {
      const key = match[1];
      const hasErrorHandling = checkErrorHandling(lines, index);
      getOperations.push({
        key,
        line: lineNumber,
        operation: 'getItem',
        hasErrorHandling,
        snippet: trimmedLine
      });
    }
    
    // Match sessionStorage.removeItem('key') or sessionStorage.removeItem("key")
    const removeMatches = line.matchAll(/sessionStorage\.removeItem\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of removeMatches) {
      const key = match[1];
      const hasErrorHandling = checkErrorHandling(lines, index);
      removeOperations.push({
        key,
        line: lineNumber,
        operation: 'removeItem',
        hasErrorHandling,
        snippet: trimmedLine
      });
    }
  });
  
  return {
    setOperations,
    getOperations,
    removeOperations
  };
}

/**
 * Check if a line is within a try-catch block
 * @param {string[]} lines - All lines of the file
 * @param {number} lineIndex - Current line index (0-based)
 * @returns {boolean} True if the line is within a try block
 */
function checkErrorHandling(lines, lineIndex) {
  // Look backwards to find if we're in a try block
  let tryDepth = 0;
  let catchFound = false;
  
  // Scan backwards from current line
  for (let i = lineIndex; i >= 0; i--) {
    const line = lines[i];
    
    // Count closing braces (decrease depth)
    const closingBraces = (line.match(/\}/g) || []).length;
    tryDepth -= closingBraces;
    
    // If we find a catch before going back to depth 0, we're in a try-catch
    if (line.includes('catch') && tryDepth <= 0) {
      catchFound = true;
    }
    
    // Count opening braces (increase depth)
    const openingBraces = (line.match(/\{/g) || []).length;
    tryDepth += openingBraces;
    
    // If we find a try statement and we're at its level, check if catch exists
    if (line.includes('try') && tryDepth <= 1) {
      // Now look forward to confirm there's a catch block
      for (let j = i; j < lines.length && j <= lineIndex + 10; j++) {
        if (lines[j].includes('catch')) {
          return true;
        }
        // Stop if we hit another function or major block
        if (j > lineIndex && lines[j].match(/^\s*(function|const|let|var)\s/)) {
          break;
        }
      }
      return false;
    }
  }
  
  return false;
}

/**
 * Analyze sessionStorage operations and identify issues
 * @param {string} projectRoot - Path to the project root
 * @returns {Array<Finding>} Array of findings for storage issues
 */
export function analyzeStorageOperations(projectRoot) {
  const findings = [];
  
  // File path
  const jsPath = path.join(projectRoot, 'public', 'app.js');
  
  // Read file
  let jsContent;
  try {
    jsContent = fs.readFileSync(jsPath, 'utf-8');
  } catch (error) {
    console.error('Error reading app.js:', error.message);
    return findings;
  }
  
  // Extract all operations
  const operations = extractStorageOperations(jsContent);
  
  // Build maps of keys by operation type
  const keysWritten = new Map(); // key -> [operations]
  const keysRead = new Map();    // key -> [operations]
  const keysRemoved = new Map(); // key -> [operations]
  
  operations.setOperations.forEach(op => {
    if (!keysWritten.has(op.key)) {
      keysWritten.set(op.key, []);
    }
    keysWritten.get(op.key).push(op);
  });
  
  operations.getOperations.forEach(op => {
    if (!keysRead.has(op.key)) {
      keysRead.set(op.key, []);
    }
    keysRead.get(op.key).push(op);
  });
  
  operations.removeOperations.forEach(op => {
    if (!keysRemoved.has(op.key)) {
      keysRemoved.set(op.key, []);
    }
    keysRemoved.get(op.key).push(op);
  });
  
  // Get all unique keys
  const allKeys = new Set([
    ...keysWritten.keys(),
    ...keysRead.keys(),
    ...keysRemoved.keys()
  ]);
  
  // Check each key for issues
  allKeys.forEach(key => {
    const writtenOps = keysWritten.get(key) || [];
    const readOps = keysRead.get(key) || [];
    const removedOps = keysRemoved.get(key) || [];
    
    // Issue 1: Write-only keys (stored but never retrieved)
    if (writtenOps.length > 0 && readOps.length === 0) {
      // Exception: If the key is removed, it might be used for flag purposes
      if (removedOps.length === 0) {
        findings.push(createFinding({
          category: 'storage',
          subcategory: 'write-only-storage-key',
          severity: 'moderate',
          effort: 'quick-win',
          impact: 60,
          file: jsPath,
          line: writtenOps[0].line,
          description: `SessionStorage key '${key}' is written (${writtenOps.length} time(s)) but never read`,
          recommendation: `Either add code to read this storage key or remove the setItem operation if it's not needed`,
          codeSnippet: writtenOps[0].snippet
        }));
      }
    }
    
    // Issue 2: Read-only keys (retrieved but never stored)
    if (readOps.length > 0 && writtenOps.length === 0) {
      findings.push(createFinding({
        category: 'storage',
        subcategory: 'read-only-storage-key',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 60,
        file: jsPath,
        line: readOps[0].line,
        description: `SessionStorage key '${key}' is read (${readOps.length} time(s)) but never written`,
        recommendation: `Either add code to write this storage key or remove the getItem operation if it's not needed`,
        codeSnippet: readOps[0].snippet
      }));
    }
    
    // Issue 3: Missing error handling
    const allOps = [...writtenOps, ...readOps, ...removedOps];
    allOps.forEach(op => {
      if (!op.hasErrorHandling) {
        findings.push(createFinding({
          category: 'storage',
          subcategory: 'missing-storage-error-handling',
          severity: 'minor',
          effort: 'quick-win',
          impact: 40,
          file: jsPath,
          line: op.line,
          description: `SessionStorage operation '${op.operation}' for key '${key}' lacks try-catch error handling`,
          recommendation: `Wrap this sessionStorage.${op.operation}() call in a try-catch block to handle potential QuotaExceededError or other storage exceptions`,
          codeSnippet: op.snippet
        }));
      }
    });
  });
  
  return findings;
}

/**
 * Generate a detailed storage operations report
 * @param {string} projectRoot - Path to the project root
 * @returns {Object} Detailed storage operations report
 */
export function generateStorageReport(projectRoot) {
  const jsPath = path.join(projectRoot, 'public', 'app.js');
  
  let jsContent;
  try {
    jsContent = fs.readFileSync(jsPath, 'utf-8');
  } catch (error) {
    return { error: error.message };
  }
  
  const operations = extractStorageOperations(jsContent);
  
  // Build summary by key
  const keysSummary = {};
  
  const allKeys = new Set([
    ...operations.setOperations.map(op => op.key),
    ...operations.getOperations.map(op => op.key),
    ...operations.removeOperations.map(op => op.key)
  ]);
  
  allKeys.forEach(key => {
    const writes = operations.setOperations.filter(op => op.key === key);
    const reads = operations.getOperations.filter(op => op.key === key);
    const removes = operations.removeOperations.filter(op => op.key === key);
    
    keysSummary[key] = {
      writeCount: writes.length,
      readCount: reads.length,
      removeCount: removes.length,
      writeLocations: writes.map(op => ({ line: op.line, hasErrorHandling: op.hasErrorHandling })),
      readLocations: reads.map(op => ({ line: op.line, hasErrorHandling: op.hasErrorHandling })),
      removeLocations: removes.map(op => ({ line: op.line, hasErrorHandling: op.hasErrorHandling })),
      isWriteOnly: writes.length > 0 && reads.length === 0 && removes.length === 0,
      isReadOnly: reads.length > 0 && writes.length === 0,
      missingErrorHandling: [...writes, ...reads, ...removes].some(op => !op.hasErrorHandling)
    };
  });
  
  return {
    totalOperations: operations.setOperations.length + operations.getOperations.length + operations.removeOperations.length,
    totalKeys: allKeys.size,
    writeOperations: operations.setOperations.length,
    readOperations: operations.getOperations.length,
    removeOperations: operations.removeOperations.length,
    keysSummary,
    writeOnlyKeys: Object.entries(keysSummary)
      .filter(([_, info]) => info.isWriteOnly)
      .map(([key]) => key),
    readOnlyKeys: Object.entries(keysSummary)
      .filter(([_, info]) => info.isReadOnly)
      .map(([key]) => key),
    keysWithoutErrorHandling: Object.entries(keysSummary)
      .filter(([_, info]) => info.missingErrorHandling)
      .map(([key]) => key)
  };
}

/**
 * Generate a summary of storage findings
 * @param {Array<Finding>} findings - Findings from storage analysis
 * @returns {Object} Summary report
 */
export function generateStorageAnalysisSummary(findings) {
  const writeOnlyFindings = findings.filter(f => f.subcategory === 'write-only-storage-key');
  const readOnlyFindings = findings.filter(f => f.subcategory === 'read-only-storage-key');
  const errorHandlingFindings = findings.filter(f => f.subcategory === 'missing-storage-error-handling');
  
  return {
    totalIssues: findings.length,
    writeOnlyKeys: writeOnlyFindings.length,
    readOnlyKeys: readOnlyFindings.length,
    missingErrorHandling: errorHandlingFindings.length,
    totalImpact: findings.reduce((sum, f) => sum + f.impact, 0),
    averageImpact: findings.length > 0 
      ? Math.round(findings.reduce((sum, f) => sum + f.impact, 0) / findings.length)
      : 0,
    bySeverity: {
      critical: findings.filter(f => f.severity === 'critical').length,
      moderate: findings.filter(f => f.severity === 'moderate').length,
      minor: findings.filter(f => f.severity === 'minor').length
    }
  };
}

export default {
  analyzeStorageOperations,
  generateStorageReport,
  generateStorageAnalysisSummary
};
