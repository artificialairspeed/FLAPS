#!/usr/bin/env node

/**
 * Font-Size Analysis Runner
 * 
 * Executes the font-size analyzer and generates a comprehensive report
 * Saves findings to reports/ directory in both JSON and Markdown formats
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeFontSizes, generateFontSizeReport } from './analyzers/font-size-analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(__dirname, 'reports');

/**
 * Ensure reports directory exists
 */
function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

/**
 * Format findings as Markdown
 * @param {Array} findings - Array of findings
 * @param {Object} report - Detailed analysis report
 * @returns {string} Markdown formatted report
 */
function formatMarkdownReport(findings, report) {
  let md = '# Font-Size Analysis Report\n\n';
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  
  // Executive Summary
  md += '## Executive Summary\n\n';
  md += `- **Total font-size declarations:** ${report.summary.totalDeclarations}\n`;
  md += `- **Unique sizes:** ${report.summary.uniqueSizes}\n`;
  md += `- **Responsive declarations:** ${report.summary.responsiveDeclarations} (${report.summary.responsivePercentage})\n`;
  md += `- **Total findings:** ${findings.length}\n\n`;
  
  // Unit Analysis
  md += '## Unit Analysis\n\n';
  if (report.units.hasInconsistency) {
    md += '⚠️ **Inconsistent units detected**\n\n';
  }
  md += '| Unit | Count | Percentage |\n';
  md += '|------|-------|------------|\n';
  report.units.unitBreakdown.forEach(item => {
    md += `| ${item.unit} | ${item.count} | ${item.percentage} |\n`;
  });
  md += '\n';
  
  // Type Scale Analysis
  md += '## Type Scale Analysis\n\n';
  md += `**Conformance to recommended scale:** ${report.typeScale.conformance}\n\n`;
  md += `**Recommended type scale:** ${report.typeScale.recommended.join(', ')}px\n\n`;
  md += `**Current sizes:** ${report.typeScale.current.join(', ')}px\n\n`;
  md += `- Sizes on scale: ${report.typeScale.onScale}\n`;
  md += `- Sizes off scale: ${report.typeScale.offScale}\n\n`;
  
  // Consolidation Opportunities
  if (report.consolidation.similarGroups > 0) {
    md += '## Consolidation Opportunities\n\n';
    md += `Found ${report.consolidation.similarGroups} groups of similar font sizes that could be consolidated.\n`;
    md += `**Potential reduction:** ${report.consolidation.potentialReduction} unique sizes\n\n`;
    
    report.consolidation.groups.forEach((group, index) => {
      md += `### Group ${index + 1}\n`;
      md += `- Current: ${group.sizes.join(', ')}\n`;
      md += `- Pixel equivalents: ${group.pxValues.join(', ')}\n`;
      md += `- **Suggested:** ${group.suggested}\n\n`;
    });
  }
  
  // Findings
  md += '## Detailed Findings\n\n';
  
  if (findings.length === 0) {
    md += '*No issues found. Font-size usage is consistent and well-structured.*\n\n';
  } else {
    findings.forEach((finding, index) => {
      md += `### ${index + 1}. ${finding.description}\n\n`;
      md += `- **Category:** ${finding.category}\n`;
      md += `- **Subcategory:** ${finding.subcategory}\n`;
      md += `- **Severity:** ${finding.severity}\n`;
      md += `- **Effort:** ${finding.effort}\n`;
      md += `- **Impact:** ${finding.impact}\n`;
      md += `- **File:** ${finding.file}\n`;
      md += `- **Line:** ${finding.line}\n\n`;
      md += `**Recommendation:**\n${finding.recommendation}\n\n`;
      if (finding.codeSnippet) {
        md += `**Context:**\n\`\`\`\n${finding.codeSnippet}\n\`\`\`\n\n`;
      }
      md += '---\n\n';
    });
  }
  
  // All Declarations
  md += '## All Font-Size Declarations\n\n';
  md += '| Selector | Value | Unit | Responsive | Line | Px Equivalent |\n';
  md += '|----------|-------|------|------------|------|---------------|\n';
  report.allDeclarations.forEach(decl => {
    const responsive = decl.isResponsive ? '✓' : '';
    md += `| ${decl.selector} | ${decl.value} | ${decl.unit} | ${responsive} | ${decl.line} | ${decl.pxEquivalent} |\n`;
  });
  md += '\n';
  
  return md;
}

/**
 * Main execution function
 */
function main() {
  console.log('🔍 Running Font-Size Analysis...\n');
  
  // Ensure reports directory exists
  ensureReportsDir();
  
  // Run analysis
  console.log('📊 Analyzing font-size declarations...');
  const findings = analyzeFontSizes(PROJECT_ROOT);
  
  console.log('📈 Generating detailed report...');
  const report = generateFontSizeReport(PROJECT_ROOT);
  
  // Save JSON report
  const jsonPath = path.join(REPORTS_DIR, 'font-size-analysis.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    findings,
    report,
    timestamp: new Date().toISOString()
  }, null, 2));
  console.log(`✅ JSON report saved to: ${jsonPath}`);
  
  // Save Markdown report
  const mdPath = path.join(REPORTS_DIR, 'font-size-analysis.md');
  const markdown = formatMarkdownReport(findings, report);
  fs.writeFileSync(mdPath, markdown);
  console.log(`✅ Markdown report saved to: ${mdPath}`);
  
  // Print summary
  console.log('\n📋 Analysis Summary:');
  console.log(`   Total declarations: ${report.summary.totalDeclarations}`);
  console.log(`   Unique sizes: ${report.summary.uniqueSizes}`);
  console.log(`   Responsive: ${report.summary.responsiveDeclarations} (${report.summary.responsivePercentage})`);
  console.log(`   Findings: ${findings.length}`);
  
  if (findings.length > 0) {
    console.log('\n⚠️  Issues found:');
    findings.forEach((finding, index) => {
      console.log(`   ${index + 1}. [${finding.severity.toUpperCase()}] ${finding.subcategory}`);
    });
  } else {
    console.log('\n✨ No issues found!');
  }
  
  console.log('\n✅ Font-size analysis complete!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
