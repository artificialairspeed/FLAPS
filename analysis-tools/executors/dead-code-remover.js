/**
 * Dead Code Remover
 * Safely removes unused code while preserving functionality
 * 
 * Requirements: 1.7, 1.8, 1.9, 8.1
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Creates a backup of a file before modification
 * @param {string} filePath - Path to the file to backup
 * @returns {string} Path to the backup file
 */
function createBackup(filePath) {
  const backupPath = `${filePath}.backup-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Restores a file from backup
 * @param {string} backupPath - Path to the backup file
 */
function restoreBackup(backupPath) {
  const originalPath = backupPath.replace(/\.backup-\d+$/, '');
  fs.copyFileSync(backupPath, originalPath);
  fs.unlinkSync(backupPath);
}

/**
 * Removes a backup file
 * @param {string} backupPath - Path to the backup file
 */
function removeBackup(backupPath) {
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
}

/**
 * Runs the test suite to verify functionality
 * @returns {{ passed: boolean, output: string, failures?: string[] }}
 */
function runTestSuite() {
  try {
    // Run only the main application tests, not the analysis tool tests
    // The analysis tools have their own pre-existing failing property tests
    const output = execSync('npx vitest --run server.unit.test.js public/app.property.test.js', { 
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120000 // 2 minute timeout
    });
    return { passed: true, output };
  } catch (error) {
    return { 
      passed: false, 
      output: error.stdout + error.stderr,
      failures: [error.message]
    };
  }
}

/**
 * Removes lines from a file
 * @param {string} filePath - Path to the file
 * @param {number} startLine - Starting line number (1-indexed)
 * @param {number} endLine - Ending line number (1-indexed, inclusive)
 * @returns {string} The modified file content
 */
function removeLines(filePath, startLine, endLine) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // Convert to 0-indexed
  const start = startLine - 1;
  const end = endLine;
  
  // Remove the specified lines
  lines.splice(start, end - start);
  
  return lines.join('\n');
}

/**
 * Finds the end line of a function definition
 * @param {string} filePath - Path to the file
 * @param {number} startLine - Starting line of the function (1-indexed)
 * @returns {number} End line of the function (1-indexed)
 */
function findFunctionEnd(filePath, startLine) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  let braceCount = 0;
  let inFunction = false;
  
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    
    // Count opening braces
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        inFunction = true;
      } else if (char === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
          return i + 1; // Return 1-indexed line number
        }
      }
    }
  }
  
  // Fallback: return startLine if we couldn't find the end
  return startLine;
}

/**
 * Safely removes dead code from a file
 * @param {Object} finding - The finding object describing the dead code
 * @param {string} finding.file - Path to the file
 * @param {number} finding.line - Line number where dead code starts (1-indexed)
 * @param {string} finding.subcategory - Type of dead code (e.g., 'unused-function')
 * @param {string} finding.description - Description of the finding
 * @returns {{ success: boolean, backupPath?: string, reason?: string, testOutput?: string }}
 */
function removeDeadCode(finding) {
  const { file, line, subcategory, description } = finding;
  
  console.log(`\nProcessing: ${description}`);
  console.log(`File: ${file}`);
  console.log(`Line: ${line}`);
  
  // Create backup
  const backupPath = createBackup(file);
  console.log(`Created backup: ${backupPath}`);
  
  try {
    let newContent;
    
    if (subcategory === 'unused-function') {
      // Find the end of the function
      const endLine = findFunctionEnd(file, line);
      console.log(`Removing lines ${line} to ${endLine}`);
      
      // Also check if there's a JSDoc comment or regular comment immediately before
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      let actualStartLine = line;
      
      // Look backwards for comments or blank lines
      for (let i = line - 2; i >= 0; i--) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine === '' || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*') || trimmedLine.endsWith('*/')) {
          actualStartLine = i + 1; // Convert to 1-indexed
        } else {
          break;
        }
      }
      
      newContent = removeLines(file, actualStartLine, endLine);
    } else {
      // For other types of dead code, remove just the single line
      newContent = removeLines(file, line, line);
    }
    
    // Write the modified content
    fs.writeFileSync(file, newContent, 'utf-8');
    console.log(`Modified file written`);
    
    // Run tests
    console.log(`Running test suite...`);
    const testResult = runTestSuite();
    
    if (testResult.passed) {
      console.log(`✓ Tests passed - dead code removed successfully`);
      removeBackup(backupPath);
      return { 
        success: true, 
        testOutput: testResult.output 
      };
    } else {
      console.log(`✗ Tests failed - rolling back changes`);
      restoreBackup(backupPath);
      return { 
        success: false, 
        reason: 'Tests failed after dead code removal',
        testOutput: testResult.output,
        failures: testResult.failures
      };
    }
  } catch (error) {
    console.log(`✗ Error during removal - rolling back changes`);
    restoreBackup(backupPath);
    return { 
      success: false, 
      reason: error.message,
      stack: error.stack 
    };
  }
}

/**
 * Removes multiple dead code findings
 * @param {Array} findings - Array of finding objects
 * @returns {{ implemented: Array, failed: Array, summary: Object }}
 */
function removeDeadCodeBatch(findings) {
  const results = {
    implemented: [],
    failed: [],
    summary: {
      total: findings.length,
      successful: 0,
      failed: 0
    }
  };
  
  // Sort findings by file and line (process from bottom to top to maintain line numbers)
  const sortedFindings = [...findings].sort((a, b) => {
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file);
    }
    return b.line - a.line; // Process from bottom to top
  });
  
  for (const finding of sortedFindings) {
    const result = removeDeadCode(finding);
    
    if (result.success) {
      results.implemented.push({
        finding,
        testOutput: result.testOutput
      });
      results.summary.successful++;
    } else {
      results.failed.push({
        finding,
        reason: result.reason,
        testOutput: result.testOutput,
        failures: result.failures
      });
      results.summary.failed++;
    }
  }
  
  return results;
}

export {
  createBackup,
  restoreBackup,
  removeBackup,
  runTestSuite,
  removeLines,
  findFunctionEnd,
  removeDeadCode,
  removeDeadCodeBatch
};
