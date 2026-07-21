/**
 * Run Event Listener Analysis on app.js
 * 
 * This script analyzes event listener usage in app.js and generates a report
 * identifying potential memory leaks and cleanup issues.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeEventListeners,
  getListenerStatistics,
  generateEventListenerSummary
} from './event-listener-analyzer.js';
import { generateAnalysisReport, formatReportAsJSON } from '../report-generator.js';

// Analyze app.js
const appJsPath = path.join(process.cwd(), 'public', 'app.js');

console.log('═══════════════════════════════════════════════════════════');
console.log('         EVENT LISTENER ANALYSIS - app.js');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Get statistics
console.log('Gathering event listener statistics...');
const stats = getListenerStatistics(appJsPath);

console.log('');
console.log('STATISTICS');
console.log('───────────────────────────────────────────────────────────');
console.log(`Total addEventListener calls:    ${stats.totalAddEventListener}`);
console.log(`Total removeEventListener calls: ${stats.totalRemoveEventListener}`);
console.log(`Anonymous handlers:              ${stats.anonymousHandlers}`);
console.log(`Named handlers:                  ${stats.namedHandlers}`);
console.log(`With existence check:            ${stats.withExistenceCheck}`);
console.log(`Without existence check:         ${stats.withoutExistenceCheck}`);
console.log('');
console.log('Event types:', stats.eventTypes.join(', '));
console.log('Targets:', stats.targets.join(', '));
console.log('');

// Analyze for issues
console.log('Analyzing event listeners for potential issues...');
const findings = analyzeEventListeners(appJsPath);
const summary = generateEventListenerSummary(findings);

console.log('');
console.log('FINDINGS SUMMARY');
console.log('───────────────────────────────────────────────────────────');
console.log(`Total issues found:              ${summary.totalIssues}`);
console.log(`Anonymous functions:             ${summary.anonymousFunctions}`);
console.log(`Missing cleanup:                 ${summary.missingCleanup}`);
console.log(`Missing existence checks:        ${summary.missingExistenceChecks}`);
console.log(`Duplicate listeners:             ${summary.duplicateListeners}`);
console.log('');

// Display detailed findings
if (findings.length > 0) {
  console.log('DETAILED FINDINGS');
  console.log('───────────────────────────────────────────────────────────');
  
  findings.forEach((finding, index) => {
    console.log('');
    console.log(`${index + 1}. [${finding.severity.toUpperCase()}] ${finding.description}`);
    console.log(`   Subcategory: ${finding.subcategory}`);
    console.log(`   Location: ${finding.file}:${finding.line}`);
    console.log(`   Effort: ${finding.effort} | Impact: ${finding.impact}/100`);
    console.log(`   Recommendation: ${finding.recommendation}`);
    if (finding.codeSnippet) {
      console.log(`   Code: ${finding.codeSnippet}`);
    }
  });
  
  console.log('');
}

// Generate and save JSON report
console.log('Generating report...');
const report = generateAnalysisReport({
  filesAnalyzed: [appJsPath],
  findings
});

const reportPath = path.join(process.cwd(), 'analysis-tools', 'reports', 'event-listener-analysis.json');
fs.writeFileSync(reportPath, formatReportAsJSON(report), 'utf-8');

console.log(`Report saved to: ${reportPath}`);
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Analysis complete! Found ${findings.length} potential issue(s)`);
console.log('═══════════════════════════════════════════════════════════');
