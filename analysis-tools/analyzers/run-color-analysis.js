/**
 * Run Color Usage Analysis
 * 
 * This script runs the color usage analyzer on the FLAPS codebase
 * and generates a detailed report in the reports directory.
 */

import fs from 'fs';
import path from 'path';
import { generateColorAnalysisReport } from './color-usage-analyzer.js';

const projectRoot = path.resolve(process.cwd());
const reportsDir = path.join(projectRoot, 'analysis-tools', 'reports');

// Ensure reports directory exists
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

console.log('🎨 Running Color Usage Analysis...\n');

// Run the analysis
const report = generateColorAnalysisReport(projectRoot);

// Display summary
console.log('📊 Summary:');
console.log(`  Total colors found: ${report.summary.totalColors}`);
console.log(`  Unique colors: ${report.summary.uniqueColors}`);
console.log(`  CSS variables defined: ${report.summary.cssVariables}`);
console.log(`  Hardcoded colors: ${report.summary.hardcodedColors}`);
console.log(`  Similar colors: ${report.summary.similarColors}`);
console.log(`  Contrast issues: ${report.summary.contrastIssues}`);
console.log(`  Format inconsistencies: ${report.summary.formatInconsistencies}\n`);

console.log('🎨 Color Format Breakdown:');
console.log(`  Hex colors: ${report.colorsByType.hex}`);
console.log(`  RGB/RGBA colors: ${report.colorsByType.rgb}`);
console.log(`  Named colors: ${report.colorsByType.named}\n`);

// Display CSS variables
console.log('🔧 CSS Variables (Theme Colors):');
Object.entries(report.cssVariables).forEach(([name, value]) => {
  console.log(`  ${name}: ${value}`);
});
console.log('');

// Display findings by category
if (report.findings.length > 0) {
  console.log('⚠️  Findings:');
  
  const bySubcategory = {};
  report.findings.forEach(finding => {
    if (!bySubcategory[finding.subcategory]) {
      bySubcategory[finding.subcategory] = [];
    }
    bySubcategory[finding.subcategory].push(finding);
  });
  
  Object.entries(bySubcategory).forEach(([subcategory, findings]) => {
    console.log(`\n  ${subcategory} (${findings.length}):`);
    findings.slice(0, 5).forEach(finding => {
      console.log(`    Line ${finding.line}: ${finding.description}`);
    });
    if (findings.length > 5) {
      console.log(`    ... and ${findings.length - 5} more`);
    }
  });
  console.log('');
} else {
  console.log('✅ No color usage issues found!\n');
}

// Save JSON report
const jsonReportPath = path.join(reportsDir, 'color-usage-analysis.json');
fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));
console.log(`💾 Detailed JSON report saved to: ${jsonReportPath}`);

// Generate human-readable markdown report
const mdReport = generateMarkdownReport(report);
const mdReportPath = path.join(reportsDir, 'color-usage-analysis.md');
fs.writeFileSync(mdReportPath, mdReport);
console.log(`📝 Markdown report saved to: ${mdReportPath}\n`);

console.log('✅ Color usage analysis complete!');

/**
 * Generate a human-readable markdown report
 * @param {Object} report - The color analysis report
 * @returns {string} Markdown formatted report
 */
function generateMarkdownReport(report) {
  let md = '# Color Usage Analysis Report\n\n';
  md += `Generated: ${new Date(report.timestamp).toLocaleString()}\n\n`;
  
  md += '## Summary\n\n';
  md += `- **Total Colors**: ${report.summary.totalColors}\n`;
  md += `- **Unique Colors**: ${report.summary.uniqueColors}\n`;
  md += `- **CSS Variables**: ${report.summary.cssVariables}\n`;
  md += `- **Hardcoded Colors**: ${report.summary.hardcodedColors}\n`;
  md += `- **Similar Colors**: ${report.summary.similarColors}\n`;
  md += `- **Contrast Issues**: ${report.summary.contrastIssues}\n`;
  md += `- **Format Inconsistencies**: ${report.summary.formatInconsistencies}\n\n`;
  
  md += '## Color Format Breakdown\n\n';
  md += `- **Hex**: ${report.colorsByType.hex}\n`;
  md += `- **RGB/RGBA**: ${report.colorsByType.rgb}\n`;
  md += `- **Named**: ${report.colorsByType.named}\n\n`;
  
  md += '## CSS Variables (Theme)\n\n';
  md += '| Variable | Value |\n';
  md += '|----------|-------|\n';
  Object.entries(report.cssVariables).forEach(([name, value]) => {
    md += `| \`${name}\` | \`${value}\` |\n`;
  });
  md += '\n';
  
  md += '## Color Palette\n\n';
  const paletteEntries = Object.entries(report.colorPalette);
  if (paletteEntries.length > 0) {
    md += '| Color | RGB | Occurrences |\n';
    md += '|-------|-----|-------------|\n';
    paletteEntries.slice(0, 20).forEach(([key, data]) => {
      const rgbStr = data.rgb ? `rgb(${data.rgb.join(', ')})` : 'N/A';
      md += `| \`${data.value}\` | ${rgbStr} | ${data.occurrences.length} times |\n`;
    });
    if (paletteEntries.length > 20) {
      md += `\n*... and ${paletteEntries.length - 20} more colors*\n`;
    }
  }
  md += '\n';
  
  if (report.findings.length > 0) {
    md += '## Findings\n\n';
    
    const bySubcategory = {};
    report.findings.forEach(finding => {
      if (!bySubcategory[finding.subcategory]) {
        bySubcategory[finding.subcategory] = [];
      }
      bySubcategory[finding.subcategory].push(finding);
    });
    
    Object.entries(bySubcategory).forEach(([subcategory, findings]) => {
      md += `### ${subcategory.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} (${findings.length})\n\n`;
      
      findings.forEach(finding => {
        md += `#### Line ${finding.line}\n\n`;
        md += `**Severity**: ${finding.severity} | **Effort**: ${finding.effort} | **Impact**: ${finding.impact}\n\n`;
        md += `${finding.description}\n\n`;
        md += `**Recommendation**: ${finding.recommendation}\n\n`;
        if (finding.codeSnippet) {
          md += '```css\n';
          md += finding.codeSnippet + '\n';
          md += '```\n\n';
        }
      });
    });
  } else {
    md += '## Findings\n\n';
    md += '✅ No color usage issues found!\n\n';
  }
  
  return md;
}
