#!/usr/bin/env node

/**
 * Runner script for sessionStorage operation analysis
 * Task 3.1 - Create sessionStorage operation tracker
 * 
 * Usage: node run-storage-analysis.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { analyzeStorageOperations, generateStorageReport } from './storage-analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define files to analyze
const filesToAnalyze = [
  path.resolve(__dirname, '../../public/app.js')
];

console.log('Starting sessionStorage operations analysis...\n');

// Run the analysis
const results = analyzeStorageOperations(filesToAnalyze);

// Generate human-readable report
const report = generateStorageReport(results);

// Save report to file
const reportDir = path.resolve(__dirname, '../reports');
const reportPath = path.join(reportDir, 'storage-analysis.md');
const jsonPath = path.join(reportDir, 'storage-analysis.json');

// Ensure reports directory exists
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

// Write markdown report
fs.writeFileSync(reportPath, report, 'utf-8');
console.log(`Markdown report written to: ${reportPath}\n`);

// Write JSON data
const jsonData = {
  timestamp: new Date().toISOString(),
  filesAnalyzed: filesToAnalyze,
  operations: {
    setItem: Object.fromEntries(results.operations.setItem),
    getItem: Object.fromEntries(results.operations.getItem),
    removeItem: Object.fromEntries(results.operations.removeItem)
  },
  findings: results.findings,
  summary: {
    totalSetItem: Array.from(results.operations.setItem.values()).reduce((sum, arr) => sum + arr.length, 0),
    totalGetItem: Array.from(results.operations.getItem.values()).reduce((sum, arr) => sum + arr.length, 0),
    totalRemoveItem: Array.from(results.operations.removeItem.values()).reduce((sum, arr) => sum + arr.length, 0),
    uniqueKeys: new Set([
      ...results.operations.setItem.keys(),
      ...results.operations.getItem.keys(),
      ...results.operations.removeItem.keys()
    ]).size,
    writeOnlyKeys: results.findings.filter(f => f.subcategory === 'write-only-key').length,
    readOnlyKeys: results.findings.filter(f => f.subcategory === 'read-only-key').length,
    keyInconsistencies: results.findings.filter(f => f.subcategory === 'key-inconsistency').length,
    totalIssues: results.findings.length
  }
};

fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
console.log(`JSON data written to: ${jsonPath}\n`);

// Print summary to console
console.log('=== Analysis Summary ===');
console.log(`Files analyzed: ${filesToAnalyze.length}`);
console.log(`Total setItem() operations: ${jsonData.summary.totalSetItem}`);
console.log(`Total getItem() operations: ${jsonData.summary.totalGetItem}`);
console.log(`Total removeItem() operations: ${jsonData.summary.totalRemoveItem}`);
console.log(`Unique keys tracked: ${jsonData.summary.uniqueKeys}`);
console.log(`\nIssues found:`);
console.log(`  - Write-only keys: ${jsonData.summary.writeOnlyKeys}`);
console.log(`  - Read-only keys: ${jsonData.summary.readOnlyKeys}`);
console.log(`  - Key inconsistencies: ${jsonData.summary.keyInconsistencies}`);
console.log(`  - Total issues: ${jsonData.summary.totalIssues}`);
console.log('\nAnalysis complete!');
