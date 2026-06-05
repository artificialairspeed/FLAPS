#!/usr/bin/env node

/**
 * Standalone script to run DOM reference analysis
 * Generates a report of orphaned DOM references
 */

import { analyzeDomReferences, generateDomReferenceSummary } from './dom-reference-validator.js';
import { formatReportAsText, formatReportAsMarkdown } from '../report-generator.js';
import * as fs from 'fs';
import * as path from 'path';

// Run analysis
console.log('Analyzing DOM references...\n');

const findings = analyzeDomReferences();
const summary = generateDomReferenceSummary(findings);

// Display summary
console.log('='.repeat(60));
console.log('DOM REFERENCE CROSS-VALIDATION REPORT');
console.log('='.repeat(60));
console.log();
console.log(`Total orphaned references found: ${summary.totalOrphanedReferences}`);
console.log(`Unique orphaned IDs: ${summary.uniqueOrphanedIds}`);
console.log();

if (summary.orphanedIds.length > 0) {
  console.log('Orphaned DOM IDs:');
  summary.orphanedIds.forEach(id => {
    console.log(`  - ${id}`);
  });
  console.log();
}

console.log('References by method:');
console.log(`  - el(): ${summary.byMethod['el()']}`);
console.log(`  - document.getElementById(): ${summary.byMethod['document.getElementById()']}`);
console.log();

// Display detailed findings
if (findings.length > 0) {
  console.log('='.repeat(60));
  console.log('DETAILED FINDINGS');
  console.log('='.repeat(60));
  console.log();
  
  findings.forEach((finding, index) => {
    console.log(`${index + 1}. ${finding.description}`);
    console.log(`   File: ${path.relative(process.cwd(), finding.file)}:${finding.line}:${finding.column}`);
    console.log(`   Severity: ${finding.severity} | Effort: ${finding.effort} | Impact: ${finding.impact}`);
    console.log(`   Code: ${finding.codeSnippet}`);
    console.log(`   Recommendation: ${finding.recommendation}`);
    console.log();
  });
} else {
  console.log('✓ No orphaned DOM references found! All DOM references are valid.');
  console.log();
}

console.log('='.repeat(60));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(60));

// Save report to file
const reportsDir = path.join(process.cwd(), 'analysis-tools', 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const reportPath = path.join(reportsDir, 'dom-reference-analysis.json');
fs.writeFileSync(reportPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  summary,
  findings
}, null, 2));

console.log(`\nReport saved to: ${path.relative(process.cwd(), reportPath)}`);
