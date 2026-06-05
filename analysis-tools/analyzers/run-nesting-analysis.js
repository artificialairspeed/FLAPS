/**
 * Runner script for Nesting Depth Analyzer
 * Analyzes FLAPS codebase for deep nesting and complexity issues
 */

import { analyzeNestingDepth, generateNestingDepthReport } from './nesting-depth-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files to analyze
const filesToAnalyze = [
  path.join(__dirname, '../../public/app.js'),
  path.join(__dirname, '../../server.js')
];

console.log('🔍 Analyzing FLAPS codebase for nesting depth and complexity issues...\n');

// Run analysis
const results = analyzeNestingDepth(filesToAnalyze);

// Generate report
const report = generateNestingDepthReport(results);

// Output report to console
console.log(report);

// Save report to file
const reportPath = path.join(__dirname, '../reports/nesting-depth-analysis.md');
fs.writeFileSync(reportPath, report);
console.log(`\n✅ Report saved to: ${reportPath}`);

// Save JSON data for programmatic access
const jsonPath = path.join(__dirname, '../reports/nesting-depth-findings.json');
const jsonData = {
  timestamp: new Date().toISOString(),
  filesAnalyzed: filesToAnalyze,
  functions: results.functions,
  findings: results.findings,
  summary: {
    totalFunctions: results.functions.length,
    deepNestingCount: results.findings.filter(f => f.subcategory === 'deep-nesting').length,
    highComplexityCount: results.findings.filter(f => f.subcategory === 'high-complexity').length,
    totalIssues: results.findings.length
  }
};
fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
console.log(`✅ JSON data saved to: ${jsonPath}\n`);
