/**
 * Run code duplication detector on server.js and app.js
 * Task 4.1: Create code duplication detector
 */

import { analyzeCodeDuplication, generateDuplicationReport } from './code-duplication-detector.js';
import * as path from 'path';
import * as fs from 'fs';

// Files to analyze as per task requirements
const FILES_TO_ANALYZE = [
  path.resolve(process.cwd(), 'server.js'),
  path.resolve(process.cwd(), 'public/app.js')
];

// Configuration: detect duplications exceeding 5 lines
const CONFIG = {
  minLines: 5,
  minNodes: 10,
  similarityThreshold: 0.85
};

console.log('Code Duplication Detector - Task 4.1');
console.log('=====================================\n');
console.log('Analyzing files:');
FILES_TO_ANALYZE.forEach(f => console.log(`  - ${f}`));
console.log(`\nConfiguration: minLines=${CONFIG.minLines}, minNodes=${CONFIG.minNodes}, threshold=${CONFIG.similarityThreshold}\n`);

// Run the analysis
console.log('Running analysis...\n');
const result = analyzeCodeDuplication(FILES_TO_ANALYZE, CONFIG);

if (!result.success) {
  console.error('Analysis failed:', result.error);
  process.exit(1);
}

// Display summary
console.log('Analysis Summary');
console.log('================');
console.log(`Total code blocks extracted: ${result.summary.totalBlocks}`);
console.log(`Duplicate groups found: ${result.summary.duplicateGroups}`);
console.log(`Total duplicated blocks: ${result.summary.totalDuplicates}`);
console.log(`Findings generated: ${result.findings.length}\n`);

// Display findings
if (result.findings.length > 0) {
  console.log('Findings:');
  console.log('=========\n');
  
  result.findings.forEach((finding, index) => {
    console.log(`${index + 1}. [${finding.severity.toUpperCase()}] ${finding.subcategory}`);
    console.log(`   File: ${finding.file}:${finding.line}`);
    console.log(`   Effort: ${finding.effort}, Impact: ${finding.impact}`);
    console.log(`   ${finding.description}`);
    console.log(`   Recommendation: ${finding.recommendation}`);
    console.log();
  });
} else {
  console.log('No code duplications found exceeding the configured thresholds.\n');
}

// Generate JSON report
const reportsDir = path.resolve(process.cwd(), 'analysis-tools/reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const reportPath = path.join(reportsDir, 'code-duplication-findings.json');
generateDuplicationReport(result.findings, reportPath);

console.log(`\nReport saved to: ${reportPath}`);
console.log('\nTask 4.1 Complete: Code duplication detector executed successfully.');
