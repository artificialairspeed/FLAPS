/**
 * Nesting Depth Analyzer - Task 4.2
 * 
 * Identifies deeply nested conditional statements by:
 * 1. Traversing AST to find nested conditionals (if, while, for, switch)
 * 2. Calculating nesting depth for each code path
 * 3. Flagging conditionals exceeding 3 levels with refactoring suggestions
 * 4. Recommending guard clauses and early returns to reduce nesting
 * 
 * Validates Requirements 2.2, 2.6
 */

import * as fs from 'fs';
import { parseFile, traverse, extractSnippet } from '../parser.js';
import { createFinding } from '../models.js';

// Configuration
const MAX_RECOMMENDED_DEPTH = 3;
const CRITICAL_DEPTH = 5;

/**
 * Analyze files for nesting depth issues
 * @param {string[]} filePaths - Array of file paths to analyze
 * @returns {Object} Analysis results with nesting info and findings
 */
export function analyzeNestingDepth(filePaths) {
  const results = {
    nestedBlocks: [],
    findings: []
  };

  for (const filePath of filePaths) {
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = parseFile(filePath);
      
      const fileBlocks = findDeeplyNestedBlocks(ast, filePath, code);
      results.nestedBlocks.push(...fileBlocks);
      
      // Generate findings for blocks exceeding recommended depth
      for (const block of fileBlocks) {
        if (block.depth > MAX_RECOMMENDED_DEPTH) {
          const severity = block.depth >= CRITICAL_DEPTH ? 'moderate' : 'minor';
          const effort = block.depth >= CRITICAL_DEPTH ? 'medium' : 'quick-win';
          const impact = Math.min(100, Math.floor((block.depth / MAX_RECOMMENDED_DEPTH) * 40));
          
          results.findings.push(createFinding({
            category: 'optimization',
            subcategory: 'deep-nesting',
            severity,
            effort,
            impact,
            file: block.file,
            line: block.line,
            column: block.column,
            description: `Conditional statement at depth ${block.depth} exceeds recommended maximum of ${MAX_RECOMMENDED_DEPTH} levels`,
            recommendation: generateRefactoringRecommendation(block),
            codeSnippet: block.snippet || ''
          }));
        }
      }
    } catch (error) {
      console.error(`[analyzeNestingDepth] Error analyzing ${filePath}:`, error.message);
    }
  }

  return results;
}

/**
 * Find deeply nested blocks in an AST
 * @param {Object} ast - Babel AST
 * @param {string} filePath - File path
 * @param {string} code - Source code
 * @returns {Array} Array of nested block info objects
 */
function findDeeplyNestedBlocks(ast, filePath, code) {
  const blocks = [];
  
  // Track nesting depth as we traverse
  function analyzeNode(node, currentDepth = 0, parent = null) {
    if (!node || typeof node !== 'object') {
      return;
    }
    
    // Check if this node increases nesting depth
    const nestingNode = isNestingNode(node);
    
    if (nestingNode) {
      const newDepth = currentDepth + 1;
      
      // Record this nested block
      blocks.push({
        type: node.type,
        file: filePath,
        line: node.loc ? node.loc.start.line : 0,
        column: node.loc ? node.loc.start.column : 0,
        endLine: node.loc ? node.loc.end.line : 0,
        depth: newDepth,
        snippet: extractNodeSnippet(node, code),
        parent: parent ? parent.type : null
      });
      
      // Continue traversing with increased depth
      traverseChildren(node, newDepth, node);
    } else {
      // Continue traversing with same depth
      traverseChildren(node, currentDepth, parent);
    }
  }
  
  function traverseChildren(node, depth, parent) {
    for (const key in node) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
        continue;
      }
      
      const value = node[key];
      
      if (Array.isArray(value)) {
        value.forEach(child => analyzeNode(child, depth, parent));
      } else if (value && typeof value === 'object' && value.type) {
        analyzeNode(value, depth, parent);
      }
    }
  }
  
  // Start analysis
  analyzeNode(ast);
  
  return blocks;
}

/**
 * Check if a node increases nesting depth
 * @param {Object} node - AST node
 * @returns {boolean} True if node increases nesting
 */
function isNestingNode(node) {
  return (
    node.type === 'IfStatement' ||
    node.type === 'WhileStatement' ||
    node.type === 'ForStatement' ||
    node.type === 'ForInStatement' ||
    node.type === 'ForOfStatement' ||
    node.type === 'SwitchStatement' ||
    node.type === 'TryStatement' ||
    node.type === 'CatchClause'
  );
}

/**
 * Extract a code snippet for a node
 * @param {Object} node - AST node
 * @param {string} code - Source code
 * @returns {string} Code snippet
 */
function extractNodeSnippet(node, code) {
  if (!node.loc) {
    return '';
  }
  
  const startLine = node.loc.start.line;
  // Show just the first few lines for context
  const endLine = Math.min(node.loc.end.line, startLine + 10);
  
  return extractSnippet(code, startLine, endLine);
}

/**
 * Generate a refactoring recommendation based on the nested block
 * @param {Object} block - Nested block info
 * @returns {string} Refactoring recommendation
 */
function generateRefactoringRecommendation(block) {
  const recommendations = [];
  
  if (block.type === 'IfStatement') {
    recommendations.push('Consider using guard clauses with early returns to reduce nesting depth.');
    recommendations.push('Example: Instead of nested if statements, check for error conditions first and return early.');
  }
  
  if (block.depth >= CRITICAL_DEPTH) {
    recommendations.push('Extract nested logic into separate helper functions with descriptive names.');
    recommendations.push('Break down complex conditional logic into smaller, testable functions.');
  }
  
  if (block.type === 'ForStatement' || block.type === 'WhileStatement' || 
      block.type === 'ForInStatement' || block.type === 'ForOfStatement') {
    recommendations.push('Consider extracting loop body into a separate function.');
    recommendations.push('Use array methods like map, filter, or reduce if applicable.');
  }
  
  if (block.type === 'SwitchStatement') {
    recommendations.push('Consider using a lookup table or strategy pattern to replace nested switch statements.');
  }
  
  // Add a generic recommendation
  recommendations.push(`Reduce nesting from ${block.depth} levels to ${MAX_RECOMMENDED_DEPTH} or fewer for improved readability.`);
  
  return recommendations.join(' ');
}

/**
 * Analyze a single file for nesting depth issues
 * @param {string} filePath - File path to analyze
 * @returns {Object} Analysis results for the file
 */
export function analyzeFileNestingDepth(filePath) {
  return analyzeNestingDepth([filePath]);
}

/**
 * Generate a report for nesting depth findings
 * @param {Object} results - Analysis results from analyzeNestingDepth
 * @returns {string} Formatted report
 */
export function generateNestingDepthReport(results) {
  const { nestedBlocks, findings } = results;
  
  let report = '# Nesting Depth Analysis Report\n\n';
  
  // Summary
  report += `## Summary\n\n`;
  report += `- Total Nested Blocks Analyzed: ${nestedBlocks.length}\n`;
  report += `- Blocks Exceeding ${MAX_RECOMMENDED_DEPTH} Levels: ${findings.length}\n`;
  
  if (nestedBlocks.length > 0) {
    const maxDepth = Math.max(...nestedBlocks.map(b => b.depth));
    const avgDepth = (nestedBlocks.reduce((sum, b) => sum + b.depth, 0) / nestedBlocks.length).toFixed(1);
    
    report += `- Maximum Nesting Depth: ${maxDepth} levels\n`;
    report += `- Average Nesting Depth: ${avgDepth} levels\n`;
    
    const criticalBlocks = nestedBlocks.filter(b => b.depth >= CRITICAL_DEPTH);
    if (criticalBlocks.length > 0) {
      report += `- Critical Depth Blocks (≥${CRITICAL_DEPTH} levels): ${criticalBlocks.length}\n`;
    }
  }
  
  report += `\n`;
  
  // Deeply Nested Blocks
  if (findings.length > 0) {
    report += `## Deeply Nested Blocks\n\n`;
    
    // Sort by depth (deepest first)
    const sortedFindings = [...findings].sort((a, b) => {
      const blockA = nestedBlocks.find(blk => blk.file === a.file && blk.line === a.line);
      const blockB = nestedBlocks.find(blk => blk.file === b.file && blk.line === b.line);
      return (blockB?.depth || 0) - (blockA?.depth || 0);
    });
    
    sortedFindings.forEach((finding, index) => {
      const block = nestedBlocks.find(b => b.file === finding.file && b.line === finding.line);
      
      report += `### ${index + 1}. ${finding.description}\n`;
      report += `- **File**: ${finding.file}\n`;
      report += `- **Line**: ${finding.line}\n`;
      report += `- **Type**: ${block?.type || 'Unknown'}\n`;
      report += `- **Depth**: ${block?.depth || 'N/A'} levels\n`;
      report += `- **Severity**: ${finding.severity}\n`;
      report += `- **Recommendation**: ${finding.recommendation}\n`;
      
      if (finding.codeSnippet) {
        report += `- **Code Preview**:\n\`\`\`javascript\n${finding.codeSnippet}\n\`\`\`\n`;
      }
      
      report += `\n`;
    });
  } else {
    report += `## Result\n\n`;
    report += `✓ All conditional statements are within recommended nesting depth (≤${MAX_RECOMMENDED_DEPTH} levels).\n\n`;
  }
  
  // Nesting depth distribution
  if (nestedBlocks.length > 0) {
    report += `## Nesting Depth Distribution\n\n`;
    
    const depthCounts = {};
    nestedBlocks.forEach(block => {
      depthCounts[block.depth] = (depthCounts[block.depth] || 0) + 1;
    });
    
    const maxDepth = Math.max(...Object.keys(depthCounts).map(Number));
    
    for (let depth = 1; depth <= maxDepth; depth++) {
      const count = depthCounts[depth] || 0;
      if (count === 0) continue;
      
      const percentage = Math.round((count / nestedBlocks.length) * 100);
      const bar = '█'.repeat(Math.floor(percentage / 2));
      const marker = depth > MAX_RECOMMENDED_DEPTH ? ' ⚠️' : '';
      
      report += `- Depth ${depth}${marker}: ${count.toString().padStart(3)} (${percentage}%) ${bar}\n`;
    }
    
    report += `\n`;
  }
  
  // Nesting by statement type
  if (nestedBlocks.length > 0) {
    report += `## Nesting by Statement Type\n\n`;
    
    const typeCounts = {};
    nestedBlocks.forEach(block => {
      typeCounts[block.type] = (typeCounts[block.type] || 0) + 1;
    });
    
    // Sort by count descending
    const sortedTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1]);
    
    sortedTypes.forEach(([type, count]) => {
      const percentage = Math.round((count / nestedBlocks.length) * 100);
      const avgDepth = (nestedBlocks
        .filter(b => b.type === type)
        .reduce((sum, b) => sum + b.depth, 0) / count
      ).toFixed(1);
      
      report += `- **${type}**: ${count} occurrences (${percentage}%), avg depth: ${avgDepth}\n`;
    });
    
    report += `\n`;
  }
  
  return report;
}

/**
 * Get statistics about nesting depths
 * @param {Object} results - Analysis results from analyzeNestingDepth
 * @returns {Object} Statistics object
 */
export function getNestingDepthStats(results) {
  const { nestedBlocks } = results;
  
  if (nestedBlocks.length === 0) {
    return {
      total: 0,
      maxDepth: 0,
      avgDepth: 0,
      exceeding3: 0,
      exceeding5: 0,
      byType: {}
    };
  }
  
  const depths = nestedBlocks.map(b => b.depth);
  const byType = {};
  
  nestedBlocks.forEach(block => {
    if (!byType[block.type]) {
      byType[block.type] = { count: 0, totalDepth: 0 };
    }
    byType[block.type].count++;
    byType[block.type].totalDepth += block.depth;
  });
  
  // Calculate averages for each type
  for (const type in byType) {
    byType[type].avgDepth = (byType[type].totalDepth / byType[type].count).toFixed(1);
  }
  
  return {
    total: nestedBlocks.length,
    maxDepth: Math.max(...depths),
    avgDepth: (depths.reduce((sum, d) => sum + d, 0) / depths.length).toFixed(1),
    exceeding3: nestedBlocks.filter(b => b.depth > MAX_RECOMMENDED_DEPTH).length,
    exceeding5: nestedBlocks.filter(b => b.depth >= CRITICAL_DEPTH).length,
    byType
  };
}

/**
 * Find the most deeply nested location in a file
 * @param {string} filePath - File path to analyze
 * @returns {Object|null} Info about the deepest nesting, or null if none found
 */
export function findDeepestNesting(filePath) {
  const results = analyzeNestingDepth([filePath]);
  
  if (results.nestedBlocks.length === 0) {
    return null;
  }
  
  // Find the block with maximum depth
  const deepest = results.nestedBlocks.reduce((max, block) => 
    block.depth > max.depth ? block : max
  );
  
  return deepest;
}
