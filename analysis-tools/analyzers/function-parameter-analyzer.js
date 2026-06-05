/**
 * Function Parameter Analyzer - Identifies unused function parameters
 * Task 16.2: Simplify function signatures
 * Requirements: 4.5, 4.10
 */

import { parseFile, traverse } from '../parser.js';
import { createFinding } from '../models.js';
import * as fs from 'fs';

/**
 * Extract function information including parameters
 * @param {Object} ast - Babel AST
 * @param {string} filePath - Source file path
 * @returns {Array} Array of function info objects
 */
function extractFunctionsWithParams(ast, filePath) {
  const functions = [];
  
  traverse(ast, {
    FunctionDeclaration(node) {
      functions.push(extractFunctionInfo(node, filePath, 'FunctionDeclaration'));
    },
    FunctionExpression(node) {
      // Only track named function expressions or those assigned to variables
      functions.push(extractFunctionInfo(node, filePath, 'FunctionExpression'));
    },
    ArrowFunctionExpression(node) {
      functions.push(extractFunctionInfo(node, filePath, 'ArrowFunctionExpression'));
    }
  });
  
  return functions;
}

/**
 * Extract function information including parameters and their usage
 * @param {Object} node - Function AST node
 * @param {string} filePath - Source file path
 * @param {string} type - Function type
 * @returns {Object} Function info object
 */
function extractFunctionInfo(node, filePath, type) {
  const name = getFunctionName(node);
  const params = node.params || [];
  const paramNames = params.map(p => extractParamName(p)).filter(Boolean);
  
  // Find which parameters are actually used in the function body
  const usedParams = new Set();
  if (node.body) {
    findParameterUsage(node.body, paramNames, usedParams);
  }
  
  // Identify unused parameters
  const unusedParams = paramNames.filter(p => !usedParams.has(p));
  
  return {
    name,
    file: filePath,
    line: node.loc ? node.loc.start.line : 0,
    column: node.loc ? node.loc.start.column : 0,
    type,
    params: paramNames,
    unusedParams,
    hasUnusedParams: unusedParams.length > 0
  };
}

/**
 * Get function name from AST node
 * @param {Object} node - Function AST node
 * @returns {string} Function name or descriptor
 */
function getFunctionName(node) {
  if (node.id && node.id.name) {
    return node.id.name;
  }
  
  // For arrow functions and function expressions, try to get name from parent
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    // This will be filled in by the parent context if available
    return '<anonymous>';
  }
  
  return '<anonymous>';
}

/**
 * Extract parameter name from parameter node
 * @param {Object} param - Parameter AST node
 * @returns {string|null} Parameter name
 */
function extractParamName(param) {
  if (!param) return null;
  
  switch (param.type) {
    case 'Identifier':
      return param.name;
    case 'AssignmentPattern':
      // Default parameter: param = defaultValue
      return extractParamName(param.left);
    case 'RestElement':
      // Rest parameter: ...rest
      return extractParamName(param.argument);
    case 'ObjectPattern':
      // Destructured object parameter - we'll track the whole pattern as used
      // if any property is used
      return null; // Skip destructured params for now
    case 'ArrayPattern':
      // Destructured array parameter
      return null; // Skip destructured params for now
    default:
      return null;
  }
}

/**
 * Find which parameters are used in the function body
 * @param {Object} body - Function body AST node
 * @param {string[]} paramNames - Array of parameter names to check
 * @param {Set<string>} usedParams - Set to accumulate used parameter names
 */
function findParameterUsage(body, paramNames, usedParams) {
  if (!body) return;
  
  traverse(body, {
    Identifier(node) {
      if (paramNames.includes(node.name)) {
        usedParams.add(node.name);
      }
    },
    // Don't traverse into nested function scopes
    FunctionDeclaration(node) {
      // Skip - don't look into nested functions
      return 'skip';
    },
    FunctionExpression(node) {
      // Skip - don't look into nested functions
      return 'skip';
    },
    ArrowFunctionExpression(node) {
      // Skip - don't look into nested functions
      return 'skip';
    }
  });
}

/**
 * Analyze function parameters for unused parameters
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object[]} Array of findings
 */
export function analyzeFunctionParameters(filePaths) {
  const findings = [];
  
  for (const filePath of filePaths) {
    try {
      const ast = parseFile(filePath);
      const functions = extractFunctionsWithParams(ast, filePath);
      
      for (const func of functions) {
        if (func.hasUnusedParams && func.name !== '<anonymous>') {
          // Read code snippet for context
          let codeSnippet = '';
          try {
            const code = fs.readFileSync(filePath, 'utf-8');
            const lines = code.split('\n');
            const startLine = Math.max(0, func.line - 1);
            const endLine = Math.min(lines.length, func.line + 3);
            codeSnippet = lines.slice(startLine, endLine).join('\n');
          } catch (error) {
            codeSnippet = `Error reading file: ${error.message}`;
          }
          
          findings.push(createFinding({
            category: 'deprecation',
            subcategory: 'unused-parameter',
            severity: 'minor',
            effort: 'quick-win',
            impact: 50,
            file: filePath,
            line: func.line,
            column: func.column,
            description: `Function '${func.name}' has unused parameter(s): ${func.unusedParams.join(', ')}`,
            recommendation: `Remove unused parameter(s) '${func.unusedParams.join(', ')}' from function '${func.name}' and update all call sites`,
            codeSnippet,
            metadata: {
              functionName: func.name,
              unusedParams: func.unusedParams,
              allParams: func.params
            }
          }));
        }
      }
    } catch (error) {
      console.error(`Error analyzing ${filePath}:`, error.message);
    }
  }
  
  return findings;
}

/**
 * Main entry point for function parameter analysis
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object} Analysis results with findings
 */
export function analyze(filePaths) {
  const findings = analyzeFunctionParameters(filePaths);
  
  return {
    findings,
    summary: {
      totalFunctionsChecked: findings.length,
      totalUnusedParams: findings.reduce((sum, f) => sum + (f.metadata?.unusedParams?.length || 0), 0)
    }
  };
}
