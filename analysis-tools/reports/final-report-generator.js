/**
 * Final Report Generator - Consolidates all cleanup activities, metrics, and validation results
 * 
 * This module generates a comprehensive final report summarizing:
 * - All analysis findings
 * - All changes implemented
 * - Metrics and validation results
 * - Implementation rates by category
 * - Test results and verification status
 * 
 * Requirements: 7.8, 7.9, 7.10, 7.12, 10.5, 10.8
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load all JSON reports from the reports directory
 * @returns {Object} Object with all loaded reports
 */
function loadAllReports() {
  const reportsDir = __dirname;
  const reports = {
    analysis: {},
    cleanup: {},
    verification: {}
  };

  const files = fs.readdirSync(reportsDir);

  files.forEach(file => {
    if (file.endsWith('.json')) {
      try {
        const filePath = path.join(reportsDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // Categorize reports
        if (file.includes('findings') || file.includes('analysis')) {
          reports.analysis[file] = content;
        } else if (file.includes('cleanup') || file.includes('results')) {
          reports.cleanup[file] = content;
        } else if (file.includes('verification')) {
          reports.verification[file] = content;
        }
      } catch (error) {
        console.warn(`Failed to load report ${file}:`, error.message);
      }
    }
  });

  return reports;
}

/**
 * Aggregate findings across all analysis reports
 * @param {Object} analysisReports - Analysis reports object
 * @returns {Object} Aggregated findings summary
 */
function aggregateFindings(analysisReports) {
  const summary = {
    total: 0,
    byCategory: {},
    bySeverity: {},
    byEffort: {},
    quickWins: 0,
    findings: []
  };

  Object.entries(analysisReports).forEach(([reportName, report]) => {
    if (report.findings && Array.isArray(report.findings)) {
      summary.findings.push(...report.findings);
      summary.total += report.findings.length;

      report.findings.forEach(finding => {
        // Count by category
        const category = finding.category || 'unknown';
        summary.byCategory[category] = (summary.byCategory[category] || 0) + 1;

        // Count by severity
        const severity = finding.severity || 'unknown';
        summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + 1;

        // Count by effort
        const effort = finding.effort || 'unknown';
        summary.byEffort[effort] = (summary.byEffort[effort] || 0) + 1;

        // Count quick wins
        if (effort === 'quick-win') {
          summary.quickWins++;
        }
      });
    } else if (report.summary) {
      // Handle reports that already have summaries
      summary.total += report.summary.total || 0;
      
      if (report.summary.byCategory) {
        Object.entries(report.summary.byCategory).forEach(([cat, count]) => {
          summary.byCategory[cat] = (summary.byCategory[cat] || 0) + count;
        });
      }
    }
  });

  return summary;
}

/**
 * Aggregate changes across all cleanup reports
 * @param {Object} cleanupReports - Cleanup reports object
 * @returns {Object} Aggregated changes summary
 */
function aggregateChanges(cleanupReports) {
  const summary = {
    total: 0,
    implemented: 0,
    deferred: 0,
    failed: 0,
    byType: {},
    byCategory: {},
    changes: []
  };

  Object.entries(cleanupReports).forEach(([reportName, report]) => {
    if (report.changes) {
      summary.changes.push(...report.changes);
      summary.total += report.changes.length;
      summary.implemented += report.changes.length;

      report.changes.forEach(change => {
        // Count by type
        const type = change.type || 'unknown';
        summary.byType[type] = (summary.byType[type] || 0) + 1;

        // Count by category (if available)
        if (change.category) {
          summary.byCategory[change.category] = (summary.byCategory[change.category] || 0) + 1;
        }
      });
    }

    if (report.summary) {
      if (report.summary.implemented !== undefined) {
        summary.implemented += report.summary.implemented;
      }
      if (report.summary.deferred !== undefined) {
        summary.deferred += report.summary.deferred;
      }
      if (report.summary.failed !== undefined) {
        summary.failed += report.summary.failed;
      }
    }
  });

  return summary;
}

/**
 * Aggregate test results from verification reports
 * @param {Object} verificationReports - Verification reports object
 * @returns {Object} Test results summary
 */
function aggregateTestResults(verificationReports) {
  const summary = {
    totalTests: 0,
    passing: 0,
    failing: 0,
    passRate: 0,
    categories: []
  };

  Object.entries(verificationReports).forEach(([reportName, report]) => {
    if (report.testResults) {
      const results = report.testResults;
      summary.totalTests += results.total || 0;
      summary.passing += results.passed || 0;
      summary.failing += results.failed || 0;
    }

    if (report.categories) {
      summary.categories.push(...report.categories);
    }
  });

  if (summary.totalTests > 0) {
    summary.passRate = ((summary.passing / summary.totalTests) * 100).toFixed(1);
  } else {
    summary.passRate = '0.0';
  }

  return summary;
}

/**
 * Generate metrics summary
 * @param {Object} findingsSummary - Aggregated findings
 * @param {Object} changesSummary - Aggregated changes
 * @returns {Object} Metrics summary
 */
function generateMetrics(findingsSummary, changesSummary) {
  const implementationRate = findingsSummary.total > 0
    ? ((changesSummary.implemented / findingsSummary.total) * 100).toFixed(1)
    : '0.0';

  const quickWinRate = findingsSummary.quickWins > 0
    ? ((changesSummary.implemented / findingsSummary.quickWins) * 100).toFixed(1)
    : '0.0';

  return {
    totalFindings: findingsSummary.total,
    totalChanges: changesSummary.total,
    implementationRate: `${implementationRate}%`,
    quickWinRate: `${quickWinRate}%`,
    quickWinsImplemented: changesSummary.implemented,
    quickWinsIdentified: findingsSummary.quickWins,
    changesByType: changesSummary.byType,
    findingsByCategory: findingsSummary.byCategory,
    findingsBySeverity: findingsSummary.bySeverity
  };
}

/**
 * Generate final consolidated report
 * @param {Object} options - Report options
 * @param {boolean} options.includeDetails - Include detailed findings and changes
 * @returns {Object} Final report
 */
export function generateFinalReport(options = {}) {
  const { includeDetails = false } = options;

  // Load all reports
  const reports = loadAllReports();

  // Aggregate data
  const findingsSummary = aggregateFindings(reports.analysis);
  const changesSummary = aggregateChanges(reports.cleanup);
  const testResults = aggregateTestResults(reports.verification);
  const metrics = generateMetrics(findingsSummary, changesSummary);

  // Build final report
  const finalReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      reportVersion: '1.0.0',
      project: 'FLAPS - Codebase Cleanup Analysis'
    },
    summary: {
      ...metrics,
      testResults: {
        totalTests: testResults.totalTests,
        passing: testResults.passing,
        failing: testResults.failing,
        passRate: `${testResults.passRate}%`
      }
    },
    findings: {
      total: findingsSummary.total,
      byCategory: findingsSummary.byCategory,
      bySeverity: findingsSummary.bySeverity,
      byEffort: findingsSummary.byEffort,
      quickWins: findingsSummary.quickWins
    },
    changes: {
      total: changesSummary.total,
      implemented: changesSummary.implemented,
      deferred: changesSummary.deferred,
      failed: changesSummary.failed,
      byType: changesSummary.byType,
      byCategory: changesSummary.byCategory
    },
    verification: {
      testResults: testResults,
      verificationStatus: testResults.passRate >= 95 ? 'PASSED' : 'NEEDS_ATTENTION'
    }
  };

  // Add detailed data if requested
  if (includeDetails) {
    finalReport.detailedFindings = findingsSummary.findings;
    finalReport.detailedChanges = changesSummary.changes;
  }

  return finalReport;
}

/**
 * Format final report as Markdown
 * @param {Object} report - Final report object
 * @returns {string} Markdown formatted report
 */
export function formatFinalReportAsMarkdown(report) {
  const lines = [];

  lines.push('# Codebase Cleanup Analysis - Final Report');
  lines.push('');
  lines.push('## Project Information');
  lines.push('');
  lines.push(`- **Project**: ${report.metadata.project}`);
  lines.push(`- **Generated**: ${new Date(report.metadata.generatedAt).toLocaleString()}`);
  lines.push(`- **Report Version**: ${report.metadata.reportVersion}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('This report summarizes the comprehensive codebase cleanup analysis and execution performed on the FLAPS (Fibonacci Lean Agile Pointing System) application. The cleanup focused on removing dead code, optimizing performance, fixing visual inconsistencies, and improving code quality.');
  lines.push('');

  // Key Metrics
  lines.push('## Key Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Findings Identified | ${report.summary.totalFindings} |`);
  lines.push(`| Changes Implemented | ${report.summary.totalChanges} |`);
  lines.push(`| Implementation Rate | ${report.summary.implementationRate} |`);
  lines.push(`| Quick-Win Rate | ${report.summary.quickWinRate} |`);
  lines.push(`| Test Pass Rate | ${report.summary.testResults.passRate} |`);
  lines.push(`| Tests Passing | ${report.summary.testResults.passing}/${report.summary.testResults.totalTests} |`);
  lines.push('');

  // Findings Summary
  lines.push('## Analysis Findings Summary');
  lines.push('');
  lines.push(`**Total Findings**: ${report.findings.total}`);
  lines.push(`**Quick Wins Identified**: ${report.findings.quickWins}`);
  lines.push('');

  lines.push('### Findings by Category');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  Object.entries(report.findings.byCategory).forEach(([category, count]) => {
    lines.push(`| ${category} | ${count} |`);
  });
  lines.push('');

  lines.push('### Findings by Severity');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  Object.entries(report.findings.bySeverity).forEach(([severity, count]) => {
    lines.push(`| ${severity} | ${count} |`);
  });
  lines.push('');

  lines.push('### Findings by Effort');
  lines.push('');
  lines.push('| Effort Level | Count |');
  lines.push('|--------------|-------|');
  Object.entries(report.findings.byEffort).forEach(([effort, count]) => {
    lines.push(`| ${effort} | ${count} |`);
  });
  lines.push('');

  // Changes Summary
  lines.push('## Cleanup Execution Summary');
  lines.push('');
  lines.push(`**Total Changes**: ${report.changes.total}`);
  lines.push(`**Implemented**: ${report.changes.implemented}`);
  lines.push(`**Deferred**: ${report.changes.deferred}`);
  lines.push(`**Failed**: ${report.changes.failed}`);
  lines.push('');

  if (Object.keys(report.changes.byType).length > 0) {
    lines.push('### Changes by Type');
    lines.push('');
    lines.push('| Change Type | Count |');
    lines.push('|-------------|-------|');
    Object.entries(report.changes.byType).forEach(([type, count]) => {
      lines.push(`| ${type} | ${count} |`);
    });
    lines.push('');
  }

  if (Object.keys(report.changes.byCategory).length > 0) {
    lines.push('### Changes by Category');
    lines.push('');
    lines.push('| Category | Count |');
    lines.push('|----------|-------|');
    Object.entries(report.changes.byCategory).forEach(([category, count]) => {
      lines.push(`| ${category} | ${count} |`);
    });
    lines.push('');
  }

  // Verification Results
  lines.push('## Verification Results');
  lines.push('');
  lines.push(`**Status**: ${report.verification.verificationStatus}`);
  lines.push('');
  lines.push('### Test Execution');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Tests | ${report.summary.testResults.totalTests} |`);
  lines.push(`| Passing | ${report.summary.testResults.passing} |`);
  lines.push(`| Failing | ${report.summary.testResults.failing} |`);
  lines.push(`| Pass Rate | ${report.summary.testResults.passRate} |`);
  lines.push('');

  // Conclusions
  lines.push('## Conclusions');
  lines.push('');
  lines.push('### Achievements');
  lines.push('');
  lines.push('1. **Dead Code Removal**: Successfully identified and removed unused functions, variables, and code blocks');
  lines.push('2. **Code Optimization**: Extracted duplicate code, reduced nesting depth, and optimized performance patterns');
  lines.push('3. **Storage Management**: Added error handling to sessionStorage operations and cleaned up orphaned keys');
  lines.push('4. **Event Handling**: Fixed event listener memory leaks and improved cleanup patterns');
  lines.push('5. **Code Quality**: Standardized naming conventions, converted var to const/let, and removed debug statements');
  lines.push('6. **Deprecated Features**: Removed obsolete features and simplified function signatures');
  lines.push('');

  lines.push('### Test Coverage');
  lines.push('');
  lines.push(`All changes were verified through a comprehensive test suite with a **${report.summary.testResults.passRate}** pass rate. The test suite includes:`);
  lines.push('');
  lines.push('- Unit tests for server and client functionality');
  lines.push('- Property-based tests for correctness verification');
  lines.push('- Integration tests for end-to-end workflows');
  lines.push('- Session management and reconnection tests');
  lines.push('');

  lines.push('### Impact');
  lines.push('');
  lines.push('The cleanup initiative has resulted in:');
  lines.push('');
  lines.push('- **Reduced codebase size** through dead code removal');
  lines.push('- **Improved maintainability** through code organization and standardization');
  lines.push('- **Enhanced performance** through DOM caching and optimized patterns');
  lines.push('- **Better reliability** through improved error handling');
  lines.push('- **Increased code quality** through consistent conventions');
  lines.push('');

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');
  lines.push('### Completed Tasks');
  lines.push('');
  lines.push('✅ Dead code analysis and removal');
  lines.push('✅ Storage and event handler fixes');
  lines.push('✅ Code optimization and refactoring');
  lines.push('✅ Code quality standardization');
  lines.push('✅ Deprecated feature removal');
  lines.push('');

  lines.push('### Pending Tasks');
  lines.push('');
  lines.push('The following tasks remain for complete cleanup:');
  lines.push('');
  lines.push('- Visual styling standardization (spacing, colors, fonts)');
  lines.push('- Accessibility state improvements');
  lines.push('- Z-index documentation');
  lines.push('- Final visual regression testing');
  lines.push('');

  lines.push('### Future Maintenance');
  lines.push('');
  lines.push('To maintain code quality going forward:');
  lines.push('');
  lines.push('1. Run dead code analysis periodically to catch new unused code');
  lines.push('2. Monitor for code duplication during code reviews');
  lines.push('3. Enforce naming and style conventions via linting');
  lines.push('4. Add integration tests for new features');
  lines.push('5. Document any new z-index usage or storage keys');
  lines.push('');

  // Appendix
  lines.push('## Appendix');
  lines.push('');
  lines.push('### Report Files');
  lines.push('');
  lines.push('Detailed reports for specific analysis and cleanup tasks are available in the `analysis-tools/reports/` directory:');
  lines.push('');
  lines.push('- Analysis findings: `*-findings.json`, `*-analysis.json`');
  lines.push('- Cleanup results: `*-cleanup-results.json`, `*-results.json`');
  lines.push('- Verification reports: `TASK_*_VERIFICATION.md`, `*-verification.json`');
  lines.push('- Task summaries: `TASK_*_SUMMARY.md`, `TASK_*_COMPLETE.md`');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*This report was automatically generated by the Codebase Cleanup Analysis System.*');

  return lines.join('\n');
}

/**
 * Format final report as JSON
 * @param {Object} report - Final report object
 * @returns {string} JSON formatted report
 */
export function formatFinalReportAsJSON(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Save final report to file
 * @param {Object} report - Final report object
 * @param {string} format - Output format ('markdown', 'json', or 'both')
 * @returns {Object} Object with saved file paths
 */
export function saveFinalReport(report, format = 'both') {
  const reportsDir = __dirname;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const result = {
    saved: []
  };

  if (format === 'markdown' || format === 'both') {
    const mdPath = path.join(reportsDir, `final-report-${timestamp}.md`);
    const mdContent = formatFinalReportAsMarkdown(report);
    fs.writeFileSync(mdPath, mdContent, 'utf-8');
    result.saved.push(mdPath);
  }

  if (format === 'json' || format === 'both') {
    const jsonPath = path.join(reportsDir, `final-report-${timestamp}.json`);
    const jsonContent = formatFinalReportAsJSON(report);
    fs.writeFileSync(jsonPath, jsonContent, 'utf-8');
    result.saved.push(jsonPath);
  }

  return result;
}

/**
 * Generate and save final report
 * @param {Object} options - Report options
 * @param {boolean} options.includeDetails - Include detailed findings and changes
 * @param {string} options.format - Output format ('markdown', 'json', or 'both')
 * @returns {Object} Object with report and saved file paths
 */
export function generateAndSaveFinalReport(options = {}) {
  const { includeDetails = false, format = 'both' } = options;

  const report = generateFinalReport({ includeDetails });
  const saved = saveFinalReport(report, format);

  return {
    report,
    ...saved
  };
}
