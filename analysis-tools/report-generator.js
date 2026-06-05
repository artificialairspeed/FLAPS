/**
 * Report generation utilities for analysis results
 */

import { createAnalysisReport } from './models.js';

/**
 * Generate a formatted analysis report
 * @param {Object} params - Report parameters
 * @param {string[]} params.filesAnalyzed - List of analyzed files
 * @param {Array} params.findings - Array of findings
 * @returns {Object} Analysis report
 */
export function generateAnalysisReport(params) {
  return createAnalysisReport(params);
}

/**
 * Format an analysis report as human-readable text
 * @param {Object} report - Analysis report
 * @returns {string} Formatted report
 */
export function formatReportAsText(report) {
  const lines = [];
  
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('           CODEBASE ANALYSIS REPORT');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Generated: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`Files Analyzed: ${report.filesAnalyzed.length}`);
  lines.push('');
  
  // Summary section
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push(`Total Findings: ${report.summary.total}`);
  lines.push(`Quick Wins: ${report.summary.quickWins}`);
  lines.push('');
  
  // By Category
  lines.push('By Category:');
  Object.entries(report.summary.byCategory).forEach(([category, count]) => {
    lines.push(`  ${category.padEnd(20)} ${count}`);
  });
  lines.push('');
  
  // By Severity
  lines.push('By Severity:');
  Object.entries(report.summary.bySeverity).forEach(([severity, count]) => {
    lines.push(`  ${severity.padEnd(20)} ${count}`);
  });
  lines.push('');
  
  // By Effort
  lines.push('By Effort:');
  Object.entries(report.summary.byEffort).forEach(([effort, count]) => {
    lines.push(`  ${effort.padEnd(20)} ${count}`);
  });
  lines.push('');
  
  // Detailed findings
  if (report.findings.length > 0) {
    lines.push('FINDINGS');
    lines.push('───────────────────────────────────────────────────────────');
    
    report.findings.forEach((finding, index) => {
      lines.push('');
      lines.push(`${index + 1}. [${finding.severity.toUpperCase()}] ${finding.description}`);
      lines.push(`   Category: ${finding.category} → ${finding.subcategory}`);
      lines.push(`   Effort: ${finding.effort} | Impact: ${finding.impact}/100`);
      lines.push(`   Location: ${finding.file}:${finding.line}`);
      lines.push(`   Recommendation: ${finding.recommendation}`);
      
      if (finding.codeSnippet) {
        lines.push('   Code:');
        finding.codeSnippet.split('\n').forEach(line => {
          lines.push(`     ${line}`);
        });
      }
    });
  }
  
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Format an analysis report as JSON
 * @param {Object} report - Analysis report
 * @returns {string} JSON string
 */
export function formatReportAsJSON(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Format an analysis report as Markdown
 * @param {Object} report - Analysis report
 * @returns {string} Markdown formatted report
 */
export function formatReportAsMarkdown(report) {
  const lines = [];
  
  lines.push('# Codebase Analysis Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`**Files Analyzed:** ${report.filesAnalyzed.length}`);
  lines.push('');
  
  // Summary section
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Findings:** ${report.summary.total}`);
  lines.push(`- **Quick Wins:** ${report.summary.quickWins}`);
  lines.push('');
  
  // By Category
  lines.push('### By Category');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  Object.entries(report.summary.byCategory).forEach(([category, count]) => {
    lines.push(`| ${category} | ${count} |`);
  });
  lines.push('');
  
  // By Severity
  lines.push('### By Severity');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  Object.entries(report.summary.bySeverity).forEach(([severity, count]) => {
    lines.push(`| ${severity} | ${count} |`);
  });
  lines.push('');
  
  // By Effort
  lines.push('### By Effort');
  lines.push('');
  lines.push('| Effort | Count |');
  lines.push('|--------|-------|');
  Object.entries(report.summary.byEffort).forEach(([effort, count]) => {
    lines.push(`| ${effort} | ${count} |`);
  });
  lines.push('');
  
  // Detailed findings
  if (report.findings.length > 0) {
    lines.push('## Findings');
    lines.push('');
    
    report.findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.description}`);
      lines.push('');
      lines.push(`- **Severity:** ${finding.severity}`);
      lines.push(`- **Category:** ${finding.category} → ${finding.subcategory}`);
      lines.push(`- **Effort:** ${finding.effort}`);
      lines.push(`- **Impact:** ${finding.impact}/100`);
      lines.push(`- **Location:** \`${finding.file}:${finding.line}\``);
      lines.push(`- **Recommendation:** ${finding.recommendation}`);
      
      if (finding.codeSnippet) {
        lines.push('');
        lines.push('**Code:**');
        lines.push('```javascript');
        lines.push(finding.codeSnippet);
        lines.push('```');
      }
      
      lines.push('');
    });
  }
  
  return lines.join('\n');
}

/**
 * Generate a summary report of changes made
 * @param {Object} params - Parameters
 * @param {Array} params.implemented - Implemented changes
 * @param {Array} params.deferred - Deferred changes
 * @param {Array} params.failed - Failed changes
 * @returns {Object} Summary report
 */
export function generateChangeReport(params) {
  const { implemented = [], deferred = [], failed = [] } = params;
  
  const summary = {
    total: implemented.length + deferred.length + failed.length,
    implemented: implemented.length,
    deferred: deferred.length,
    failed: failed.length,
    implementationRate: 0
  };
  
  if (summary.total > 0) {
    summary.implementationRate = ((summary.implemented / summary.total) * 100).toFixed(1);
  }
  
  // Group by category
  const byCategory = {};
  implemented.forEach(change => {
    const category = change.type || 'unknown';
    byCategory[category] = (byCategory[category] || 0) + 1;
  });
  
  return {
    summary,
    byCategory,
    changes: {
      implemented,
      deferred,
      failed
    }
  };
}

/**
 * Format a change report as text
 * @param {Object} report - Change report
 * @returns {string} Formatted report
 */
export function formatChangeReportAsText(report) {
  const lines = [];
  
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('           CLEANUP EXECUTION REPORT');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push(`Total Changes: ${report.summary.total}`);
  lines.push(`Implemented: ${report.summary.implemented}`);
  lines.push(`Deferred: ${report.summary.deferred}`);
  lines.push(`Failed: ${report.summary.failed}`);
  lines.push(`Implementation Rate: ${report.summary.implementationRate}%`);
  lines.push('');
  
  if (Object.keys(report.byCategory).length > 0) {
    lines.push('By Change Type:');
    Object.entries(report.byCategory).forEach(([category, count]) => {
      lines.push(`  ${category.padEnd(20)} ${count}`);
    });
    lines.push('');
  }
  
  if (report.changes.implemented.length > 0) {
    lines.push('IMPLEMENTED CHANGES');
    lines.push('───────────────────────────────────────────────────────────');
    report.changes.implemented.forEach((change, index) => {
      lines.push(`${index + 1}. ${change.file} (${change.type})`);
      lines.push(`   Rationale: ${change.rationale}`);
      if (change.beforeSnippet) {
        lines.push(`   Before: ${change.beforeSnippet.substring(0, 50)}...`);
      }
      if (change.afterSnippet) {
        lines.push(`   After: ${change.afterSnippet.substring(0, 50)}...`);
      }
    });
    lines.push('');
  }
  
  if (report.changes.deferred.length > 0) {
    lines.push('DEFERRED CHANGES');
    lines.push('───────────────────────────────────────────────────────────');
    report.changes.deferred.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.finding?.description || 'Unknown'}`);
      lines.push(`   Reason: ${item.reason}`);
    });
    lines.push('');
  }
  
  if (report.changes.failed.length > 0) {
    lines.push('FAILED CHANGES');
    lines.push('───────────────────────────────────────────────────────────');
    report.changes.failed.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.finding?.description || 'Unknown'}`);
      lines.push(`   Reason: ${item.reason}`);
    });
    lines.push('');
  }
  
  lines.push('═══════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Calculate priority score for a finding
 * @param {'critical'|'moderate'|'minor'} severity - Severity level
 * @param {'quick-win'|'medium'|'complex'} effort - Effort level
 * @param {number} impact - Impact score (0-100)
 * @returns {number} Priority score
 */
export function calculatePriority(severity, effort, impact) {
  const severityScore = {
    critical: 100,
    moderate: 50,
    minor: 25
  };
  
  const effortMultiplier = {
    'quick-win': 3,
    medium: 2,
    complex: 1
  };
  
  return (severityScore[severity] + impact) * effortMultiplier[effort];
}

/**
 * Sort findings by priority (quick-wins first)
 * @param {Array} findings - Array of findings
 * @returns {Array} Sorted findings
 */
export function prioritizeFindings(findings) {
  // Calculate priority for each finding if not already set
  findings.forEach(finding => {
    if (finding.priority === undefined) {
      finding.priority = calculatePriority(finding.severity, finding.effort, finding.impact);
    }
  });
  
  // Sort by priority (descending)
  return findings.sort((a, b) => b.priority - a.priority);
}

/**
 * Group findings by category
 * @param {Array} findings - Array of findings
 * @returns {Object} Findings grouped by category
 */
export function groupByCategory(findings) {
  const grouped = {};
  
  findings.forEach(finding => {
    const category = finding.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(finding);
  });
  
  return grouped;
}
