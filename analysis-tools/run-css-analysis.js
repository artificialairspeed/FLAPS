#!/usr/bin/env node
/**
 * Standalone script to run CSS Selector Usage Analyzer
 * 
 * Usage: node analysis-tools/run-css-analysis.js
 */

import { analyzeCSSSelectors, generateCSSAnalysisSummary } from './analyzers/css-selector-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

console.log('🔍 Running CSS Selector Usage Analysis...\n');
console.log('━'.repeat(80));

// Run analysis
const findings = analyzeCSSSelectors(projectRoot);
const summary = generateCSSAnalysisSummary(findings);

// Display summary
console.log('\n📊 SUMMARY');
console.log('━'.repeat(80));
console.log(`Total Unused Selectors:      ${summary.totalUnused}`);
console.log(`  • Unused Classes:          ${summary.unusedClasses}`);
console.log(`  • Unused IDs:              ${summary.unusedIds}`);
console.log(`\nTotal Impact Score:          ${summary.totalImpact}`);
console.log(`Average Impact per Selector: ${summary.averageImpact}`);
console.log(`\nBy Severity:`);
console.log(`  • Critical:                ${summary.bySeverity.critical}`);
console.log(`  • Moderate:                ${summary.bySeverity.moderate}`);
console.log(`  • Minor:                   ${summary.bySeverity.minor}`);

// Display detailed findings
if (findings.length > 0) {
  console.log('\n📋 DETAILED FINDINGS');
  console.log('━'.repeat(80));
  
  // Group by subcategory
  const classFindings = findings.filter(f => f.subcategory === 'unused-css-class');
  const idFindings = findings.filter(f => f.subcategory === 'unused-css-id');
  
  if (classFindings.length > 0) {
    console.log('\n🔸 Unused CSS Classes:\n');
    classFindings.forEach((finding, index) => {
      console.log(`${index + 1}. ${finding.codeSnippet}`);
      console.log(`   File: ${path.relative(projectRoot, finding.file)}:${finding.line}`);
      console.log(`   Severity: ${finding.severity.toUpperCase()} | Impact: ${finding.impact}/100`);
      console.log(`   ${finding.description}`);
      console.log(`   💡 ${finding.recommendation}`);
      console.log();
    });
  }
  
  if (idFindings.length > 0) {
    console.log('\n🔹 Unused CSS IDs:\n');
    idFindings.forEach((finding, index) => {
      console.log(`${index + 1}. ${finding.codeSnippet}`);
      console.log(`   File: ${path.relative(projectRoot, finding.file)}:${finding.line}`);
      console.log(`   Severity: ${finding.severity.toUpperCase()} | Impact: ${finding.impact}/100`);
      console.log(`   ${finding.description}`);
      console.log(`   💡 ${finding.recommendation}`);
      console.log();
    });
  }
} else {
  console.log('\n✅ No unused CSS selectors found! All classes and IDs are in use.');
}

console.log('━'.repeat(80));
console.log('✨ Analysis complete!\n');

// Export findings to JSON if requested
if (process.argv.includes('--json')) {
  const outputPath = path.join(projectRoot, 'analysis-tools', 'reports', 'css-selector-analysis.json');
  const fs = await import('fs');
  
  const report = {
    timestamp: new Date().toISOString(),
    summary,
    findings
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to: ${path.relative(projectRoot, outputPath)}\n`);
}
