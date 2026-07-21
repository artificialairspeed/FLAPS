/**
 * Runner script for Socket.IO Event Symmetry Checker
 * 
 * Usage: node analysis-tools/analyzers/run-socketio-analysis.js
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { analyzeSocketIOSymmetry, generateSocketIOSymmetrySummary } from './socketio-symmetry-checker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get project root (two levels up from this file)
const projectRoot = path.resolve(__dirname, '..', '..');

console.log('🔍 Socket.IO Event Symmetry Checker');
console.log('=====================================\n');

// Run analysis
console.log('Analyzing Socket.IO events...');
const findings = analyzeSocketIOSymmetry(projectRoot);

// Generate summary
const summary = generateSocketIOSymmetrySummary(findings);

// Display summary
console.log('\n📊 Analysis Summary');
console.log('-------------------');
console.log(`Total issues found: ${summary.totalIssues}`);
console.log(`\nBy category:`);
console.log(`  - Client emits without server listener: ${summary.bySubcategory['unhandled-client-event']}`);
console.log(`  - Server listens without client emit: ${summary.bySubcategory['orphaned-server-listener']}`);
console.log(`  - Server emits without client listener: ${summary.bySubcategory['unhandled-server-event']}`);
console.log(`  - Client listens without server emit: ${summary.bySubcategory['orphaned-client-listener']}`);
console.log(`\nBy severity:`);
console.log(`  - Critical: ${summary.bySeverity.critical}`);
console.log(`  - Moderate: ${summary.bySeverity.moderate}`);
console.log(`  - Minor: ${summary.bySeverity.minor}`);
console.log(`\nTotal impact score: ${summary.totalImpact}`);
console.log(`Average impact: ${summary.averageImpact}`);

// Display detailed findings
if (findings.length > 0) {
  console.log('\n📋 Detailed Findings');
  console.log('--------------------\n');
  
  findings.forEach((finding, index) => {
    console.log(`${index + 1}. ${finding.description}`);
    console.log(`   File: ${path.relative(projectRoot, finding.file)}:${finding.line}`);
    console.log(`   Severity: ${finding.severity} | Effort: ${finding.effort} | Impact: ${finding.impact}`);
    console.log(`   Recommendation: ${finding.recommendation}`);
    console.log();
  });
} else {
  console.log('\n✅ No event symmetry issues found!');
}

// Save detailed report to JSON
const reportPath = path.join(projectRoot, 'analysis-tools', 'reports', 'socketio-symmetry-analysis.json');
const reportData = {
  timestamp: new Date().toISOString(),
  summary,
  findings: findings.map(f => ({
    id: f.id,
    category: f.category,
    subcategory: f.subcategory,
    severity: f.severity,
    effort: f.effort,
    impact: f.impact,
    file: path.relative(projectRoot, f.file),
    line: f.line,
    column: f.column,
    description: f.description,
    recommendation: f.recommendation,
    codeSnippet: f.codeSnippet
  }))
};

fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
console.log(`\n💾 Detailed report saved to: ${path.relative(projectRoot, reportPath)}`);

// Save markdown report
const mdReportPath = path.join(projectRoot, 'analysis-tools', 'reports', 'socketio-symmetry-analysis.md');
let mdContent = '# Socket.IO Event Symmetry Analysis Report\n\n';
mdContent += `**Generated:** ${new Date().toISOString()}\n\n`;
mdContent += '## Summary\n\n';
mdContent += `- **Total Issues:** ${summary.totalIssues}\n`;
mdContent += `- **Total Impact Score:** ${summary.totalImpact}\n`;
mdContent += `- **Average Impact:** ${summary.averageImpact}\n\n`;

mdContent += '### Issues by Category\n\n';
mdContent += `- Client emits without server listener: **${summary.bySubcategory['unhandled-client-event']}**\n`;
mdContent += `- Server listens without client emit: **${summary.bySubcategory['orphaned-server-listener']}**\n`;
mdContent += `- Server emits without client listener: **${summary.bySubcategory['unhandled-server-event']}**\n`;
mdContent += `- Client listens without server emit: **${summary.bySubcategory['orphaned-client-listener']}**\n\n`;

mdContent += '### Issues by Severity\n\n';
mdContent += `- Critical: **${summary.bySeverity.critical}**\n`;
mdContent += `- Moderate: **${summary.bySeverity.moderate}**\n`;
mdContent += `- Minor: **${summary.bySeverity.minor}**\n\n`;

if (findings.length > 0) {
  mdContent += '## Detailed Findings\n\n';
  
  findings.forEach((finding, index) => {
    mdContent += `### ${index + 1}. ${finding.subcategory}\n\n`;
    mdContent += `**Description:** ${finding.description}\n\n`;
    mdContent += `**File:** \`${path.relative(projectRoot, finding.file)}:${finding.line}\`\n\n`;
    mdContent += `**Severity:** ${finding.severity} | **Effort:** ${finding.effort} | **Impact:** ${finding.impact}\n\n`;
    mdContent += `**Code:**\n\`\`\`javascript\n${finding.codeSnippet}\n\`\`\`\n\n`;
    mdContent += `**Recommendation:** ${finding.recommendation}\n\n`;
    mdContent += '---\n\n';
  });
} else {
  mdContent += '## ✅ No Issues Found\n\n';
  mdContent += 'All Socket.IO events are properly symmetrical between client and server!\n';
}

fs.writeFileSync(mdReportPath, mdContent);
console.log(`📄 Markdown report saved to: ${path.relative(projectRoot, mdReportPath)}`);

console.log('\n✅ Analysis complete!');
