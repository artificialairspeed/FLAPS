#!/usr/bin/env node

/**
 * CLI script to generate the final cleanup report
 * 
 * Usage:
 *   node generate-final-report.js [options]
 * 
 * Options:
 *   --details    Include detailed findings and changes
 *   --format     Output format: markdown, json, or both (default: both)
 *   --output     Custom output path (optional)
 * 
 * Examples:
 *   node generate-final-report.js
 *   node generate-final-report.js --details
 *   node generate-final-report.js --format markdown
 *   node generate-final-report.js --details --format json
 */

import { generateAndSaveFinalReport, generateFinalReport, formatFinalReportAsMarkdown } from './final-report-generator.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  includeDetails: args.includes('--details'),
  format: 'both'
};

// Parse format option
const formatIndex = args.indexOf('--format');
if (formatIndex !== -1 && args[formatIndex + 1]) {
  const format = args[formatIndex + 1].toLowerCase();
  if (['markdown', 'json', 'both'].includes(format)) {
    options.format = format;
  } else {
    console.error(`Invalid format: ${format}. Use 'markdown', 'json', or 'both'.`);
    process.exit(1);
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('  Generating Final Codebase Cleanup Report');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

console.log('Options:');
console.log(`  Include Details: ${options.includeDetails ? 'Yes' : 'No'}`);
console.log(`  Format: ${options.format}`);
console.log('');

console.log('Loading analysis and cleanup reports...');

try {
  // Generate and save the report
  const result = generateAndSaveFinalReport(options);
  
  console.log('');
  console.log('✓ Report generated successfully!');
  console.log('');
  console.log('Saved files:');
  result.saved.forEach(filePath => {
    console.log(`  - ${filePath}`);
  });
  console.log('');
  
  // Display summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Report Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  
  const report = result.report;
  
  console.log('Key Metrics:');
  console.log(`  Total Findings: ${report.summary.totalFindings}`);
  console.log(`  Changes Implemented: ${report.summary.totalChanges}`);
  console.log(`  Implementation Rate: ${report.summary.implementationRate}`);
  console.log(`  Quick-Win Rate: ${report.summary.quickWinRate}`);
  console.log(`  Test Pass Rate: ${report.summary.testResults.passRate}`);
  console.log('');
  
  console.log('Findings Breakdown:');
  console.log(`  By Category: ${Object.keys(report.findings.byCategory).length} categories`);
  console.log(`  By Severity: ${Object.keys(report.findings.bySeverity).length} severity levels`);
  console.log(`  Quick Wins: ${report.findings.quickWins}`);
  console.log('');
  
  console.log('Changes Breakdown:');
  console.log(`  Implemented: ${report.changes.implemented}`);
  console.log(`  Deferred: ${report.changes.deferred}`);
  console.log(`  Failed: ${report.changes.failed}`);
  console.log('');
  
  console.log('Verification:');
  console.log(`  Status: ${report.verification.verificationStatus}`);
  console.log(`  Tests: ${report.summary.testResults.passing}/${report.summary.testResults.totalTests} passing`);
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  
  // If markdown was generated, show a preview
  if (options.format === 'markdown' || options.format === 'both') {
    console.log('');
    console.log('Report Preview (first 20 lines):');
    console.log('───────────────────────────────────────────────────────────');
    const markdown = formatFinalReportAsMarkdown(report);
    const lines = markdown.split('\n').slice(0, 20);
    lines.forEach(line => console.log(line));
    console.log('...');
    console.log('───────────────────────────────────────────────────────────');
  }
  
  console.log('');
  console.log('Done! Open the generated files to view the complete report.');
  
} catch (error) {
  console.error('');
  console.error('✗ Error generating report:');
  console.error(`  ${error.message}`);
  console.error('');
  
  if (error.stack) {
    console.error('Stack trace:');
    console.error(error.stack);
  }
  
  process.exit(1);
}
