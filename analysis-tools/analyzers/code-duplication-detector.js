/**
 * Code Duplication Detector
 * 
 * Detects duplicated code patterns in JavaScript files using AST-based analysis.
 * Finds similar code blocks (using AST node similarity), identifies repeated logic
 * that could be extracted to functions, and suggests refactoring opportunities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseFile, traverse, extractSnippet, normalizeCode } from '../parser.js';
import { createFinding } from '../models.js';
import crypto from 'crypto';

/**
 * Configuration for duplication detection
 */
const DEFAULT_CONFIG = {
  minLines: 5,              // Minimum lines for a block to be considered
  minNodes: 10,             // Minimum AST nodes for similarity comparison
  similarityThreshold: 0.85 // Threshold for considering blocks similar (0-1)
};

/**
 * Analyze files for code duplication
 * @param {string[]} filePaths - Array of file paths to analyze
 * @param {Object} config - Configuration options
 * @returns {Object} Analysis results with findings
 */
export function analyzeCodeDuplication(filePaths, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const findings = [];
  
  try {
    // Extract code blocks from all files
    const allBlocks = [];
    const fileContents = {};
    
    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        fileContents[filePath] = content;
        
        const ast = parseFile(filePath);
        const blocks = extractCodeBlocks(ast, filePath, content, cfg);
        allBlocks.push(...blocks);
      } catch (error) {
        console.warn(`Failed to parse ${filePath}: ${error.message}`);
      }
    }
    
    // Find duplicates using normalized comparison
    const duplicateGroups = findDuplicates(allBlocks, cfg);
    
    // Generate findings for each duplicate group
    for (const group of duplicateGroups) {
      const finding = createDuplicationFinding(group, fileContents);
      if (finding) {
        findings.push(finding);
      }
    }
    
    return {
      success: true,
      findings,
      summary: {
        totalBlocks: allBlocks.length,
        duplicateGroups: duplicateGroups.length,
        totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.blocks.length, 0)
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      findings: []
    };
  }
}

/**
 * Extract code blocks from an AST
 * @param {Object} ast - Babel AST
 * @param {string} filePath - Source file path
 * @param {string} content - Source file content
 * @param {Object} config - Configuration
 * @returns {Array} Array of code blocks
 */
function extractCodeBlocks(ast, filePath, content, config) {
  const blocks = [];
  
  traverse(ast, {
    // Function declarations
    FunctionDeclaration(node) {
      if (node.body && isBlockLargeEnough(node.body, config)) {
        blocks.push(createBlock(node.body, 'FunctionDeclaration', filePath, content, node));
      }
    },
    
    // Function expressions
    FunctionExpression(node) {
      if (node.body && isBlockLargeEnough(node.body, config)) {
        blocks.push(createBlock(node.body, 'FunctionExpression', filePath, content, node));
      }
    },
    
    // Arrow functions
    ArrowFunctionExpression(node) {
      if (node.body && node.body.type === 'BlockStatement' && isBlockLargeEnough(node.body, config)) {
        blocks.push(createBlock(node.body, 'ArrowFunctionExpression', filePath, content, node));
      }
    },
    
    // If statement blocks
    IfStatement(node) {
      if (node.consequent && node.consequent.type === 'BlockStatement' && 
          isBlockLargeEnough(node.consequent, config)) {
        blocks.push(createBlock(node.consequent, 'IfStatement', filePath, content, node));
      }
      if (node.alternate && node.alternate.type === 'BlockStatement' && 
          isBlockLargeEnough(node.alternate, config)) {
        blocks.push(createBlock(node.alternate, 'ElseBlock', filePath, content, node));
      }
    },
    
    // Loop blocks
    ForStatement(node) {
      if (node.body && node.body.type === 'BlockStatement' && isBlockLargeEnough(node.body, config)) {
        blocks.push(createBlock(node.body, 'ForStatement', filePath, content, node));
      }
    },
    
    WhileStatement(node) {
      if (node.body && node.body.type === 'BlockStatement' && isBlockLargeEnough(node.body, config)) {
        blocks.push(createBlock(node.body, 'WhileStatement', filePath, content, node));
      }
    },
    
    // Try-catch blocks
    TryStatement(node) {
      if (node.block && isBlockLargeEnough(node.block, config)) {
        blocks.push(createBlock(node.block, 'TryBlock', filePath, content, node));
      }
      if (node.handler && node.handler.body && isBlockLargeEnough(node.handler.body, config)) {
        blocks.push(createBlock(node.handler.body, 'CatchBlock', filePath, content, node));
      }
    }
  });
  
  return blocks;
}

/**
 * Check if a block is large enough to consider for duplication
 * @param {Object} node - AST node
 * @param {Object} config - Configuration
 * @returns {boolean}
 */
function isBlockLargeEnough(node, config) {
  if (!node.loc) return false;
  
  const lines = node.loc.end.line - node.loc.start.line + 1;
  if (lines < config.minLines) return false;
  
  const nodeCount = countNodes(node);
  return nodeCount >= config.minNodes;
}

/**
 * Count AST nodes in a subtree
 * @param {Object} node - AST node
 * @returns {number} Node count
 */
function countNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  
  let count = 1; // Count this node
  
  for (const key in node) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'type') {
      continue;
    }
    
    const value = node[key];
    
    if (Array.isArray(value)) {
      value.forEach(child => {
        count += countNodes(child);
      });
    } else if (value && typeof value === 'object' && value.type) {
      count += countNodes(value);
    }
  }
  
  return count;
}

/**
 * Create a code block descriptor
 * @param {Object} node - AST node
 * @param {string} type - Block type
 * @param {string} filePath - Source file path
 * @param {string} content - Source content
 * @param {Object} parentNode - Parent AST node for context
 * @returns {Object} Block descriptor
 */
function createBlock(node, type, filePath, content, parentNode) {
  const startLine = node.loc.start.line;
  const endLine = node.loc.end.line;
  const snippet = extractSnippet(content, startLine, endLine);
  
  // Create structural signature (normalized AST structure)
  const structure = extractStructure(node);
  const structureHash = hashStructure(structure);
  
  // Create normalized code for similarity comparison
  const normalized = normalizeCode(snippet);
  const normalizedHash = hashString(normalized);
  
  return {
    type,
    filePath,
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    nodeCount: countNodes(node),
    snippet,
    normalized,
    normalizedHash,
    structure,
    structureHash,
    parentNode
  };
}

/**
 * Extract structural representation of AST node
 * @param {Object} node - AST node
 * @returns {string} Structural representation
 */
function extractStructure(node) {
  if (!node || typeof node !== 'object') return '';
  
  // For identifiers and literals, use placeholders
  if (node.type === 'Identifier') return 'ID';
  if (node.type === 'Literal' || node.type === 'NumericLiteral' || 
      node.type === 'StringLiteral' || node.type === 'BooleanLiteral') {
    return 'LIT';
  }
  
  // Build structure from node type and children
  let structure = node.type;
  
  const children = [];
  for (const key in node) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || 
        key === 'type' || key === 'name' || key === 'value' || key === 'raw') {
      continue;
    }
    
    const value = node[key];
    
    if (Array.isArray(value)) {
      const arrayStructure = value.map(child => extractStructure(child)).join(',');
      if (arrayStructure) children.push(`[${arrayStructure}]`);
    } else if (value && typeof value === 'object' && value.type) {
      children.push(extractStructure(value));
    }
  }
  
  if (children.length > 0) {
    structure += `(${children.join(',')})`;
  }
  
  return structure;
}

/**
 * Hash a structure string
 * @param {string} structure - Structure string
 * @returns {string} Hash
 */
function hashStructure(structure) {
  return crypto.createHash('md5').update(structure).digest('hex');
}

/**
 * Hash a string
 * @param {string} str - String to hash
 * @returns {string} Hash
 */
function hashString(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Find duplicate blocks
 * @param {Array} blocks - Array of code blocks
 * @param {Object} config - Configuration
 * @returns {Array} Array of duplicate groups
 */
function findDuplicates(blocks, config) {
  const duplicateGroups = [];
  const processed = new Set();
  
  // Group blocks by structure hash for efficiency
  const structureGroups = {};
  for (const block of blocks) {
    if (!structureGroups[block.structureHash]) {
      structureGroups[block.structureHash] = [];
    }
    structureGroups[block.structureHash].push(block);
  }
  
  // Find duplicates within each structure group
  for (const hash in structureGroups) {
    const group = structureGroups[hash];
    
    if (group.length < 2) continue;
    
    // Compare blocks pairwise within the group
    for (let i = 0; i < group.length; i++) {
      if (processed.has(group[i])) continue;
      
      const similars = [group[i]];
      
      for (let j = i + 1; j < group.length; j++) {
        if (processed.has(group[j])) continue;
        
        const similarity = calculateSimilarity(group[i], group[j]);
        
        if (similarity >= config.similarityThreshold) {
          similars.push(group[j]);
          processed.add(group[j]);
        }
      }
      
      if (similars.length > 1) {
        processed.add(group[i]);
        duplicateGroups.push({
          structureHash: hash,
          blocks: similars,
          similarity: 'high'
        });
      }
    }
  }
  
  return duplicateGroups;
}

/**
 * Calculate similarity between two blocks
 * @param {Object} block1 - First block
 * @param {Object} block2 - Second block
 * @returns {number} Similarity score (0-1)
 */
function calculateSimilarity(block1, block2) {
  // If structure hashes match, they have identical structure
  if (block1.structureHash === block2.structureHash) {
    // Calculate similarity based on normalized code
    return calculateStringSimilarity(block1.normalized, block2.normalized);
  }
  
  return 0;
}

/**
 * Calculate string similarity using Levenshtein-based approach
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1)
 */
function calculateStringSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(str1, str2);
  return 1.0 - (distance / maxLen);
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Create a finding for a duplicate group
 * @param {Object} group - Duplicate group
 * @param {Object} fileContents - Map of file paths to contents
 * @returns {Finding} Finding object
 */
function createDuplicationFinding(group, fileContents) {
  const blocks = group.blocks;
  if (blocks.length < 2) return null;
  
  // Use the first block as the reference
  const refBlock = blocks[0];
  
  // Build location list
  const locations = blocks.map(block => {
    return `${path.basename(block.filePath)}:${block.startLine}-${block.endLine}`;
  }).join(', ');
  
  // Calculate impact based on duplication size and frequency
  const totalDuplicatedLines = blocks.reduce((sum, b) => sum + b.lineCount, 0);
  const impact = Math.min(100, Math.floor(totalDuplicatedLines / blocks.length * 10));
  
  // Determine effort based on complexity
  let effort = 'quick-win';
  if (refBlock.lineCount > 20 || refBlock.nodeCount > 50) {
    effort = 'medium';
  }
  if (refBlock.lineCount > 50 || refBlock.nodeCount > 100) {
    effort = 'complex';
  }
  
  // Determine severity
  let severity = 'minor';
  if (blocks.length >= 3 || refBlock.lineCount >= 15) {
    severity = 'moderate';
  }
  if (blocks.length >= 5 || refBlock.lineCount >= 30) {
    severity = 'critical';
  }
  
  // Generate description
  const description = `Duplicated code block found in ${blocks.length} locations: ${locations}. ` +
    `Block spans ${refBlock.lineCount} lines and contains ${refBlock.nodeCount} AST nodes.`;
  
  // Generate recommendation
  const functionName = suggestFunctionName(refBlock);
  const recommendation = `Extract this duplicated logic into a reusable helper function '${functionName}'. ` +
    `This will reduce code duplication by approximately ${totalDuplicatedLines - refBlock.lineCount} lines.`;
  
  return createFinding({
    category: 'optimization',
    subcategory: 'code-duplication',
    severity,
    effort,
    impact,
    file: refBlock.filePath,
    line: refBlock.startLine,
    column: 0,
    description,
    recommendation,
    codeSnippet: refBlock.snippet,
    relatedFindings: []
  });
}

/**
 * Suggest a function name based on the code block
 * @param {Object} block - Code block
 * @returns {string} Suggested function name
 */
function suggestFunctionName(block) {
  // Simple heuristic: look for common patterns
  const snippet = block.snippet.toLowerCase();
  
  if (snippet.includes('render')) return 'renderHelper';
  if (snippet.includes('validate')) return 'validateHelper';
  if (snippet.includes('format')) return 'formatHelper';
  if (snippet.includes('parse')) return 'parseHelper';
  if (snippet.includes('update')) return 'updateHelper';
  if (snippet.includes('create')) return 'createHelper';
  if (snippet.includes('delete')) return 'deleteHelper';
  if (snippet.includes('save')) return 'saveHelper';
  if (snippet.includes('load')) return 'loadHelper';
  if (snippet.includes('check')) return 'checkHelper';
  
  return 'extractedHelper';
}

/**
 * Generate a report from findings
 * @param {Array} findings - Array of findings
 * @param {string} outputPath - Output file path
 */
export function generateDuplicationReport(findings, outputPath) {
  const report = {
    timestamp: new Date().toISOString(),
    analyzer: 'code-duplication-detector',
    findings: findings.map(f => ({
      id: f.id,
      severity: f.severity,
      effort: f.effort,
      impact: f.impact,
      file: f.file,
      line: f.line,
      description: f.description,
      recommendation: f.recommendation
    })),
    summary: {
      total: findings.length,
      bySeverity: countBy(findings, 'severity'),
      byEffort: countBy(findings, 'effort')
    }
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Duplication report written to ${outputPath}`);
}

/**
 * Count items by property
 * @param {Array} items - Items to count
 * @param {string} prop - Property to count by
 * @returns {Object} Count map
 */
function countBy(items, prop) {
  const counts = {};
  items.forEach(item => {
    const value = item[prop];
    counts[value] = (counts[value] || 0) + 1;
  });
  return counts;
}
