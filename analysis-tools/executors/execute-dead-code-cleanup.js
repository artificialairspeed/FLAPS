/**
 * Execute Dead Code Cleanup
 * Task 10.2: Execute dead code cleanup
 * 
 * This script removes dead code identified in the analysis phase.
 * Requirements: 1.7, 1.8, 8.1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { removeDeadCodeBatch } from './dead-code-remover.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the dead code findings
const findingsPath = path.join(__dirname, '../reports/dead-code-findings.json');
const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf-8'));

console.log('='.repeat(80));
console.log('DEAD CODE CLEANUP EXECUTION');
console.log('='.repeat(80));
console.log(`\nLoaded ${findings.findings.length} findings from analysis\n`);

// Filter out the outsideClickHandler which is actually used (false positive)
// The analyzer missed this because it's passed as a reference to addEventListener/removeEventListener
const actualDeadCode = findings.findings.filter(f => {
  if (f.description.includes('outsideClickHandler')) {
    console.log(`⊘ Skipping: ${f.description}`);
    console.log(`  Reason: This function is used as an event handler (false positive)\n`);
    return false;
  }
  return true;
});

console.log(`\nProcessing ${actualDeadCode.length} genuine dead code findings:\n`);
actualDeadCode.forEach((f, i) => {
  console.log(`${i + 1}. ${f.description}`);
  console.log(`   File: ${path.basename(f.file)}:${f.line}`);
  console.log(`   Severity: ${f.severity} | Effort: ${f.effort} | Impact: ${f.impact}`);
});

console.log('\n' + '='.repeat(80));
console.log('STARTING CLEANUP');
console.log('='.repeat(80));

// Execute the cleanup
const results = removeDeadCodeBatch(actualDeadCode);

// Display results
console.log('\n' + '='.repeat(80));
console.log('CLEANUP RESULTS');
console.log('='.repeat(80));

console.log(`\n✓ Successfully removed: ${results.summary.successful}/${results.summary.total}`);
console.log(`✗ Failed to remove: ${results.summary.failed}/${results.summary.total}`);

if (results.implemented.length > 0) {
  console.log('\n' + '-'.repeat(80));
  console.log('SUCCESSFUL REMOVALS:');
  console.log('-'.repeat(80));
  results.implemented.forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.finding.description}`);
    console.log(`   File: ${item.finding.file}:${item.finding.line}`);
  });
}

if (results.failed.length > 0) {
  console.log('\n' + '-'.repeat(80));
  console.log('FAILED REMOVALS:');
  console.log('-'.repeat(80));
  results.failed.forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.finding.description}`);
    console.log(`   File: ${item.finding.file}:${item.finding.line}`);
    console.log(`   Reason: ${item.reason}`);
    if (item.failures) {
      console.log(`   Failures: ${item.failures.join(', ')}`);
    }
  });
}

console.log('\n' + '='.repeat(80));
console.log('CLEANUP COMPLETE');
console.log('='.repeat(80));

// Save results
const resultsPath = path.join(__dirname, '../reports/dead-code-cleanup-results.json');
fs.writeFileSync(resultsPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  findings: actualDeadCode,
  results: results,
  summary: {
    totalFindings: findings.findings.length,
    falsePositives: findings.findings.length - actualDeadCode.length,
    processed: actualDeadCode.length,
    successful: results.summary.successful,
    failed: results.summary.failed,
    successRate: `${((results.summary.successful / actualDeadCode.length) * 100).toFixed(1)}%`
  }
}, null, 2));

console.log(`\nResults saved to: ${resultsPath}`);

// Exit with appropriate code
process.exit(results.summary.failed > 0 ? 1 : 0);
