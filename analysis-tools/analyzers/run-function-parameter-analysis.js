#!/usr/bin/env node

/**
 * Run function parameter analysis
 * Identifies functions with unused parameters
 */

import { analyze } from './function-parameter-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Files to analyze
const filesToAnalyze = [
  path.join(projectRoot, 'public/app.js'),
  path.join(projectRoot, 'server.js')
];

console.log('Running function parameter analysis...\n');

const result = analyze(filesToAnalyze);

console.log(`Found ${result.findings.length} functions with unused parameters`);
console.log(`Total unused parameters: ${result.summary.totalUnusedParams}\n`);

if (result.findings.length > 0) {
  console.log('Findings:\n');
  result.findings.forEach((finding, index) => {
    console.log(`${index + 1}. ${finding.description}`);
    console.log(`   File: ${finding.file}:${finding.line}`);
    console.log(`   Recommendation: ${finding.recommendation}`);
    if (finding.metadata) {
      console.log(`   Unused: ${finding.metadata.unusedParams.join(', ')}`);
      console.log(`   All params: ${finding.metadata.allParams.join(', ')}`);
    }
    console.log();
  });
}

// Save report
const reportPath = path.join(projectRoot, 'analysis-tools/reports/function-parameter-analysis.json');
fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
console.log(`Report saved to: ${reportPath}`);
