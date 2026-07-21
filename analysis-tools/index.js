/**
 * Main entry point for the analysis tools
 * Re-exports all core functionality
 */

// Data models
export {
  createFinding,
  createChange,
  createAnalysisReport
} from './models.js';

// Parser utilities
export {
  parseCode,
  parseFile,
  traverse,
  extractFunctions,
  extractVariables,
  extractCalls,
  extractIdentifiers,
  getNestingDepth,
  countFunctionLines,
  extractSnippet,
  normalizeCode
} from './parser.js';

// Report generation utilities
export {
  generateAnalysisReport,
  formatReportAsText,
  formatReportAsJSON,
  formatReportAsMarkdown,
  generateChangeReport,
  formatChangeReportAsText,
  calculatePriority,
  prioritizeFindings,
  groupByCategory
} from './report-generator.js';
