/**
 * AST parsing infrastructure for JavaScript code analysis
 */

import * as babelParser from '@babel/parser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse JavaScript source code into an AST
 * @param {string} code - JavaScript source code
 * @param {Object} options - Parser options
 * @returns {Object} Babel AST
 */
export function parseCode(code, options = {}) {
  const defaultOptions = {
    sourceType: 'module',
    plugins: [
      'jsx',
      'classProperties',
      'objectRestSpread',
      'optionalChaining',
      'nullishCoalescingOperator'
    ],
    ...options
  };
  
  try {
    return babelParser.parse(code, defaultOptions);
  } catch (error) {
    throw new Error(`Parse error: ${error.message}`);
  }
}

/**
 * Parse a JavaScript file into an AST
 * @param {string} filePath - Path to JavaScript file
 * @returns {Object} Babel AST
 */
export function parseFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    return parseCode(code);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Traverse an AST and execute visitor functions for each node type
 * @param {Object} ast - Babel AST
 * @param {Object} visitors - Map of node types to visitor functions
 */
export function traverse(ast, visitors) {
  function visit(node, parent = null) {
    if (!node || typeof node !== 'object') {
      return;
    }
    
    // Call visitor if it exists for this node type
    if (node.type && visitors[node.type]) {
      visitors[node.type](node, parent);
    }
    
    // Recursively visit all properties
    for (const key in node) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
        continue; // Skip location metadata
      }
      
      const value = node[key];
      
      if (Array.isArray(value)) {
        value.forEach(child => visit(child, node));
      } else if (value && typeof value === 'object' && value.type) {
        visit(value, node);
      }
    }
  }
  
  visit(ast);
}

/**
 * Extract all function declarations and expressions from an AST
 * @param {Object} ast - Babel AST
 * @returns {Array} Array of function info objects
 */
export function extractFunctions(ast) {
  const functions = [];
  
  traverse(ast, {
    FunctionDeclaration(node) {
      functions.push({
        type: 'FunctionDeclaration',
        name: node.id ? node.id.name : '<anonymous>',
        params: node.params.map(p => p.name || '<complex>'),
        line: node.loc ? node.loc.start.line : 0,
        column: node.loc ? node.loc.start.column : 0
      });
    },
    FunctionExpression(node, parent) {
      let name = '<anonymous>';
      if (parent && parent.type === 'VariableDeclarator' && parent.id) {
        name = parent.id.name;
      } else if (parent && parent.type === 'AssignmentExpression' && parent.left) {
        name = parent.left.name || '<property>';
      }
      
      functions.push({
        type: 'FunctionExpression',
        name,
        params: node.params.map(p => p.name || '<complex>'),
        line: node.loc ? node.loc.start.line : 0,
        column: node.loc ? node.loc.start.column : 0
      });
    },
    ArrowFunctionExpression(node, parent) {
      let name = '<anonymous>';
      if (parent && parent.type === 'VariableDeclarator' && parent.id) {
        name = parent.id.name;
      } else if (parent && parent.type === 'AssignmentExpression' && parent.left) {
        name = parent.left.name || '<property>';
      } else if (parent && parent.type === 'Property' && parent.key) {
        name = parent.key.name || '<computed>';
      }
      
      functions.push({
        type: 'ArrowFunctionExpression',
        name,
        params: node.params.map(p => p.name || '<complex>'),
        line: node.loc ? node.loc.start.line : 0,
        column: node.loc ? node.loc.start.column : 0
      });
    }
  });
  
  return functions;
}

/**
 * Extract all variable declarations from an AST
 * @param {Object} ast - Babel AST
 * @returns {Array} Array of variable info objects
 */
export function extractVariables(ast) {
  const variables = [];
  
  traverse(ast, {
    VariableDeclarator(node) {
      if (node.id && node.id.name) {
        variables.push({
          name: node.id.name,
          kind: 'let', // Will be refined by parent VariableDeclaration
          line: node.loc ? node.loc.start.line : 0,
          column: node.loc ? node.loc.start.column : 0
        });
      }
    }
  });
  
  return variables;
}

/**
 * Extract all function calls from an AST
 * @param {Object} ast - Babel AST
 * @returns {Array} Array of call info objects
 */
export function extractCalls(ast) {
  const calls = [];
  
  traverse(ast, {
    CallExpression(node) {
      let callee = '<unknown>';
      
      if (node.callee.type === 'Identifier') {
        callee = node.callee.name;
      } else if (node.callee.type === 'MemberExpression') {
        if (node.callee.property && node.callee.property.name) {
          callee = node.callee.property.name;
        }
      }
      
      calls.push({
        callee,
        line: node.loc ? node.loc.start.line : 0,
        column: node.loc ? node.loc.start.column : 0
      });
    }
  });
  
  return calls;
}

/**
 * Extract all identifier references from an AST
 * @param {Object} ast - Babel AST
 * @returns {Array} Array of identifier names
 */
export function extractIdentifiers(ast) {
  const identifiers = new Set();
  
  traverse(ast, {
    Identifier(node, parent) {
      // Skip identifiers in declaration positions
      if (parent && (
        parent.type === 'FunctionDeclaration' ||
        parent.type === 'VariableDeclarator' ||
        parent.type === 'ClassDeclaration'
      )) {
        if (parent.id === node) {
          return;
        }
      }
      
      identifiers.add(node.name);
    }
  });
  
  return Array.from(identifiers);
}

/**
 * Get the nesting depth of a node
 * @param {Object} node - AST node
 * @param {number} currentDepth - Current nesting depth
 * @returns {number} Maximum nesting depth
 */
export function getNestingDepth(node, currentDepth = 0) {
  if (!node || typeof node !== 'object') {
    return currentDepth;
  }
  
  let maxDepth = currentDepth;
  
  // Check if this node adds to nesting depth
  if (node.type === 'IfStatement' || 
      node.type === 'WhileStatement' || 
      node.type === 'ForStatement' ||
      node.type === 'SwitchStatement') {
    currentDepth++;
  }
  
  // Recursively check all child nodes
  for (const key in node) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
      continue;
    }
    
    const value = node[key];
    
    if (Array.isArray(value)) {
      value.forEach(child => {
        const depth = getNestingDepth(child, currentDepth);
        maxDepth = Math.max(maxDepth, depth);
      });
    } else if (value && typeof value === 'object' && value.type) {
      const depth = getNestingDepth(value, currentDepth);
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  
  return maxDepth;
}

/**
 * Count the number of lines in a function node
 * @param {Object} node - Function AST node
 * @returns {number} Number of lines
 */
export function countFunctionLines(node) {
  if (!node.loc) {
    return 0;
  }
  
  return node.loc.end.line - node.loc.start.line + 1;
}

/**
 * Extract code snippet from source at given location
 * @param {string} code - Source code
 * @param {number} startLine - Start line (1-indexed)
 * @param {number} endLine - End line (1-indexed)
 * @returns {string} Code snippet
 */
export function extractSnippet(code, startLine, endLine) {
  const lines = code.split('\n');
  const snippet = lines.slice(startLine - 1, endLine).join('\n');
  return snippet;
}

/**
 * Normalize a code block for comparison
 * Removes whitespace and normalizes variable names
 * @param {string} code - Code block
 * @returns {string} Normalized code
 */
export function normalizeCode(code) {
  // Remove all whitespace
  let normalized = code.replace(/\s+/g, ' ').trim();
  
  // Normalize string literals
  normalized = normalized.replace(/"[^"]*"/g, '"STRING"');
  normalized = normalized.replace(/'[^']*'/g, "'STRING'");
  
  // Normalize number literals
  normalized = normalized.replace(/\b\d+(\.\d+)?\b/g, 'NUM');
  
  return normalized;
}
