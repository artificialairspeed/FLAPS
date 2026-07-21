#!/usr/bin/env node

/**
 * Run Function Length Analysis
 * 
 * Analyzes JavaScript files for function length issues and generates a report.
 * Usage: node run-function-length-analysis.js [file1.js] [file2.js] ...
 */

import { analyzeFunctionLength, generateFunctionLengthReport, getFunctionLengthStats } from './function-length-checker.js';
import * as fs from 'fs';
import * as path from 'path';

// Default files to analyze
const DEFAULT_FILES = [
  path.join(process.cwd(), 'public', 'app.js'),
  path.join(process.cwd(), 'server.js')
];

// Get files from command line or use defaults
const filesToAnalyze = process.argv.length > 2 
  ? process.argv.slice(2)
  : DEFAULT_FILES;

console.log('🔍 Running Function Length Analysis...\n');
console.log('Analyzing files:');
filesToAnalyze.forEach(file => console.log(`  - ${file}`));
console.log('');

try {
  // Run analysis
  const results = analyzeFunctionLength(filesToAnalyze);
  
  // Get statistics
  const stats = getFunctionLengthStats(results);
  
  // Display summary in console
  console.log('📊 Analysis Summary:');
  console.log(`  Total functions: ${stats.total}`);
  console.log(`  Average length: ${stats.average} lines`);
  console.log(`  Median length: ${stats.median} lines`);
  console.log(`  Shortest: ${stats.min} lines`);
  console.log(`  Longest: ${stats.max} lines`);
  console.log(`  Functions > 50 lines: ${stats.exceeding50}`);
  console.log(`  Functions > 100 lines: ${stats.exceeding100}`);
  console.log('');
  
  // Generate and save report
  const report = generateFunctionLengthReport(results);
  const reportPath = path.join(process.cwd(), 'analysis-tools', 'reports', 'function-length-analysis.md');
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Report saved to: ${reportPath}`);
  
  // Also save findings as JSON
  const jsonPath = path.join(process.cwd(), 'analysis-tools', 'reports', 'function-length-findings.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`✅ Findings saved to: ${jsonPath}`);
  
  // Exit with status code based on findings
  if (stats.exceeding100 > 0) {
    console.log('\n⚠️  Warning: Found functions exceeding 100 lines');
    process.exit(0); // Don't fail, just warn
  } else if (stats.exceeding50 > 0) {
    console.log('\n⚠️  Warning: Found functions exceeding 50 lines');
    process.exit(0);
  } else {
    console.log('\n✓ All functions are within recommended length guidelines');
    process.exit(0);
  }
} catch (error) {
  console.error('❌ Error during analysis:', error.message);
  console.error(error.stack);
  process.exit(1);
}
