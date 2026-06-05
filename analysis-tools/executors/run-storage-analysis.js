/**
 * Executor script for Storage Analysis (Task 3.1)
 * 
 * Runs the storage analyzer and generates a detailed report
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeStorageOperations, generateStorageReport, generateStorageAnalysisSummary } from '../analyzers/storage-analyzer.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

console.log('='.repeat(80));
console.log('Storage Operations Analysis - Task 3.1');
console.log('='.repeat(80));
console.log();

// Generate detailed storage report
console.log('Generating storage operations report...\n');
const storageReport = generateStorageReport(projectRoot);

console.log('📊 STORAGE OPERATIONS SUMMARY');
console.log('-'.repeat(80));
console.log(`Total Operations:        ${storageReport.totalOperations}`);
console.log(`Total Unique Keys:       ${storageReport.totalKeys}`);
console.log(`  - Write Operations:    ${storageReport.writeOperations}`);
console.log(`  - Read Operations:     ${storageReport.readOperations}`);
console.log(`  - Remove Operations:   ${storageReport.removeOperations}`);
console.log();

console.log('📝 STORAGE KEYS DETAIL');
console.log('-'.repeat(80));
Object.entries(storageReport.keysSummary).forEach(([key, info]) => {
  console.log(`\nKey: '${key}'`);
  console.log(`  Writes:  ${info.writeCount} time(s) at line(s): ${info.writeLocations.map(l => l.line).join(', ')}`);
  console.log(`  Reads:   ${info.readCount} time(s) at line(s): ${info.readLocations.map(l => l.line).join(', ')}`);
  console.log(`  Removes: ${info.removeCount} time(s) at line(s): ${info.removeLocations.map(l => l.line).join(', ')}`);
  console.log(`  Status:  ${info.isWriteOnly ? '⚠️  WRITE-ONLY' : info.isReadOnly ? '⚠️  READ-ONLY' : '✓ Balanced'}`);
  console.log(`  Error Handling: ${info.missingErrorHandling ? '⚠️  Missing in some operations' : '✓ Present'}`);
});
console.log();

// Generate findings
console.log('🔍 ANALYZING FOR ISSUES...\n');
const findings = analyzeStorageOperations(projectRoot);

if (findings.length === 0) {
  console.log('✅ No issues found! All storage operations are correctly implemented.\n');
} else {
  console.log(`❌ Found ${findings.length} issue(s):\n`);
  
  // Group findings by subcategory
  const writeOnlyFindings = findings.filter(f => f.subcategory === 'write-only-storage-key');
  const readOnlyFindings = findings.filter(f => f.subcategory === 'read-only-storage-key');
  const errorHandlingFindings = findings.filter(f => f.subcategory === 'missing-storage-error-handling');
  
  if (writeOnlyFindings.length > 0) {
    console.log('🔴 WRITE-ONLY KEYS (stored but never retrieved):');
    console.log('-'.repeat(80));
    writeOnlyFindings.forEach((finding, index) => {
      console.log(`${index + 1}. Line ${finding.line}: ${finding.description}`);
      console.log(`   Code: ${finding.codeSnippet}`);
      console.log(`   💡 ${finding.recommendation}`);
      console.log();
    });
  }
  
  if (readOnlyFindings.length > 0) {
    console.log('🟡 READ-ONLY KEYS (retrieved but never stored):');
    console.log('-'.repeat(80));
    readOnlyFindings.forEach((finding, index) => {
      console.log(`${index + 1}. Line ${finding.line}: ${finding.description}`);
      console.log(`   Code: ${finding.codeSnippet}`);
      console.log(`   💡 ${finding.recommendation}`);
      console.log();
    });
  }
  
  if (errorHandlingFindings.length > 0) {
    console.log('🟠 MISSING ERROR HANDLING:');
    console.log('-'.repeat(80));
    errorHandlingFindings.forEach((finding, index) => {
      console.log(`${index + 1}. Line ${finding.line}: ${finding.description}`);
      console.log(`   Code: ${finding.codeSnippet}`);
      console.log(`   💡 ${finding.recommendation}`);
      console.log();
    });
  }
  
  // Generate summary
  const summary = generateStorageAnalysisSummary(findings);
  console.log('📈 FINDINGS SUMMARY');
  console.log('-'.repeat(80));
  console.log(`Total Issues:            ${summary.totalIssues}`);
  console.log(`  - Write-only keys:     ${summary.writeOnlyKeys}`);
  console.log(`  - Read-only keys:      ${summary.readOnlyKeys}`);
  console.log(`  - Missing error handling: ${summary.missingErrorHandling}`);
  console.log(`Total Impact Score:      ${summary.totalImpact}`);
  console.log(`Average Impact:          ${summary.averageImpact}`);
  console.log(`Severity Breakdown:`);
  console.log(`  - Critical:            ${summary.bySeverity.critical}`);
  console.log(`  - Moderate:            ${summary.bySeverity.moderate}`);
  console.log(`  - Minor:               ${summary.bySeverity.minor}`);
  console.log();
}

// Save reports to JSON
const reportsDir = path.join(projectRoot, 'analysis-tools', 'reports');
const reportPath = path.join(reportsDir, 'storage-analysis.json');

const reportData = {
  timestamp: new Date().toISOString(),
  storageReport,
  findings,
  summary: generateStorageAnalysisSummary(findings)
};

fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
console.log(`📁 Full report saved to: ${reportPath}`);
console.log();
console.log('='.repeat(80));
console.log('Analysis Complete');
console.log('='.repeat(80));
