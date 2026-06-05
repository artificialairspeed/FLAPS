/**
 * DOM Reference Cross-Validator
 * 
 * Analyzes DOM references in JavaScript and cross-validates them against HTML
 * Identifies orphaned DOM references (el('id'), getElementById) that don't exist in HTML
 * 
 * Validates Requirement 1.3: DOM element IDs referenced in JavaScript but missing from index.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseFile, traverse } from '../parser.js';
import { createFinding } from '../models.js';
import { JSDOM } from 'jsdom';

/**
 * Extract all DOM element IDs from HTML file
 * @param {string} htmlFilePath - Path to HTML file
 * @returns {Set<string>} Set of element IDs found in HTML
 */
export function extractHtmlIds(htmlFilePath) {
  const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
  const ids = new Set();
  
  // Parse HTML using jsdom
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;
  
  // Find all elements with an id attribute
  const elementsWithId = document.querySelectorAll('[id]');
  elementsWithId.forEach(element => {
    if (element.id) {
      ids.add(element.id);
    }
  });
  
  return ids;
}

/**
 * Extract all DOM ID references from JavaScript file
 * Looks for: el('id'), document.getElementById('id'), document.getElementById("id")
 * @param {string} jsFilePath - Path to JavaScript file
 * @returns {Array<{id: string, line: number, column: number, method: string}>} Array of DOM references
 */
export function extractJsDomReferences(jsFilePath) {
  const code = fs.readFileSync(jsFilePath, 'utf-8');
  const ast = parseFile(jsFilePath);
  const references = [];
  
  traverse(ast, {
    CallExpression(node) {
      // Check for el('id') pattern
      if (node.callee.type === 'Identifier' && node.callee.name === 'el') {
        if (node.arguments.length > 0 && node.arguments[0].type === 'StringLiteral') {
          references.push({
            id: node.arguments[0].value,
            line: node.loc ? node.loc.start.line : 0,
            column: node.loc ? node.loc.start.column : 0,
            method: 'el()'
          });
        }
      }
      
      // Check for document.getElementById('id') pattern
      if (node.callee.type === 'MemberExpression') {
        const obj = node.callee.object;
        const prop = node.callee.property;
        
        if (obj.type === 'Identifier' && obj.name === 'document' &&
            prop.type === 'Identifier' && prop.name === 'getElementById') {
          if (node.arguments.length > 0 && node.arguments[0].type === 'StringLiteral') {
            references.push({
              id: node.arguments[0].value,
              line: node.loc ? node.loc.start.line : 0,
              column: node.loc ? node.loc.start.column : 0,
              method: 'document.getElementById()'
            });
          }
        }
      }
    }
  });
  
  return references;
}

/**
 * Cross-validate DOM references against HTML
 * @param {string} jsFilePath - Path to JavaScript file
 * @param {string} htmlFilePath - Path to HTML file
 * @returns {Array<Finding>} Array of findings for orphaned DOM references
 */
export function validateDomReferences(jsFilePath, htmlFilePath) {
  const htmlIds = extractHtmlIds(htmlFilePath);
  const jsReferences = extractJsDomReferences(jsFilePath);
  const findings = [];
  
  // Track unique orphaned IDs to avoid duplicate findings
  const reportedIds = new Set();
  
  for (const ref of jsReferences) {
    if (!htmlIds.has(ref.id)) {
      // Only report each orphaned ID once
      if (!reportedIds.has(ref.id)) {
        reportedIds.add(ref.id);
        
        const code = fs.readFileSync(jsFilePath, 'utf-8');
        const lines = code.split('\n');
        const snippetLine = lines[ref.line - 1] || '';
        
        findings.push(createFinding({
          category: 'dead-code',
          subcategory: 'orphaned-dom-reference',
          severity: 'moderate',
          effort: 'quick-win',
          impact: 60,
          file: jsFilePath,
          line: ref.line,
          column: ref.column,
          description: `DOM reference to ID '${ref.id}' using ${ref.method} but element does not exist in HTML`,
          recommendation: `Remove the reference to '${ref.id}' or add the element to index.html`,
          codeSnippet: snippetLine.trim(),
          relatedFindings: []
        }));
      }
    }
  }
  
  return findings;
}

/**
 * Analyze DOM references across the FLAPS codebase
 * @param {Object} options - Analysis options
 * @param {string} options.jsFile - Path to JavaScript file (default: public/app.js)
 * @param {string} options.htmlFile - Path to HTML file (default: public/index.html)
 * @returns {Array<Finding>} Array of findings
 */
export function analyzeDomReferences(options = {}) {
  const jsFile = options.jsFile || path.join(process.cwd(), 'public', 'app.js');
  const htmlFile = options.htmlFile || path.join(process.cwd(), 'public', 'index.html');
  
  const findings = validateDomReferences(jsFile, htmlFile);
  
  return findings;
}

/**
 * Generate a summary report of DOM reference analysis
 * @param {Array<Finding>} findings - Array of findings
 * @returns {Object} Summary report
 */
export function generateDomReferenceSummary(findings) {
  const orphanedIds = new Set();
  const byMethod = { 'el()': 0, 'document.getElementById()': 0 };
  
  findings.forEach(finding => {
    // Extract ID from description
    const match = finding.description.match(/ID '([^']+)'/);
    if (match) {
      orphanedIds.add(match[1]);
    }
    
    // Count by method
    if (finding.description.includes('el()')) {
      byMethod['el()']++;
    } else if (finding.description.includes('document.getElementById()')) {
      byMethod['document.getElementById()']++;
    }
  });
  
  return {
    totalOrphanedReferences: findings.length,
    uniqueOrphanedIds: orphanedIds.size,
    orphanedIds: Array.from(orphanedIds),
    byMethod
  };
}
