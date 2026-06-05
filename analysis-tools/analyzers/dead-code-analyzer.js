/**
 * Dead Code Analyzer - Identifies unused functions and variables
 * Task 2.1: Create function and variable usage tracker
 * Requirements: 1.1, 1.2
 */

import { parseFile, extractFunctions, extractVariables, extractCalls, extractIdentifiers, extractSnippet, traverse } from '../parser.js';
import { createFinding } from '../models.js';
import * as fs from 'fs';

/**
 * Symbol table for tracking function definitions and calls
 * @typedef {Object} SymbolTable
 * @property {Map<string, FunctionInfo>} functions - Function definitions
 * @property {Set<string>} functionCalls - Function invocations
 * @property {Map<string, VariableInfo>} variables - Variable declarations
 * @property {Set<string>} variableReferences - Variable references
 */

/**
 * Function information
 * @typedef {Object} FunctionInfo
 * @property {string} name - Function name
 * @property {string} file - File path
 * @property {number} line - Line number
 * @property {number} column - Column number
 * @property {string} type - Function type (FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)
 * @property {string[]} calledFrom - Files where this function is called
 */

/**
 * Variable information
 * @typedef {Object} VariableInfo
 * @property {string} name - Variable name
 * @property {string} file - File path
 * @property {number} line - Line number
 * @property {number} column - Column number
 * @property {string} kind - Variable kind (const, let, var)
 * @property {string[]} referencedFrom - Files where this variable is referenced
 */

/**
 * Build symbol tables for the given files
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {SymbolTable} Symbol table with functions and variables
 */
export function buildSymbolTables(filePaths) {
  const symbolTable = {
    functions: new Map(),
    functionCalls: new Set(),
    variables: new Map(),
    variableReferences: new Set()
  };

  // First pass: collect all definitions
  for (const filePath of filePaths) {
    try {
      const ast = parseFile(filePath);
      const code = fs.readFileSync(filePath, 'utf-8');

      // Extract function definitions
      const functions = extractFunctions(ast);
      functions.forEach(fn => {
        // Only track named functions (skip anonymous)
        if (fn.name && fn.name !== '<anonymous>' && fn.name !== '<property>' && fn.name !== '<computed>') {
          if (!symbolTable.functions.has(fn.name)) {
            symbolTable.functions.set(fn.name, {
              name: fn.name,
              file: filePath,
              line: fn.line,
              column: fn.column,
              type: fn.type,
              calledFrom: []
            });
          }
        }
      });

      // Extract variable declarations
      const variables = extractVariablesWithKind(ast);
      variables.forEach(variable => {
        // Skip parameters and common names that are likely used
        if (variable.name && !isCommonName(variable.name)) {
          const key = `${filePath}:${variable.name}`;
          if (!symbolTable.variables.has(key)) {
            symbolTable.variables.set(key, {
              name: variable.name,
              file: filePath,
              line: variable.line,
              column: variable.column,
              kind: variable.kind,
              referencedFrom: []
            });
          }
        }
      });
    } catch (error) {
      console.error(`Error analyzing ${filePath}:`, error.message);
    }
  }

  // Second pass: collect all references
  for (const filePath of filePaths) {
    try {
      const ast = parseFile(filePath);

      // Extract function calls
      const calls = extractCalls(ast);
      calls.forEach(call => {
        if (call.callee && call.callee !== '<unknown>') {
          symbolTable.functionCalls.add(call.callee);
          
          // Track where function is called from
          if (symbolTable.functions.has(call.callee)) {
            const funcInfo = symbolTable.functions.get(call.callee);
            if (!funcInfo.calledFrom.includes(filePath)) {
              funcInfo.calledFrom.push(filePath);
            }
          }
        }
      });

      // Extract all identifier references
      const identifiers = extractIdentifiers(ast);
      identifiers.forEach(identifier => {
        symbolTable.variableReferences.add(identifier);
        
        // Track where variable is referenced from
        for (const [key, varInfo] of symbolTable.variables.entries()) {
          if (varInfo.name === identifier && !varInfo.referencedFrom.includes(filePath)) {
            varInfo.referencedFrom.push(filePath);
          }
        }
      });
    } catch (error) {
      console.error(`Error analyzing references in ${filePath}:`, error.message);
    }
  }

  return symbolTable;
}

/**
 * Extract variables with their declaration kind (const, let, var)
 * @param {Object} ast - Babel AST
 * @returns {Array} Array of variable info objects
 */
function extractVariablesWithKind(ast) {
  const variables = [];
  
  traverse(ast, {
    VariableDeclaration(node) {
      const kind = node.kind || 'var';
      
      if (node.declarations) {
        node.declarations.forEach(declarator => {
          if (declarator.id) {
            // Handle simple identifiers
            if (declarator.id.type === 'Identifier') {
              variables.push({
                name: declarator.id.name,
                kind,
                line: declarator.loc ? declarator.loc.start.line : 0,
                column: declarator.loc ? declarator.loc.start.column : 0
              });
            }
            // Handle destructuring patterns
            else if (declarator.id.type === 'ObjectPattern' || declarator.id.type === 'ArrayPattern') {
              extractDestructuredVariables(declarator.id, kind, variables);
            }
          }
        });
      }
    }
  });
  
  return variables;
}

/**
 * Extract variables from destructuring patterns
 * @param {Object} pattern - ObjectPattern or ArrayPattern node
 * @param {string} kind - Variable kind (const, let, var)
 * @param {Array} variables - Array to append variables to
 */
function extractDestructuredVariables(pattern, kind, variables) {
  if (pattern.type === 'ObjectPattern') {
    pattern.properties.forEach(prop => {
      if (prop.value && prop.value.type === 'Identifier') {
        variables.push({
          name: prop.value.name,
          kind,
          line: prop.value.loc ? prop.value.loc.start.line : 0,
          column: prop.value.loc ? prop.value.loc.start.column : 0
        });
      } else if (prop.value && (prop.value.type === 'ObjectPattern' || prop.value.type === 'ArrayPattern')) {
        extractDestructuredVariables(prop.value, kind, variables);
      }
    });
  } else if (pattern.type === 'ArrayPattern') {
    pattern.elements.forEach(element => {
      if (element && element.type === 'Identifier') {
        variables.push({
          name: element.name,
          kind,
          line: element.loc ? element.loc.start.line : 0,
          column: element.loc ? element.loc.start.column : 0
        });
      } else if (element && (element.type === 'ObjectPattern' || element.type === 'ArrayPattern')) {
        extractDestructuredVariables(element, kind, variables);
      }
    });
  }
}

/**
 * Check if a name is common and likely to be used (to avoid false positives)
 * @param {string} name - Variable or function name
 * @returns {boolean} True if common name
 */
function isCommonName(name) {
  const commonNames = [
    'i', 'j', 'k', 'x', 'y', 'z', // Loop counters
    'err', 'error', 'e', // Error handling
    'req', 'res', 'next', // Express patterns
    'socket', 'io', 'app', // Common module names
    '_', '__' // Placeholder names
  ];
  
  return commonNames.includes(name);
}

/**
 * Analyze dead code (unused functions and variables)
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object[]} Array of findings
 */
export function analyzeDeadCode(filePaths) {
  const findings = [];
  const symbolTable = buildSymbolTables(filePaths);

  // Identify unused functions
  for (const [name, funcInfo] of symbolTable.functions.entries()) {
    // Check if function is never called
    if (!symbolTable.functionCalls.has(name) && funcInfo.calledFrom.length === 0) {
      // Read code snippet for context
      let codeSnippet = '';
      try {
        const code = fs.readFileSync(funcInfo.file, 'utf-8');
        const lines = code.split('\n');
        const startLine = Math.max(0, funcInfo.line - 1);
        const endLine = Math.min(lines.length, funcInfo.line + 2);
        codeSnippet = lines.slice(startLine, endLine).join('\n');
      } catch (error) {
        codeSnippet = `Error reading file: ${error.message}`;
      }

      findings.push(createFinding({
        category: 'dead-code',
        subcategory: 'unused-function',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 60,
        file: funcInfo.file,
        line: funcInfo.line,
        column: funcInfo.column,
        description: `Function '${name}' is defined but never called`,
        recommendation: `Remove the unused function '${name}' or verify if it should be exported/used`,
        codeSnippet
      }));
    }
  }

  // Identify unused variables
  for (const [key, varInfo] of symbolTable.variables.entries()) {
    // Check if variable is never referenced
    // Note: We need to be careful with variable names that might be used in different scopes
    if (!symbolTable.variableReferences.has(varInfo.name) && varInfo.referencedFrom.length === 0) {
      // Read code snippet for context
      let codeSnippet = '';
      try {
        const code = fs.readFileSync(varInfo.file, 'utf-8');
        const lines = code.split('\n');
        const startLine = Math.max(0, varInfo.line - 1);
        const endLine = Math.min(lines.length, varInfo.line + 1);
        codeSnippet = lines.slice(startLine, endLine).join('\n');
      } catch (error) {
        codeSnippet = `Error reading file: ${error.message}`;
      }

      findings.push(createFinding({
        category: 'dead-code',
        subcategory: 'unused-variable',
        severity: 'minor',
        effort: 'quick-win',
        impact: 40,
        file: varInfo.file,
        line: varInfo.line,
        column: varInfo.column,
        description: `Variable '${varInfo.name}' is declared but never referenced`,
        recommendation: `Remove the unused ${varInfo.kind} declaration for '${varInfo.name}'`,
        codeSnippet
      }));
    }
  }

  return findings;
}

/**
 * Main entry point for dead code analysis
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object} Analysis results with findings and symbol table
 */
export function analyze(filePaths) {
  const findings = analyzeDeadCode(filePaths);
  const symbolTable = buildSymbolTables(filePaths);
  
  return {
    findings,
    symbolTable: {
      functionsCount: symbolTable.functions.size,
      variablesCount: symbolTable.variables.size,
      functionCallsCount: symbolTable.functionCalls.size,
      variableReferencesCount: symbolTable.variableReferences.size
    }
  };
}
