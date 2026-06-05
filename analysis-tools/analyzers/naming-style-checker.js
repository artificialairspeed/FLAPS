/**
 * Naming and Style Checker - Task 7.1
 * 
 * Identifies naming conventions and code style issues by:
 * 1. Checking variable naming (camelCase for variables, PascalCase for classes)
 * 2. Checking function naming conventions
 * 3. Identifying inconsistent naming patterns
 * 4. Checking for magic numbers (numbers without explanation)
 * 5. Identifying TODO/FIXME comments
 * 6. Checking for console.log statements (should be removed in production)
 * 7. Verifying consistent quote usage (single vs double)
 * 
 * Validates Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import * as fs from 'fs';
import { parseFile, traverse, extractSnippet } from '../parser.js';
import { createFinding } from '../models.js';

/**
 * Analyze files for naming and style issues
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object} Analysis results with findings
 */
export function analyzeNamingAndStyle(filePaths) {
  const results = {
    findings: [],
    statistics: {
      totalFunctions: 0,
      totalVariables: 0,
      varDeclarations: 0,
      consoleLogStatements: 0,
      magicNumbers: 0,
      todoComments: 0,
      namingViolations: 0,
      quoteInconsistencies: 0
    }
  };

  for (const filePath of filePaths) {
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = parseFile(filePath);
      
      // Check naming conventions
      checkFunctionNaming(ast, filePath, code, results);
      checkVariableNaming(ast, filePath, code, results);
      checkClassNaming(ast, filePath, code, results);
      
      // Check code style
      checkVarDeclarations(ast, filePath, code, results);
      checkConsoleLog(ast, filePath, code, results);
      checkMagicNumbers(ast, filePath, code, results);
      
      // Check comments and strings
      checkTodoComments(code, filePath, results);
      checkQuoteConsistency(code, filePath, results);
      
    } catch (error) {
      console.error(`[analyzeNamingAndStyle] Error parsing ${filePath}:`, error.message);
    }
  }

  return results;
}

/**
 * Check function naming conventions (should be camelCase)
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to populate
 */
function checkFunctionNaming(ast, filePath, code, results) {
  traverse(ast, {
    FunctionDeclaration(node) {
      if (node.id && node.id.name) {
        results.statistics.totalFunctions++;
        const name = node.id.name;
        const line = node.loc ? node.loc.start.line : 0;
        const column = node.loc ? node.loc.start.column : 0;
        
        if (!isCamelCase(name)) {
          results.statistics.namingViolations++;
          results.findings.push(createFinding({
            category: 'quality',
            subcategory: 'function-naming',
            severity: 'minor',
            effort: 'quick-win',
            impact: 30,
            file: filePath,
            line,
            column,
            description: `Function '${name}' does not follow camelCase naming convention`,
            recommendation: `Rename function to camelCase: ${toCamelCase(name)}`,
            codeSnippet: extractSnippet(code, line, line)
          }));
        }
      }
    },
    
    VariableDeclarator(node) {
      // Arrow functions and function expressions assigned to variables
      if (node.id && node.id.name && node.init) {
        if (node.init.type === 'FunctionExpression' || 
            node.init.type === 'ArrowFunctionExpression') {
          results.statistics.totalFunctions++;
          const name = node.id.name;
          const line = node.loc ? node.loc.start.line : 0;
          const column = node.loc ? node.loc.start.column : 0;
          
          if (!isCamelCase(name)) {
            results.statistics.namingViolations++;
            results.findings.push(createFinding({
              category: 'quality',
              subcategory: 'function-naming',
              severity: 'minor',
              effort: 'quick-win',
              impact: 30,
              file: filePath,
              line,
              column,
              description: `Function '${name}' does not follow camelCase naming convention`,
              recommendation: `Rename function to camelCase: ${toCamelCase(name)}`,
              codeSnippet: extractSnippet(code, line, line)
            }));
          }
        }
      }
    }
  });
}

/**
 * Check variable naming conventions (should be camelCase)
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to populate
 */
function checkVariableNaming(ast, filePath, code, results) {
  traverse(ast, {
    VariableDeclarator(node) {
      // Skip function expressions (handled separately)
      if (node.init && (
        node.init.type === 'FunctionExpression' || 
        node.init.type === 'ArrowFunctionExpression'
      )) {
        return;
      }
      
      if (node.id && node.id.name) {
        results.statistics.totalVariables++;
        const name = node.id.name;
        const line = node.loc ? node.loc.start.line : 0;
        const column = node.loc ? node.loc.start.column : 0;
        
        // Check if it's a constant (all caps with underscores is acceptable)
        const parent = node.id.parent;
        const isConstant = isAllCapsConstant(name);
        
        if (!isConstant && !isCamelCase(name)) {
          results.statistics.namingViolations++;
          results.findings.push(createFinding({
            category: 'quality',
            subcategory: 'variable-naming',
            severity: 'minor',
            effort: 'quick-win',
            impact: 30,
            file: filePath,
            line,
            column,
            description: `Variable '${name}' does not follow camelCase naming convention`,
            recommendation: `Rename variable to camelCase: ${toCamelCase(name)}`,
            codeSnippet: extractSnippet(code, line, line)
          }));
        }
      }
    }
  });
}

/**
 * Check class naming conventions (should be PascalCase)
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to populate
 */
function checkClassNaming(ast, filePath, code, results) {
  traverse(ast, {
    ClassDeclaration(node) {
      if (node.id && node.id.name) {
        const name = node.id.name;
        const line = node.loc ? node.loc.start.line : 0;
        const column = node.loc ? node.loc.start.column : 0;
        
        if (!isPascalCase(name)) {
          results.statistics.namingViolations++;
          results.findings.push(createFinding({
            category: 'quality',
            subcategory: 'class-naming',
            severity: 'minor',
            effort: 'quick-win',
            impact: 30,
            file: filePath,
            line,
            column,
            description: `Class '${name}' does not follow PascalCase naming convention`,
            recommendation: `Rename class to PascalCase: ${toPascalCase(name)}`,
            codeSnippet: extractSnippet(code, line, line)
          }));
        }
      }
    }
  });
}

/**
 * Check for var declarations (should be const or let)
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to populate
 */
function checkVarDeclarations(ast, filePath, code, results) {
  traverse(ast, {
    VariableDeclaration(node) {
      if (node.kind === 'var') {
        results.statistics.varDeclarations++;
        const line = node.loc ? node.loc.start.line : 0;
        const column = node.loc ? node.loc.start.column : 0;
        
        // Get variable names
        const varNames = node.declarations
          .map(d => d.id && d.id.name)
          .filter(Boolean)
          .join(', ');
        
        results.findings.push(createFinding({
          category: 'quality',
          subcategory: 'var-declaration',
          severity: 'minor',
          effort: 'quick-win',
          impact: 40,
          file: filePath,
          line,
          column,
          description: `Use of 'var' declaration for ${varNames}`,
          recommendation: `Replace 'var' with 'const' (if not reassigned) or 'let' (if reassigned)`,
          codeSnippet: extractSnippet(code, line, line)
        }));
      }
    }
  });
}

/**
 * Check for console.log statements
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to populate
 */
function checkConsoleLog(ast, filePath, code, results) {
  traverse(ast, {
    CallExpression(node) {
      // Check for console.log, console.warn, console.error, console.debug
      if (node.callee.type === 'MemberExpression') {
        const obj = node.callee.object;
        const prop = node.callee.property;
        
        if (obj.type === 'Identifier' && obj.name === 'console') {
          if (prop.type === 'Identifier' && 
              ['log', 'debug', 'trace'].includes(prop.name)) {
            results.statistics.consoleLogStatements++;
            const line = node.loc ? node.loc.start.line : 0;
            const column = node.loc ? node.loc.start.column : 0;
            
            results.findings.push(createFinding({
              category: 'quality',
              subcategory: 'console-log',
              severity: 'minor',
              effort: 'quick-win',
              impact: 50,
              file: filePath,
              line,
              column,
              description: `console.${prop.name}() statement found (should be removed in production)`,
              recommendation: `Remove console.${prop.name}() or replace with proper logging mechanism`,
              codeSnippet: extractSnippet(code, line, line)
            }));
          }
        }
      }
    }
  });
}

/**
 * Check for magic numbers (numbers without explanation)
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @param {Object} results - Results object to populate
 */
function checkMagicNumbers(ast, filePath, code, results) {
  const allowedNumbers = new Set([0, 1, -1, 2, 10, 100, 1000]);
  
  traverse(ast, {
    NumericLiteral(node, parent) {
      const value = node.value;
      
      // Skip allowed numbers
      if (allowedNumbers.has(value)) {
        return;
      }
      
      // Skip if in constant declaration
      if (parent && parent.type === 'VariableDeclarator') {
        const parentDeclaration = findParentVariableDeclaration(parent);
        if (parentDeclaration && parentDeclaration.kind === 'const') {
          // Check if the variable name is all caps (constant)
          if (parent.id && parent.id.name && isAllCapsConstant(parent.id.name)) {
            return;
          }
        }
      }
      
      // Skip if in array index
      if (parent && parent.type === 'MemberExpression' && parent.computed) {
        return;
      }
      
      results.statistics.magicNumbers++;
      const line = node.loc ? node.loc.start.line : 0;
      const column = node.loc ? node.loc.start.column : 0;
      
      results.findings.push(createFinding({
        category: 'quality',
        subcategory: 'magic-number',
        severity: 'minor',
        effort: 'medium',
        impact: 40,
        file: filePath,
        line,
        column,
        description: `Magic number ${value} found without explanation`,
        recommendation: `Extract magic number ${value} into a named constant with descriptive name`,
        codeSnippet: extractSnippet(code, line, line)
      }));
    }
  });
}

/**
 * Check for TODO/FIXME comments
 * @param {string} code - Source code
 * @param {string} filePath - File path
 * @param {Object} results - Results object to populate
 */
function checkTodoComments(code, filePath, results) {
  const lines = code.split('\n');
  const todoPattern = /\b(TODO|FIXME|HACK|XXX|NOTE|BUG)\b/i;
  
  lines.forEach((line, index) => {
    const match = line.match(todoPattern);
    if (match) {
      results.statistics.todoComments++;
      const lineNumber = index + 1;
      const keyword = match[1];
      
      results.findings.push(createFinding({
        category: 'quality',
        subcategory: 'todo-comment',
        severity: 'minor',
        effort: 'medium',
        impact: 20,
        file: filePath,
        line: lineNumber,
        column: match.index,
        description: `${keyword} comment found: ${line.trim()}`,
        recommendation: `Address or track the ${keyword} comment in issue tracking system`,
        codeSnippet: line.trim()
      }));
    }
  });
}

/**
 * Check for consistent quote usage
 * @param {string} code - Source code
 * @param {string} filePath - File path
 * @param {Object} results - Results object to populate
 */
function checkQuoteConsistency(code, filePath, results) {
  const lines = code.split('\n');
  let singleQuoteCount = 0;
  let doubleQuoteCount = 0;
  
  // Count quote types (excluding template literals)
  const singleQuotePattern = /'[^']*'/g;
  const doubleQuotePattern = /"[^"]*"/g;
  
  lines.forEach((line, index) => {
    // Skip comments and template literals
    const cleanedLine = line
      .replace(/\/\/.*$/, '')  // Remove single-line comments
      .replace(/`[^`]*`/g, ''); // Remove template literals
    
    const singleMatches = cleanedLine.match(singleQuotePattern);
    const doubleMatches = cleanedLine.match(doubleQuotePattern);
    
    if (singleMatches) singleQuoteCount += singleMatches.length;
    if (doubleMatches) doubleQuoteCount += doubleMatches.length;
  });
  
  // If there's significant mixing (both types used, and neither is overwhelming)
  const totalQuotes = singleQuoteCount + doubleQuoteCount;
  if (totalQuotes > 10) {
    const singlePercent = (singleQuoteCount / totalQuotes) * 100;
    const doublePercent = (doubleQuoteCount / totalQuotes) * 100;
    
    // Flag if both types are used significantly (neither is > 80%)
    if (singlePercent > 20 && doublePercent > 20) {
      results.statistics.quoteInconsistencies++;
      results.findings.push(createFinding({
        category: 'quality',
        subcategory: 'quote-inconsistency',
        severity: 'minor',
        effort: 'medium',
        impact: 20,
        file: filePath,
        line: 1,
        column: 0,
        description: `Inconsistent quote usage: ${singleQuoteCount} single quotes, ${doubleQuoteCount} double quotes`,
        recommendation: `Standardize on one quote style (single quotes preferred for JavaScript)`,
        codeSnippet: `File uses mixed quotes (${singlePercent.toFixed(1)}% single, ${doublePercent.toFixed(1)}% double)`
      }));
    }
  }
}

/**
 * Check if a name follows camelCase convention
 * @param {string} name - Identifier name
 * @returns {boolean}
 */
function isCamelCase(name) {
  // Allow single letter variables
  if (name.length === 1) return true;
  
  // Allow common patterns like __dirname, __filename
  if (name.startsWith('__')) return true;
  
  // Must start with lowercase letter
  if (!/^[a-z]/.test(name)) return false;
  
  // No underscores or hyphens (except leading __)
  if (/_|-/.test(name)) return false;
  
  // No consecutive uppercase letters (except acronyms at end)
  if (/[A-Z]{2,}/.test(name) && !/[A-Z]{2,}$/.test(name)) return false;
  
  return true;
}

/**
 * Check if a name follows PascalCase convention
 * @param {string} name - Identifier name
 * @returns {boolean}
 */
function isPascalCase(name) {
  // Must start with uppercase letter
  if (!/^[A-Z]/.test(name)) return false;
  
  // No underscores or hyphens
  if (/_|-/.test(name)) return false;
  
  return true;
}

/**
 * Check if a name is an all-caps constant
 * @param {string} name - Identifier name
 * @returns {boolean}
 */
function isAllCapsConstant(name) {
  // All uppercase with optional underscores
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * Convert a name to camelCase (suggestion)
 * @param {string} name - Identifier name
 * @returns {string}
 */
function toCamelCase(name) {
  // If already camelCase, return as is
  if (isCamelCase(name)) return name;
  
  // Handle snake_case
  if (name.includes('_')) {
    return name
      .split('_')
      .map((word, index) => {
        if (index === 0) return word.toLowerCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join('');
  }
  
  // Handle kebab-case
  if (name.includes('-')) {
    return name
      .split('-')
      .map((word, index) => {
        if (index === 0) return word.toLowerCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join('');
  }
  
  // If starts with uppercase, make it lowercase
  if (/^[A-Z]/.test(name)) {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }
  
  return name;
}

/**
 * Convert a name to PascalCase (suggestion)
 * @param {string} name - Identifier name
 * @returns {string}
 */
function toPascalCase(name) {
  // If already PascalCase, return as is
  if (isPascalCase(name)) return name;
  
  // Handle snake_case or kebab-case
  if (name.includes('_') || name.includes('-')) {
    const separator = name.includes('_') ? '_' : '-';
    return name
      .split(separator)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
  
  // If starts with lowercase, make it uppercase
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Find parent VariableDeclaration node
 * @param {Object} node - AST node
 * @returns {Object|null}
 */
function findParentVariableDeclaration(node) {
  // This is a simple helper that would need proper parent tracking
  // For now, we'll just return null as parent tracking is complex
  return null;
}

/**
 * Generate a report for naming and style findings
 * @param {Object} results - Analysis results from analyzeNamingAndStyle
 * @returns {string} Formatted report
 */
export function generateNamingStyleReport(results) {
  const { findings, statistics } = results;
  
  let report = '# Naming and Style Analysis Report\n\n';
  
  // Summary
  report += `## Summary\n\n`;
  report += `- Total Functions: ${statistics.totalFunctions}\n`;
  report += `- Total Variables: ${statistics.totalVariables}\n`;
  report += `- Naming Violations: ${statistics.namingViolations}\n`;
  report += `- var Declarations: ${statistics.varDeclarations}\n`;
  report += `- console.log Statements: ${statistics.consoleLogStatements}\n`;
  report += `- Magic Numbers: ${statistics.magicNumbers}\n`;
  report += `- TODO Comments: ${statistics.todoComments}\n`;
  report += `- Quote Inconsistencies: ${statistics.quoteInconsistencies}\n`;
  report += `- Total Issues Found: ${findings.length}\n\n`;
  
  // Group findings by subcategory
  const bySubcategory = {};
  findings.forEach(finding => {
    if (!bySubcategory[finding.subcategory]) {
      bySubcategory[finding.subcategory] = [];
    }
    bySubcategory[finding.subcategory].push(finding);
  });
  
  // Report each category
  const categoryTitles = {
    'function-naming': 'Function Naming Issues',
    'variable-naming': 'Variable Naming Issues',
    'class-naming': 'Class Naming Issues',
    'var-declaration': 'var Declarations',
    'console-log': 'console.log Statements',
    'magic-number': 'Magic Numbers',
    'todo-comment': 'TODO/FIXME Comments',
    'quote-inconsistency': 'Quote Inconsistencies'
  };
  
  Object.entries(bySubcategory).forEach(([subcategory, subFindings]) => {
    report += `## ${categoryTitles[subcategory] || subcategory}\n\n`;
    subFindings.forEach((finding, index) => {
      report += `### ${index + 1}. ${finding.description}\n`;
      report += `- **File**: ${finding.file}\n`;
      report += `- **Line**: ${finding.line}\n`;
      report += `- **Recommendation**: ${finding.recommendation}\n`;
      if (finding.codeSnippet) {
        report += `- **Code**: \`${finding.codeSnippet.trim()}\`\n`;
      }
      report += `\n`;
    });
  });
  
  return report;
}

/**
 * Analyze a single file for naming and style issues
 * @param {string} filePath - File path to analyze
 * @returns {Object} Analysis results for the file
 */
export function analyzeFileNamingStyle(filePath) {
  return analyzeNamingAndStyle([filePath]);
}

