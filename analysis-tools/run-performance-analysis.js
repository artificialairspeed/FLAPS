#!/usr/bin/env node

/**
 * Run Performance Anti-Pattern Analysis
 * 
 * Analyzes JavaScript files for performance anti-patterns and generates reports
 */

import { analyzePerformanceAntiPatterns, generatePerformanceReport } from './analyzers/performance-anti-pattern-detector.js';
import { createAnalysisReport } from './models.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files to analyze
const PROJECT_ROOT = path.join(__dirname, '..');
const FILES_TO_ANALYZE = [
  path.join(PROJECT_ROOT, 'public', 'app.js'),
  path.join(PROJECT_ROOT, 'server.js')
];

console.log('🔍 Starting Performance Anti-Pattern Analysis...\n');

// Run analysis
const results = analyzePerformanceAntiPatterns(FILES_TO_ANALYZE);

// Generate markdown report
const markdownReport = generatePerformanceReport(results);

// Generate JSON report
const analysisReport = createAnalysisReport({
  filesAnalyzed: FILES_TO_ANALYZE,
  findings: results.findings
});

// Write reports to files
const reportsDir = path.join(__dirname, 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const markdownPath = path.join(reportsDir, 'performance-analysis.md');
const jsonPath = path.join(reportsDir, 'performance-findings.json');

fs.writeFileSync(markdownPath, markdownReport);
fs.writeFileSync(jsonPath, JSON.stringify(analysisReport, null, 2));

// Print summary to console
console.log('✅ Analysis Complete!\n');
console.log('📊 Summary:');
console.log(`   Total Issues Found: ${results.findings.length}`);
console.log(`   - DOM Queries in Loops: ${results.patterns.domQueriesInLoops.length}`);
console.log(`   - Repeated DOM Queries: ${results.patterns.repeatedDOMQueries.length}`);
console.log(`   - Unnecessary Iterations: ${results.patterns.unnecessaryIterations.length}`);
console.log(`   - Inefficient String Concatenation: ${results.patterns.inefficientStringConcat.length}`);
console.log(`   - Missing Debounce/Throttle: ${results.patterns.missingDebounceThrottle.length}`);
console.log(`   - Sync Operations Could Be Async: ${results.patterns.syncOperationsThatCouldBeAsync.length}`);
console.log('');

// Breakdown by severity
const bySeverity = results.findings.reduce((acc, f) => {
  acc[f.severity] = (acc[f.severity] || 0) + 1;
  return acc;
}, {});

console.log('📈 By Severity:');
if (bySeverity.critical) console.log(`   Critical: ${bySeverity.critical}`);
if (bySeverity.moderate) console.log(`   Moderate: ${bySeverity.moderate}`);
if (bySeverity.minor) console.log(`   Minor: ${bySeverity.minor}`);
console.log('');

// Quick wins
const quickWins = results.findings.filter(f => f.effort === 'quick-win').length;
console.log(`⚡ Quick Wins: ${quickWins} (high impact, low effort)`);
console.log('');

console.log('📄 Reports generated:');
console.log(`   Markdown: ${markdownPath}`);
console.log(`   JSON: ${jsonPath}`);
console.log('');

// Show top 5 issues
if (results.findings.length > 0) {
  console.log('🔝 Top Issues:');
  const topFindings = results.findings
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);
  
  topFindings.forEach((finding, index) => {
    console.log(`   ${index + 1}. ${finding.description}`);
    console.log(`      File: ${path.basename(finding.file)}:${finding.line}`);
    console.log(`      Severity: ${finding.severity} | Impact: ${finding.impact}`);
  });
}

console.log('\n✨ Done!');
