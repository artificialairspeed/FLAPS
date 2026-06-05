/**
 * Safe Code Removal Executor
 * Task 10.1: Create safe code removal function
 * Requirements: 1.7, 1.9
 * 
 * Implements safe removal of dead code with backup, verification, and rollback capabilities
 */

import { parseFile, traverse } from '../parser.js';
import { createChange } from '../models.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as generate from '@babel/generator';

const BACKUP_DIR = path.join(process.cwd(), '.kiro', 'backups');

/**
 * Create a backup of a file before modification
 * @param {string} filePath - Path to file to backup
 * @returns {Object} Backup information with path and timestamp
 */
export function createBackup(filePath) {
  const timestamp = Date.now();
  const fileName = path.basename(filePath);
  const backupFileName = `${fileName}.${timestamp}.backup`;
  
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  
  try {
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(backupPath, originalContent, 'utf-8');
    
    return {
      success: true,
      backupPath,
      originalPath: filePath,
      timestamp,
      content: originalContent
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      originalPath: filePath
    };
  }
}

/**
 * Restore a file from backup
 * @param {Object} backup - Backup information from createBackup
 * @returns {Object} Result with success status
 */
export function restoreBackup(backup) {
  try {
    if (backup.content) {
      fs.writeFileSync(backup.originalPath, backup.content, 'utf-8');
    } else if (backup.backupPath && fs.existsSync(backup.backupPath)) {
      const backupContent = fs.readFileSync(backup.backupPath, 'utf-8');
      fs.writeFileSync(backup.originalPath, backupContent, 'utf-8');
    } else {
      return {
        success: false,
        error: 'No backup content or backup file found'
      };
    }
    
    return {
      success: true,
      restoredPath: backup.originalPath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Clean up backup files
 * @param {Object} backup - Backup information from createBackup
 */
export function cleanupBackup(backup) {
  try {
    if (backup.backupPath && fs.existsSync(backup.backupPath)) {
      fs.unlinkSync(backup.backupPath);
    }
  } catch (error) {
    console.warn(`Warning: Could not cleanup backup file: ${error.message}`);
  }
}

/**
 * Run the test suite
 * @returns {Object} Test results with passed status and failures
 */
export function runTests() {
  try {
    // Run npm test
    execSync('npm test', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
    
    return {
      passed: true,
      failures: []
    };
  } catch (error) {
    // Test failures will throw an error with non-zero exit code
    return {
      passed: false,
      failures: error.stdout ? [error.stdout] : [error.message],
      error: error.message
    };
  }
}

/**
 * Remove a node from an AST at the specified location
 * @param {Object} ast - Babel AST
 * @param {number} line - Line number to remove (1-indexed)
 * @param {number} column - Column number (0-indexed, optional)
 * @returns {Object} Modified AST and info about removed node
 */
export function removeNodeAtLocation(ast, line, column = null) {
  let removed = false;
  let removedNode = null;
  let parentNode = null;
  let parentKey = null;
  let parentIndex = null;

  /**
   * Visit function for traversing AST
   * @param {Object} node - Current AST node
   * @param {Object} parent - Parent AST node
   * @param {string} key - Key in parent that references this node
   * @param {number} index - Index in parent array (if applicable)
   */
  function visit(node, parent = null, key = null, index = null) {
    if (!node || typeof node !== 'object' || removed) {
      return;
    }

    // Check if this node matches the target location
    if (node.loc && node.loc.start.line === line) {
      // If column specified, match it exactly; otherwise, just match line
      const columnMatches = column === null || node.loc.start.column === column;
      
      if (columnMatches && canRemoveNode(node)) {
        removedNode = node;
        parentNode = parent;
        parentKey = key;
        parentIndex = index;
        removed = true;
        return;
      }
    }

    // Recursively visit all properties
    for (const nodeKey in node) {
      if (nodeKey === 'loc' || nodeKey === 'range' || nodeKey === 'start' || nodeKey === 'end') {
        continue; // Skip location metadata
      }

      const value = node[nodeKey];

      if (Array.isArray(value)) {
        value.forEach((child, idx) => {
          if (child && typeof child === 'object' && child.type) {
            visit(child, node, nodeKey, idx);
          }
        });
      } else if (value && typeof value === 'object' && value.type) {
        visit(value, node, nodeKey, null);
      }
    }
  }

  visit(ast.program);

  // If we found a node to remove, remove it from its parent
  if (removed && parentNode && parentKey) {
    if (parentIndex !== null && Array.isArray(parentNode[parentKey])) {
      // Remove from array
      parentNode[parentKey].splice(parentIndex, 1);
    } else {
      // Remove property or set to undefined/null
      delete parentNode[parentKey];
    }
  }

  return {
    success: removed,
    removedNode,
    nodeType: removedNode ? removedNode.type : null
  };
}

/**
 * Check if a node type can be safely removed
 * @param {Object} node - AST node
 * @returns {boolean} True if node can be removed
 */
function canRemoveNode(node) {
  const removableTypes = [
    'FunctionDeclaration',
    'VariableDeclaration',
    'ExpressionStatement',
    'ClassDeclaration',
    'ImportDeclaration',
    'ExportNamedDeclaration',
    'ExportDefaultDeclaration'
  ];
  
  return removableTypes.includes(node.type);
}

/**
 * Remove dead code from a file based on a finding
 * @param {Object} finding - Finding object from analysis with file, line, column info
 * @param {Object} options - Options for removal (dryRun, skipTests, etc.)
 * @returns {Object} Result with success status, change record, or error
 */
export async function removeDeadCode(finding, options = {}) {
  const {
    dryRun = false,
    skipTests = false,
    skipBackup = false
  } = options;

  const filePath = finding.file;
  let backup = null;

  try {
    // Step 1: Create backup (unless skipped)
    if (!skipBackup && !dryRun) {
      backup = createBackup(filePath);
      if (!backup.success) {
        return {
          success: false,
          reason: `Failed to create backup: ${backup.error}`,
          finding
        };
      }
    }

    // Step 2: Load original code for before snippet
    const originalCode = fs.readFileSync(filePath, 'utf-8');
    const originalLines = originalCode.split('\n');
    
    // Get before snippet (3 lines before and after for context)
    const beforeStartLine = Math.max(0, finding.line - 3);
    const beforeEndLine = Math.min(originalLines.length, finding.line + 3);
    const beforeSnippet = originalLines.slice(beforeStartLine, beforeEndLine).join('\n');

    // Step 3: Load AST
    const ast = parseFile(filePath);

    // Step 4: Remove node at specified location
    const removalResult = removeNodeAtLocation(ast, finding.line, finding.column);

    if (!removalResult.success) {
      if (backup && !skipBackup) {
        cleanupBackup(backup);
      }
      return {
        success: false,
        reason: `Could not find removable node at line ${finding.line}`,
        finding
      };
    }

    // Step 5: Generate modified code
    const result = generate.default(ast, {
      retainLines: false,
      compact: false,
      concise: false,
      comments: true
    });
    
    const modifiedCode = result.code;

    // Get after snippet (same lines for comparison)
    const modifiedLines = modifiedCode.split('\n');
    const afterStartLine = Math.max(0, finding.line - 3);
    const afterEndLine = Math.min(modifiedLines.length, finding.line + 3);
    const afterSnippet = modifiedLines.slice(afterStartLine, afterEndLine).join('\n');

    // If dry run, return without writing
    if (dryRun) {
      if (backup && !skipBackup) {
        cleanupBackup(backup);
      }
      return {
        success: true,
        dryRun: true,
        beforeSnippet,
        afterSnippet,
        removedNodeType: removalResult.nodeType,
        finding
      };
    }

    // Step 6: Write modified code
    fs.writeFileSync(filePath, modifiedCode, 'utf-8');

    // Step 7: Run tests (unless skipped)
    let testResult = { passed: true, failures: [] };
    
    if (!skipTests) {
      testResult = runTests();

      // Step 8: Verify and commit or rollback
      if (!testResult.passed) {
        // Rollback on test failure
        if (backup && !skipBackup) {
          const restoreResult = restoreBackup(backup);
          if (!restoreResult.success) {
            return {
              success: false,
              reason: `Tests failed and restore failed: ${restoreResult.error}`,
              testFailures: testResult.failures,
              finding
            };
          }
        }

        return {
          success: false,
          reason: 'Tests failed after code removal',
          testFailures: testResult.failures,
          finding
        };
      }
    }

    // Success! Create change record
    const change = createChange({
      findingIds: [finding.id],
      file: filePath,
      type: 'removal',
      beforeSnippet,
      afterSnippet,
      rationale: `Removed dead code: ${finding.description}`,
      testsPassedBefore: true,
      testsPassedAfter: testResult.passed
    });

    // Clean up backup file if successful
    if (backup && !skipBackup) {
      cleanupBackup(backup);
    }

    return {
      success: true,
      change,
      removedNodeType: removalResult.nodeType,
      finding
    };

  } catch (error) {
    // Restore backup on any error
    if (backup && !skipBackup && !dryRun) {
      const restoreResult = restoreBackup(backup);
      if (!restoreResult.success) {
        console.error(`Failed to restore backup: ${restoreResult.error}`);
      }
    }

    return {
      success: false,
      reason: error.message,
      stack: error.stack,
      finding
    };
  }
}

/**
 * Remove multiple dead code findings in batch
 * @param {Object[]} findings - Array of finding objects
 * @param {Object} options - Options for removal
 * @returns {Object} Results with implemented, deferred, and failed changes
 */
export async function removeDeadCodeBatch(findings, options = {}) {
  const results = {
    implemented: [],
    failed: []
  };

  for (const finding of findings) {
    const result = await removeDeadCode(finding, options);

    if (result.success) {
      results.implemented.push(result);
    } else {
      results.failed.push({
        finding,
        reason: result.reason,
        testFailures: result.testFailures
      });
    }
  }

  return results;
}
