/**
 * Function Length Checker - Task 4.3
 * 
 * Identifies functions exceeding recommended length by:
 * 1. Counting lines of code per function (excluding comments and whitespace)
 * 2. Identifying functions exceeding recommended length (>50 LOC)
 * 3. Reporting function name, location, and line count
 * 4. Suggesting splitting opportunities for long functions
 * 5. Considering both function declarations and arrow functions
 * 
 * Validates Requirements 2.3
 */

import * as fs from 'fs';
import { parseFile, traverse, extractSnippet, countFunctionLines } from '../parser.js';
import { createFinding } from '../models.js';

// Configuration
const RECOMMENDED_MAX_LINES = 100;  // Per Requirements 2.3
const CRITICAL_MAX_LINES = 150;

/**
 * Analyze files for function length issues
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object} Analysis results with function info and findings
 */
export function analyzeFunctionLength(filePaths) {
  const results = {
    functions: [],
    findings: []
  };

  for (const filePath of filePaths) {
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = parseFile(filePath);
      
      const fileFunctions = extractAllFunctions(ast, filePath, code);
      results.functions.push(...fileFunctions);
      
      // Generate findings for functions exceeding recommended length
      for (const func of fileFunctions) {
        if (func.effectiveLines > RECOMMENDED_MAX_LINES) {
          const severity = func.effectiveLines > CRITICAL_MAX_LINES ? 'moderate' : 'minor';
          const effort = func.effectiveLines > CRITICAL_MAX_LINES ? 'medium' : 'quick-win';
          const impact = Math.min(100, Math.floor((func.effectiveLines / RECOMMENDED_MAX_LINES) * 50));
          
          results.findings.push(createFinding({
            category: 'optimization',
            subcategory: 'long-function',
            severity,
            effort,
            impact,
            file: func.file,
            line: func.line,
            column: func.column,
            description: `Function '${func.name}' is ${func.effectiveLines} lines long (excluding comments/whitespace), exceeding the recommended ${RECOMMENDED_MAX_LINES} lines`,
            recommendation: func.effectiveLines > CRITICAL_MAX_LINES 
              ? `Split function '${func.name}' into smaller, focused functions. Consider extracting logical sections into helper functions.`
              : `Consider splitting function '${func.name}' into smaller functions for better maintainability.`,
            codeSnippet: func.snippet || ''
          }));
        }
      }
    } catch (error) {
      console.error(`[analyzeFunctionLength] Error analyzing ${filePath}:`, error.message);
    }
  }

  return results;
}

/**
 * Extract all functions from an AST with line count information
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @returns {Array} Array of function info objects
 */
function extractAllFunctions(ast, filePath, code) {
  const functions = [];
  
  traverse(ast, {
    FunctionDeclaration(node) {
      if (node.id && node.id.name) {
        const funcInfo = analyzeFunctionNode(node, node.id.name, 'FunctionDeclaration', filePath, code);
        functions.push(funcInfo);
      }
    },
    
    FunctionExpression(node, parent) {
      let name = '<anonymous>';
      
      // Try to get name from parent context
      if (parent && parent.type === 'VariableDeclarator' && parent.id) {
        name = parent.id.name;
      } else if (parent && parent.type === 'AssignmentExpression' && parent.left) {
        if (parent.left.type === 'Identifier') {
          name = parent.left.name;
        } else if (parent.left.type === 'MemberExpression' && parent.left.property) {
          name = parent.left.property.name || '<property>';
        }
      } else if (parent && parent.type === 'Property' && parent.key) {
        name = parent.key.name || parent.key.value || '<computed>';
      }
      
      const funcInfo = analyzeFunctionNode(node, name, 'FunctionExpression', filePath, code);
      functions.push(funcInfo);
    },
    
    ArrowFunctionExpression(node, parent) {
      let name = '<anonymous>';
      
      // Try to get name from parent context
      if (parent && parent.type === 'VariableDeclarator' && parent.id) {
        name = parent.id.name;
      } else if (parent && parent.type === 'AssignmentExpression' && parent.left) {
        if (parent.left.type === 'Identifier') {
          name = parent.left.name;
        } else if (parent.left.type === 'MemberExpression' && parent.left.property) {
          name = parent.left.property.name || '<property>';
        }
      } else if (parent && parent.type === 'Property' && parent.key) {
        name = parent.key.name || parent.key.value || '<computed>';
      }
      
      const funcInfo = analyzeFunctionNode(node, name, 'ArrowFunctionExpression', filePath, code);
      functions.push(funcInfo);
    }
  });
  
  return functions;
}

/**
 * Analyze a function node to extract line count information
 * @param {Object} node - Function AST node
 * @param {string} name - Function name
 * @param {string} type - Function type
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @returns {Object} Function analysis info
 */
function analyzeFunctionNode(node, name, type, filePath, code) {
  const line = node.loc ? node.loc.start.line : 0;
  const column = node.loc ? node.loc.start.column : 0;
  const endLine = node.loc ? node.loc.end.line : line;
  
  // Total lines including everything
  const totalLines = countFunctionLines(node);
  
  // Count effective lines (excluding comments and blank lines)
  const effectiveLines = countEffectiveLines(code, line, endLine);
  
  // Extract a preview snippet (first few lines)
  const snippet = extractSnippet(code, line, Math.min(line + 5, endLine));
  
  return {
    name,
    type,
    file: filePath,
    line,
    column,
    endLine,
    totalLines,
    effectiveLines,
    snippet
  };
}

/**
 * Count effective lines of code (excluding comments and whitespace)
 * @param {string} code - Source code
 * @param {number} startLine - Start line (1-indexed)
 * @param {number} endLine - End line (1-indexed)
 * @returns {number} Count of effective lines
 */
function countEffectiveLines(code, startLine, endLine) {
  const lines = code.split('\n');
  let effectiveCount = 0;
  let inBlockComment = false;
  
  for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
    let line = lines[i];
    
    // Remove string literals to avoid false positives with // or /* in strings
    line = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    line = line.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    line = line.replace(/`(?:[^`\\]|\\.)*`/g, '``');
    
    // Handle block comments
    if (inBlockComment) {
      const blockCommentEnd = line.indexOf('*/');
      if (blockCommentEnd !== -1) {
        inBlockComment = false;
        line = line.substring(blockCommentEnd + 2);
      } else {
        continue; // Entire line is in block comment
      }
    }
    
    // Check for block comment start
    const blockCommentStart = line.indexOf('/*');
    if (blockCommentStart !== -1) {
      const blockCommentEnd = line.indexOf('*/', blockCommentStart + 2);
      if (blockCommentEnd !== -1) {
        // Block comment starts and ends on same line
        line = line.substring(0, blockCommentStart) + line.substring(blockCommentEnd + 2);
      } else {
        // Block comment starts but doesn't end
        inBlockComment = true;
        line = line.substring(0, blockCommentStart);
      }
    }
    
    // Remove single-line comments
    const commentIndex = line.indexOf('//');
    if (commentIndex !== -1) {
      line = line.substring(0, commentIndex);
    }
    
    // Check if line has meaningful content after comment removal
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed !== '{' && trimmed !== '}') {
      effectiveCount++;
    }
  }
  
  return effectiveCount;
}

/**
 * Analyze a single file for function length issues
 * @param {string} filePath - File path to analyze
 * @returns {Object} Analysis results for the file
 */
export function analyzeFileFunctionLength(filePath) {
  return analyzeFunctionLength([filePath]);
}

/**
 * Generate a report for function length findings
 * @param {Object} results - Analysis results from analyzeFunctionLength
 * @returns {string} Formatted report
 */
export function generateFunctionLengthReport(results) {
  const { functions, findings } = results;
  
  let report = '# Function Length Analysis Report\n\n';
  
  // Summary
  report += `## Summary\n\n`;
  report += `- Total Functions Analyzed: ${functions.length}\n`;
  report += `- Functions Exceeding ${RECOMMENDED_MAX_LINES} Lines: ${findings.length}\n`;
  report += `- Functions Exceeding ${CRITICAL_MAX_LINES} Lines: ${findings.filter(f => f.severity === 'moderate').length}\n`;
  
  if (functions.length > 0) {
    const avgEffectiveLines = Math.round(
      functions.reduce((sum, f) => sum + f.effectiveLines, 0) / functions.length
    );
    const maxEffectiveLines = Math.max(...functions.map(f => f.effectiveLines));
    
    report += `- Average Function Length: ${avgEffectiveLines} lines\n`;
    report += `- Longest Function: ${maxEffectiveLines} lines\n`;
  }
  
  report += `\n`;
  
  // Long Functions
  if (findings.length > 0) {
    report += `## Long Functions\n\n`;
    
    // Sort by effective lines (longest first)
    const sortedFindings = [...findings].sort((a, b) => {
      const funcA = functions.find(f => f.file === a.file && f.line === a.line);
      const funcB = functions.find(f => f.file === b.file && f.line === b.line);
      return (funcB?.effectiveLines || 0) - (funcA?.effectiveLines || 0);
    });
    
    sortedFindings.forEach((finding, index) => {
      const func = functions.find(f => f.file === finding.file && f.line === finding.line);
      
      report += `### ${index + 1}. ${finding.description}\n`;
      report += `- **File**: ${finding.file}\n`;
      report += `- **Line**: ${finding.line}\n`;
      report += `- **Type**: ${func?.type || 'Unknown'}\n`;
      report += `- **Total Lines**: ${func?.totalLines || 'N/A'}\n`;
      report += `- **Effective Lines**: ${func?.effectiveLines || 'N/A'} (excluding comments/whitespace)\n`;
      report += `- **Severity**: ${finding.severity}\n`;
      report += `- **Recommendation**: ${finding.recommendation}\n`;
      
      if (finding.codeSnippet) {
        report += `- **Code Preview**:\n\`\`\`javascript\n${finding.codeSnippet}\n\`\`\`\n`;
      }
      
      report += `\n`;
    });
  } else {
    report += `## Result\n\n`;
    report += `✓ All functions are within recommended length guidelines (≤${RECOMMENDED_MAX_LINES} lines).\n\n`;
  }
  
  // Function length distribution
  if (functions.length > 0) {
    report += `## Function Length Distribution\n\n`;
    
    const ranges = [
      { label: '0-10 lines', min: 0, max: 10 },
      { label: '11-25 lines', min: 11, max: 25 },
      { label: '26-50 lines', min: 26, max: 50 },
      { label: '51-100 lines', min: 51, max: 100 },
      { label: '100+ lines', min: 101, max: Infinity }
    ];
    
    ranges.forEach(range => {
      const count = functions.filter(f => 
        f.effectiveLines >= range.min && f.effectiveLines <= range.max
      ).length;
      
      const percentage = Math.round((count / functions.length) * 100);
      const bar = '█'.repeat(Math.floor(percentage / 5));
      
      report += `- ${range.label.padEnd(15)}: ${count.toString().padStart(3)} (${percentage}%) ${bar}\n`;
    });
    
    report += `\n`;
  }
  
  return report;
}

/**
 * Get statistics about function lengths
 * @param {Object} results - Analysis results from analyzeFunctionLength
 * @returns {Object} Statistics object
 */
export function getFunctionLengthStats(results) {
  const { functions } = results;
  
  if (functions.length === 0) {
    return {
      total: 0,
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      exceeding50: 0,
      exceeding100: 0
    };
  }
  
  const effectiveLengths = functions.map(f => f.effectiveLines).sort((a, b) => a - b);
  
  return {
    total: functions.length,
    average: Math.round(effectiveLengths.reduce((sum, len) => sum + len, 0) / functions.length),
    median: effectiveLengths[Math.floor(effectiveLengths.length / 2)],
    min: effectiveLengths[0],
    max: effectiveLengths[effectiveLengths.length - 1],
    exceeding50: functions.filter(f => f.effectiveLines > RECOMMENDED_MAX_LINES).length,
    exceeding100: functions.filter(f => f.effectiveLines > CRITICAL_MAX_LINES).length
  };
}
