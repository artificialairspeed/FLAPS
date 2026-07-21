#!/usr/bin/env node

/**
 * Standalone script to run accessibility state analysis
 * 
 * Usage: node analysis-tools/run-accessibility-analysis.js
 */

import { analyzeAccessibilityStates, generateAccessibilityStateSummary } from './analyzers/accessibility-state-checker.js';
import { createAnalysisReport } from './models.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🔍 Running Accessibility State Analysis...\n');
  
  // Project root is one level up from analysis-tools
  const projectRoot = path.resolve(__dirname, '..');
  
  try {
    // Run analysis
    const findings = analyzeAccessibilityStates(projectRoot);
    
    // Generate summary
    const summary = generateAccessibilityStateSummary(findings);
    
    // Create full report
    const report = createAnalysisReport({
      filesAnalyzed: [
        path.join(projectRoot, 'public', 'styles.css'),
        path.join(projectRoot, 'public', 'index.html')
      ],
      findings
    });
    
    // Display summary
    console.log('📊 Analysis Summary:');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Total Accessibility Issues: ${summary.totalIssues}`);
    console.log(`  • Missing Focus States: ${summary.missingFocusStates}`);
    console.log(`  • Invisible Focus Indicators: ${summary.invisibleFocusIndicators}`);
    console.log(`  • Missing ARIA CSS: ${summary.missingAriaCss}`);
    console.log(`  • Missing Disabled States: ${summary.missingDisabledStates}`);
    console.log('');
    console.log(`Severity Breakdown:`);
    console.log(`  • Critical: ${summary.bySeverity.critical}`);
    console.log(`  • Moderate: ${summary.bySeverity.moderate}`);
    console.log(`  • Minor: ${summary.bySeverity.minor}`);
    console.log('');
    console.log(`Impact:`);
    console.log(`  • Total Impact: ${summary.totalImpact}`);
    console.log(`  • Average Impact: ${summary.averageImpact}`);
    console.log('═══════════════════════════════════════════════════\n');
    
    // Display findings
    if (findings.length > 0) {
      console.log('🔎 Detailed Findings:\n');
      findings.forEach((finding, index) => {
        console.log(`${index + 1}. ${finding.description}`);
        console.log(`   Severity: ${finding.severity} | Impact: ${finding.impact} | Effort: ${finding.effort}`);
        console.log(`   Recommendation: ${finding.recommendation}`);
        console.log(`   Code: ${finding.codeSnippet}`);
        console.log('');
      });
    } else {
      console.log('✅ No accessibility state issues found!\n');
    }
    
    // Save report to file
    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const reportPath = path.join(reportsDir, 'accessibility-state-analysis.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Full report saved to: ${reportPath}`);
    
    // Save summary to markdown
    const markdownReport = generateMarkdownReport(summary, findings);
    const markdownPath = path.join(reportsDir, 'accessibility-state-analysis.md');
    fs.writeFileSync(markdownPath, markdownReport);
    console.log(`📝 Markdown report saved to: ${markdownPath}\n`);
    
    // Exit with appropriate code
    process.exit(findings.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('❌ Error during analysis:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Generate a markdown report
 * @param {Object} summary - Analysis summary
 * @param {Array} findings - Array of findings
 * @returns {string} Markdown formatted report
 */
function generateMarkdownReport(summary, findings) {
  let markdown = '# Accessibility State Analysis Report\n\n';
  markdown += `*Generated: ${new Date().toISOString()}*\n\n`;
  
  markdown += '## Summary\n\n';
  markdown += `- **Total Issues**: ${summary.totalIssues}\n`;
  markdown += `- **Missing Focus States**: ${summary.missingFocusStates}\n`;
  markdown += `- **Invisible Focus Indicators**: ${summary.invisibleFocusIndicators}\n`;
  markdown += `- **Missing ARIA CSS**: ${summary.missingAriaCss}\n`;
  markdown += `- **Missing Disabled States**: ${summary.missingDisabledStates}\n\n`;
  
  markdown += '### Severity Breakdown\n\n';
  markdown += `- **Critical**: ${summary.bySeverity.critical}\n`;
  markdown += `- **Moderate**: ${summary.bySeverity.moderate}\n`;
  markdown += `- **Minor**: ${summary.bySeverity.minor}\n\n`;
  
  markdown += '### Impact\n\n';
  markdown += `- **Total Impact**: ${summary.totalImpact}\n`;
  markdown += `- **Average Impact**: ${summary.averageImpact}\n\n`;
  
  if (findings.length > 0) {
    markdown += '## Detailed Findings\n\n';
    
    // Group by severity
    const critical = findings.filter(f => f.severity === 'critical');
    const moderate = findings.filter(f => f.severity === 'moderate');
    const minor = findings.filter(f => f.severity === 'minor');
    
    if (critical.length > 0) {
      markdown += '### 🔴 Critical Issues\n\n';
      critical.forEach((finding, index) => {
        markdown += `#### ${index + 1}. ${finding.subcategory}\n\n`;
        markdown += `**Description**: ${finding.description}\n\n`;
        markdown += `**Recommendation**: ${finding.recommendation}\n\n`;
        markdown += `**Code**: \`${finding.codeSnippet}\`\n\n`;
        markdown += `**Impact**: ${finding.impact} | **Effort**: ${finding.effort}\n\n`;
        markdown += '---\n\n';
      });
    }
    
    if (moderate.length > 0) {
      markdown += '### 🟡 Moderate Issues\n\n';
      moderate.forEach((finding, index) => {
        markdown += `#### ${index + 1}. ${finding.subcategory}\n\n`;
        markdown += `**Description**: ${finding.description}\n\n`;
        markdown += `**Recommendation**: ${finding.recommendation}\n\n`;
        markdown += `**Code**: \`${finding.codeSnippet}\`\n\n`;
        markdown += `**Impact**: ${finding.impact} | **Effort**: ${finding.effort}\n\n`;
        markdown += '---\n\n';
      });
    }
    
    if (minor.length > 0) {
      markdown += '### 🟢 Minor Issues\n\n';
      minor.forEach((finding, index) => {
        markdown += `#### ${index + 1}. ${finding.subcategory}\n\n`;
        markdown += `**Description**: ${finding.description}\n\n`;
        markdown += `**Recommendation**: ${finding.recommendation}\n\n`;
        markdown += `**Code**: \`${finding.codeSnippet}\`\n\n`;
        markdown += `**Impact**: ${finding.impact} | **Effort**: ${finding.effort}\n\n`;
        markdown += '---\n\n';
      });
    }
  } else {
    markdown += '## ✅ No Issues Found\n\n';
    markdown += 'All interactive elements have proper accessibility states defined!\n';
  }
  
  return markdown;
}

// Run the script
main();
