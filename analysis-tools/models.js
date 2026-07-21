/**
 * Core data models for the Codebase Analysis and Cleanup System
 */

/**
 * Finding - Represents a single issue identified during analysis
 * @typedef {Object} Finding
 * @property {string} id - Unique identifier
 * @property {'dead-code'|'optimization'|'visual'|'deprecation'|'storage'|'event'|'quality'} category - Issue category
 * @property {string} subcategory - Specific issue type (e.g., 'unused-function')
 * @property {'critical'|'moderate'|'minor'} severity - Severity level
 * @property {'quick-win'|'medium'|'complex'} effort - Effort level to fix
 * @property {number} impact - Estimated impact score (0-100)
 * @property {string} file - File path
 * @property {number} line - Line number
 * @property {number} [column] - Column number (optional)
 * @property {string} description - Human-readable description
 * @property {string} recommendation - Suggested fix
 * @property {string} codeSnippet - Relevant code context
 * @property {string[]} relatedFindings - IDs of related findings
 * @property {number} [priority] - Calculated priority score (set during prioritization)
 */

/**
 * Change - Represents a modification applied by the Cleanup Executor
 * @typedef {Object} Change
 * @property {string} id - Unique identifier
 * @property {string[]} findingIds - Findings addressed by this change
 * @property {string} file - File modified
 * @property {'removal'|'refactor'|'addition'|'style'} type - Type of change
 * @property {string} beforeSnippet - Code before change
 * @property {string} afterSnippet - Code after change
 * @property {string} rationale - Explanation of why change was made
 * @property {boolean} testsPassedBefore - Whether tests passed before change
 * @property {boolean} testsPassedAfter - Whether tests passed after change
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {boolean} reverted - True if change was rolled back
 */

/**
 * AnalysisReport - Aggregates all findings with metadata
 * @typedef {Object} AnalysisReport
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {string[]} filesAnalyzed - List of analyzed files
 * @property {Finding[]} findings - All findings
 * @property {AnalysisReportSummary} summary - Summary statistics
 */

/**
 * AnalysisReportSummary - Summary statistics for an analysis report
 * @typedef {Object} AnalysisReportSummary
 * @property {number} total - Total number of findings
 * @property {Record<string, number>} byCategory - Count by category
 * @property {Record<string, number>} bySeverity - Count by severity
 * @property {Record<string, number>} byEffort - Count by effort
 * @property {number} quickWins - Count of quick-win findings
 */

/**
 * Create a new Finding object
 * @param {Partial<Finding>} params - Finding parameters
 * @returns {Finding}
 */
export function createFinding(params) {
  const id = params.id || generateId('finding');
  
  return {
    id,
    category: params.category,
    subcategory: params.subcategory,
    severity: params.severity,
    effort: params.effort,
    impact: params.impact || 50,
    file: params.file,
    line: params.line,
    column: params.column,
    description: params.description,
    recommendation: params.recommendation,
    codeSnippet: params.codeSnippet || '',
    relatedFindings: params.relatedFindings || [],
    priority: params.priority
  };
}

/**
 * Create a new Change object
 * @param {Partial<Change>} params - Change parameters
 * @returns {Change}
 */
export function createChange(params) {
  const id = params.id || generateId('change');
  
  return {
    id,
    findingIds: params.findingIds || [],
    file: params.file,
    type: params.type,
    beforeSnippet: params.beforeSnippet || '',
    afterSnippet: params.afterSnippet || '',
    rationale: params.rationale,
    testsPassedBefore: params.testsPassedBefore !== false,
    testsPassedAfter: params.testsPassedAfter !== false,
    timestamp: params.timestamp || new Date().toISOString(),
    reverted: params.reverted || false
  };
}

/**
 * Create a new AnalysisReport object
 * @param {Partial<AnalysisReport>} params - Report parameters
 * @returns {AnalysisReport}
 */
export function createAnalysisReport(params) {
  const findings = params.findings || [];
  
  // Calculate summary statistics
  const summary = {
    total: findings.length,
    byCategory: {},
    bySeverity: {},
    byEffort: {},
    quickWins: 0
  };
  
  findings.forEach(finding => {
    // Count by category
    summary.byCategory[finding.category] = (summary.byCategory[finding.category] || 0) + 1;
    
    // Count by severity
    summary.bySeverity[finding.severity] = (summary.bySeverity[finding.severity] || 0) + 1;
    
    // Count by effort
    summary.byEffort[finding.effort] = (summary.byEffort[finding.effort] || 0) + 1;
    
    // Count quick wins
    if (finding.effort === 'quick-win') {
      summary.quickWins++;
    }
  });
  
  return {
    timestamp: params.timestamp || new Date().toISOString(),
    filesAnalyzed: params.filesAnalyzed || [],
    findings,
    summary
  };
}

/**
 * Generate a unique ID with a prefix
 * @param {string} prefix - ID prefix
 * @returns {string}
 */
function generateId(prefix) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}
