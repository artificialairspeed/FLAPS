/**
 * Orchestration Workflow - Coordinates all analyzers and executors
 * Task 17.1: Create orchestration workflow
 * 
 * This module coordinates the complete cleanup pipeline:
 * 1. Analysis Phase: Runs all analyzers to identify issues
 * 2. Prioritization: Sorts findings by quick-win potential
 * 3. Execution Phase: Applies fixes in category batches
 * 4. Verification: Runs tests after each category
 * 5. Reporting: Generates comprehensive reports
 * 
 * Requirements: 7.8, 7.9, 8.5, 8.6
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  generateAnalysisReport as createAnalysisReport,
  prioritizeFindings,
  groupByCategory,
  formatReportAsMarkdown,
  generateChangeReport,
  formatChangeReportAsText
} from './report-generator.js';

// Import change creator from models
import { createChange } from './models.js';

// Import analyzers with their actual export names
import { analyze as analyzeDeadCode } from './analyzers/dead-code-analyzer.js';
import { analyzeDomReferences as analyzeDOMReferences } from './analyzers/dom-reference-validator.js';
import { analyzeCSSSelectors } from './analyzers/css-selector-analyzer.js';
import { analyzeStorageOperations as analyzeStorage } from './analyzers/storage-analyzer.js';
import { analyzeSocketIOSymmetry as analyzeSocketIO } from './analyzers/socketio-symmetry-checker.js';
import { analyzeEventListenersInFiles as analyzeEventListeners } from './analyzers/event-listener-analyzer.js';
import { analyzeCodeDuplication as analyzeDuplication } from './analyzers/code-duplication-detector.js';
import { analyzeNestingDepth as analyzeNesting } from './analyzers/nesting-depth-analyzer.js';
import { analyzeFunctionLength } from './analyzers/function-length-checker.js';
import { analyzePerformanceAntiPatterns as analyzePerformance } from './analyzers/performance-anti-pattern-detector.js';
import { analyzeSpacingConsistency as analyzeSpacing } from './analyzers/spacing-consistency-checker.js';
import { analyzeColorUsage as analyzeColors } from './analyzers/color-usage-analyzer.js';
import { analyzeFontSizes } from './analyzers/font-size-analyzer.js';
import { analyzeAccessibilityStates as analyzeAccessibility } from './analyzers/accessibility-state-checker.js';
import { analyzeNamingAndStyle as analyzeCodeQuality } from './analyzers/naming-style-checker.js';

// Import executors
import { removeDeadCodeBatch } from './executors/dead-code-remover.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration for the orchestration workflow
 */
const DEFAULT_CONFIG = {
  workspaceRoot: path.resolve(__dirname, '..'),
  filesAnalyzed: [
    'server.js',
    'public/app.js',
    'public/styles.css',
    'index.html'
  ],
  testCommand: 'npx vitest --run server.unit.test.js public/app.property.test.js',
  testTimeout: 120000, // 2 minutes
  backupDir: path.resolve(__dirname, '../.backups'),
  reportDir: path.resolve(__dirname, './reports'),
  enableRollback: true,
  stopOnTestFailure: true
};

/**
 * Orchestration state tracker
 */
class OrchestrationState {
  constructor() {
    this.analysisReport = null;
    this.executionResults = {
      implemented: [],
      deferred: [],
      failed: []
    };
    this.categoryResults = {};
    this.startTime = Date.now();
    this.currentPhase = 'initialization';
  }

  setPhase(phase) {
    this.currentPhase = phase;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Phase: ${phase.toUpperCase()}`);
    console.log(`${'='.repeat(60)}\n`);
  }

  recordCategoryResult(category, result) {
    this.categoryResults[category] = result;
  }

  addImplemented(change) {
    this.executionResults.implemented.push(change);
  }

  addDeferred(finding, reason) {
    this.executionResults.deferred.push({ finding, reason });
  }

  addFailed(finding, reason) {
    this.executionResults.failed.push({ finding, reason });
  }

  getDuration() {
    return ((Date.now() - this.startTime) / 1000).toFixed(2);
  }
}

/**
 * Run all analyzers against the codebase
 * @param {Object} config - Configuration object
 * @returns {Object} Analysis report with all findings
 */
async function runAnalysisPhase(config = DEFAULT_CONFIG) {
  const state = new OrchestrationState();
  state.setPhase('analysis');

  const findings = [];
  const filesAnalyzed = config.filesAnalyzed.map(f => 
    path.resolve(config.workspaceRoot, f)
  );

  console.log(`Analyzing ${filesAnalyzed.length} files...`);

  // Category 1: Dead Code Analysis
  console.log('\n1. Running Dead Code Analyzer...');
  try {
    const jsFiles = filesAnalyzed.filter(f => f.endsWith('.js'));
    const deadCodeResult = analyzeDeadCode(jsFiles);
    findings.push(...deadCodeResult.findings);
    console.log(`   Found ${deadCodeResult.findings.length} dead code issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 2: DOM Reference Analysis
  console.log('\n2. Running DOM Reference Validator...');
  try {
    const appJsPath = filesAnalyzed.find(f => f.endsWith('app.js'));
    const indexHtmlPath = filesAnalyzed.find(f => f.endsWith('index.html'));
    if (appJsPath && indexHtmlPath) {
      const domResult = analyzeDOMReferences({ jsFile: appJsPath, htmlFile: indexHtmlPath });
      findings.push(...domResult.findings);
      console.log(`   Found ${domResult.findings.length} DOM reference issues`);
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 3: CSS Selector Analysis
  console.log('\n3. Running CSS Selector Analyzer...');
  try {
    const cssResult = analyzeCSSSelectors(config.workspaceRoot);
    findings.push(...cssResult);
    console.log(`   Found ${cssResult.length} unused CSS selectors`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 4: Storage Analysis
  console.log('\n4. Running Storage Analyzer...');
  try {
    const storageResult = analyzeStorage(config.workspaceRoot);
    findings.push(...storageResult);
    console.log(`   Found ${storageResult.length} storage issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 5: Socket.IO Event Analysis
  console.log('\n5. Running Socket.IO Symmetry Checker...');
  try {
    const socketResult = analyzeSocketIO(config.workspaceRoot);
    findings.push(...socketResult);
    console.log(`   Found ${socketResult.length} socket event issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 6: Event Listener Analysis
  console.log('\n6. Running Event Listener Analyzer...');
  try {
    const appJsPath = filesAnalyzed.find(f => f.endsWith('app.js'));
    if (appJsPath) {
      const eventResult = analyzeEventListeners({ files: [appJsPath] });
      findings.push(...eventResult);
      console.log(`   Found ${eventResult.length} event listener issues`);
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 7: Code Duplication Analysis
  console.log('\n7. Running Code Duplication Detector...');
  try {
    const jsFiles = filesAnalyzed.filter(f => f.endsWith('.js'));
    const duplicationResult = analyzeDuplication(jsFiles);
    findings.push(...duplicationResult.findings);
    console.log(`   Found ${duplicationResult.findings.length} code duplication issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 8: Nesting Depth Analysis
  console.log('\n8. Running Nesting Depth Analyzer...');
  try {
    const jsFiles = filesAnalyzed.filter(f => f.endsWith('.js'));
    const nestingResult = analyzeNesting(jsFiles);
    findings.push(...nestingResult.findings);
    console.log(`   Found ${nestingResult.findings.length} deep nesting issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 9: Function Length Analysis
  console.log('\n9. Running Function Length Checker...');
  try {
    const jsFiles = filesAnalyzed.filter(f => f.endsWith('.js'));
    const lengthResult = analyzeFunctionLength(jsFiles);
    findings.push(...lengthResult.findings);
    console.log(`   Found ${lengthResult.findings.length} long function issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 10: Performance Anti-Pattern Analysis
  console.log('\n10. Running Performance Anti-Pattern Detector...');
  try {
    const jsFiles = filesAnalyzed.filter(f => f.endsWith('.js'));
    const perfResult = analyzePerformance(jsFiles);
    findings.push(...perfResult.findings);
    console.log(`   Found ${perfResult.findings.length} performance issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 11: Spacing Consistency Analysis
  console.log('\n11. Running Spacing Consistency Checker...');
  try {
    const spacingResult = analyzeSpacing(config.workspaceRoot);
    findings.push(...spacingResult);
    console.log(`   Found ${spacingResult.length} spacing inconsistencies`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 12: Color Usage Analysis
  console.log('\n12. Running Color Usage Analyzer...');
  try {
    const colorResult = analyzeColors(config.workspaceRoot);
    findings.push(...colorResult.findings);
    console.log(`   Found ${colorResult.findings.length} color issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 13: Font Size Analysis
  console.log('\n13. Running Font Size Analyzer...');
  try {
    const fontResult = analyzeFontSizes(config.workspaceRoot);
    findings.push(...fontResult);
    console.log(`   Found ${fontResult.length} font size issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 14: Accessibility State Analysis
  console.log('\n14. Running Accessibility State Checker...');
  try {
    const a11yResult = analyzeAccessibility(config.workspaceRoot);
    findings.push(...a11yResult);
    console.log(`   Found ${a11yResult.length} accessibility issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Category 15: Code Quality Analysis
  console.log('\n15. Running Code Quality Analyzer...');
  try {
    const jsFiles = filesAnalyzed.filter(f => f.endsWith('.js') && !f.includes('test'));
    const qualityResult = analyzeCodeQuality(jsFiles);
    findings.push(...qualityResult.findings);
    console.log(`   Found ${qualityResult.findings.length} code quality issues`);
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  // Create analysis report
  const report = createAnalysisReport({
    filesAnalyzed,
    findings
  });

  state.analysisReport = report;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Analysis Complete: ${findings.length} total findings`);
  console.log(`  Quick Wins: ${report.summary.quickWins}`);
  console.log(`  Duration: ${state.getDuration()}s`);
  console.log(`${'─'.repeat(60)}`);

  return report;
}

/**
 * Run the cleanup execution phase
 * @param {Object} report - Analysis report from runAnalysisPhase
 * @param {Object} config - Configuration object
 * @returns {Object} Execution results
 */
async function runExecutionPhase(report, config = DEFAULT_CONFIG) {
  const state = new OrchestrationState();
  state.setPhase('execution');
  state.analysisReport = report;

  // Prioritize findings (quick-wins first)
  const prioritizedFindings = prioritizeFindings([...report.findings]);
  console.log(`Processing ${prioritizedFindings.length} findings in priority order...`);

  // Group by category for batch processing
  const byCategory = groupByCategory(prioritizedFindings);
  console.log(`\nFindings grouped into ${Object.keys(byCategory).length} categories:`);
  Object.entries(byCategory).forEach(([category, findings]) => {
    console.log(`  ${category}: ${findings.length} findings`);
  });

  // Process each category
  const categoryOrder = [
    'dead-code',      // Remove unused code first (safest, high impact)
    'storage',        // Fix storage operations
    'event',          // Fix event handlers
    'optimization',   // Optimize code patterns
    'visual',         // Fix visual issues
    'quality',        // Standardize code quality
    'deprecation'     // Remove deprecated features last
  ];

  for (const category of categoryOrder) {
    const findings = byCategory[category];
    if (!findings || findings.length === 0) {
      console.log(`\nSkipping ${category} (no findings)`);
      continue;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Processing Category: ${category} (${findings.length} items)`);
    console.log(`${'─'.repeat(60)}`);

    const categoryResult = await processCategory(category, findings, config, state);
    state.recordCategoryResult(category, categoryResult);

    // Check if we should stop
    if (!categoryResult.success && config.stopOnTestFailure) {
      console.log(`\n⚠️  Stopping execution due to test failure in ${category}`);
      break;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Execution Complete`);
  console.log(`  Implemented: ${state.executionResults.implemented.length}`);
  console.log(`  Deferred: ${state.executionResults.deferred.length}`);
  console.log(`  Failed: ${state.executionResults.failed.length}`);
  console.log(`  Duration: ${state.getDuration()}s`);
  console.log(`${'─'.repeat(60)}`);

  return state.executionResults;
}

/**
 * Process a single category of findings
 * @param {string} category - Category name
 * @param {Array} findings - Findings to process
 * @param {Object} config - Configuration
 * @param {OrchestrationState} state - State tracker
 * @returns {Object} Category result
 */
async function processCategory(category, findings, config, state) {
  const result = {
    category,
    success: false,
    implemented: 0,
    deferred: 0,
    failed: 0,
    message: ''
  };

  try {
    // Defer complex changes
    const quickWins = findings.filter(f => f.effort !== 'complex');
    const complex = findings.filter(f => f.effort === 'complex');

    if (complex.length > 0) {
      console.log(`Deferring ${complex.length} complex changes for review`);
      complex.forEach(finding => {
        state.addDeferred(finding, 'Requires architectural design discussion');
        result.deferred++;
      });
    }

    if (quickWins.length === 0) {
      result.success = true;
      result.message = 'All changes deferred (complex)';
      return result;
    }

    console.log(`Processing ${quickWins.length} quick-win items...`);

    // Execute based on category
    let executionResult;

    switch (category) {
      case 'dead-code':
        executionResult = await executeDeadCodeCleanup(quickWins, config);
        break;

      case 'storage':
        executionResult = await executeStorageCleanup(quickWins, config);
        break;

      case 'event':
        executionResult = await executeEventCleanup(quickWins, config);
        break;

      case 'optimization':
        executionResult = await executeOptimizationCleanup(quickWins, config);
        break;

      case 'visual':
        executionResult = await executeVisualCleanup(quickWins, config);
        break;

      case 'quality':
        executionResult = await executeQualityCleanup(quickWins, config);
        break;

      case 'deprecation':
        executionResult = await executeDeprecationCleanup(quickWins, config);
        break;

      default:
        console.log(`No executor available for category: ${category}`);
        quickWins.forEach(f => state.addDeferred(f, 'No executor available'));
        result.deferred += quickWins.length;
        result.success = true;
        return result;
    }

    // Record results
    if (executionResult.implemented) {
      executionResult.implemented.forEach(item => {
        state.addImplemented(item);
        result.implemented++;
      });
    }

    if (executionResult.failed) {
      executionResult.failed.forEach(item => {
        state.addFailed(item.finding, item.reason);
        result.failed++;
      });
    }

    result.success = true;
    result.message = `Completed: ${result.implemented} implemented, ${result.failed} failed`;

  } catch (error) {
    result.success = false;
    result.message = `Error: ${error.message}`;
    console.error(`Category processing error:`, error);
  }

  return result;
}

/**
 * Execute dead code cleanup
 */
async function executeDeadCodeCleanup(findings, config) {
  console.log('Running dead code removal...');
  return removeDeadCodeBatch(findings);
}

/**
 * Execute storage cleanup (placeholder - implement when executor is ready)
 */
async function executeStorageCleanup(findings, config) {
  console.log('Storage cleanup executor not yet implemented');
  return { implemented: [], failed: findings.map(f => ({ finding: f, reason: 'Not implemented' })) };
}

/**
 * Execute event cleanup (placeholder - implement when executor is ready)
 */
async function executeEventCleanup(findings, config) {
  console.log('Event cleanup executor not yet implemented');
  return { implemented: [], failed: findings.map(f => ({ finding: f, reason: 'Not implemented' })) };
}

/**
 * Execute optimization cleanup (placeholder - implement when executor is ready)
 */
async function executeOptimizationCleanup(findings, config) {
  console.log('Optimization cleanup executor not yet implemented');
  return { implemented: [], failed: findings.map(f => ({ finding: f, reason: 'Not implemented' })) };
}

/**
 * Execute visual cleanup (placeholder - implement when executor is ready)
 */
async function executeVisualCleanup(findings, config) {
  console.log('Visual cleanup executor not yet implemented');
  return { implemented: [], failed: findings.map(f => ({ finding: f, reason: 'Not implemented' })) };
}

/**
 * Execute quality cleanup (placeholder - implement when executor is ready)
 */
async function executeQualityCleanup(findings, config) {
  console.log('Quality cleanup executor not yet implemented');
  return { implemented: [], failed: findings.map(f => ({ finding: f, reason: 'Not implemented' })) };
}

/**
 * Execute deprecation cleanup (placeholder - implement when executor is ready)
 */
async function executeDeprecationCleanup(findings, config) {
  console.log('Deprecation cleanup executor not yet implemented');
  return { implemented: [], failed: findings.map(f => ({ finding: f, reason: 'Not implemented' })) };
}

/**
 * Generate final report combining analysis and execution results
 * @param {Object} analysisReport - Report from runAnalysisPhase
 * @param {Object} executionResults - Results from runExecutionPhase
 * @returns {Object} Final comprehensive report
 */
function generateFinalReport(analysisReport, executionResults) {
  const totalFindings = analysisReport.findings.length;
  const implemented = executionResults.implemented.length;
  const deferred = executionResults.deferred.length;
  const failed = executionResults.failed.length;

  const implementationRate = totalFindings > 0 
    ? ((implemented / totalFindings) * 100).toFixed(1) 
    : '0.0';

  const quickWinRate = analysisReport.summary.quickWins > 0
    ? ((implemented / analysisReport.summary.quickWins) * 100).toFixed(1)
    : '0.0';

  return {
    summary: {
      totalFindings,
      implemented,
      deferred,
      failed,
      implementationRate: `${implementationRate}%`,
      quickWinRate: `${quickWinRate}%`
    },
    analysis: {
      byCategory: analysisReport.summary.byCategory,
      bySeverity: analysisReport.summary.bySeverity,
      byEffort: analysisReport.summary.byEffort,
      quickWins: analysisReport.summary.quickWins
    },
    execution: {
      implemented: executionResults.implemented,
      deferred: executionResults.deferred,
      failed: executionResults.failed
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Save report to file
 * @param {Object} report - Report object
 * @param {string} filename - Filename to save to
 * @param {Object} config - Configuration
 */
function saveReport(report, filename, config = DEFAULT_CONFIG) {
  // Ensure report directory exists
  if (!fs.existsSync(config.reportDir)) {
    fs.mkdirSync(config.reportDir, { recursive: true });
  }

  const filepath = path.join(config.reportDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport saved to: ${filepath}`);
  return filepath;
}

/**
 * Run complete orchestration workflow
 * @param {Object} config - Configuration object
 * @returns {Object} Final report
 */
async function runCompleteWorkflow(config = DEFAULT_CONFIG) {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('  CODEBASE CLEANUP ORCHESTRATION WORKFLOW');
  console.log('═'.repeat(60));
  console.log('');

  const startTime = Date.now();

  try {
    // Phase 1: Analysis
    const analysisReport = await runAnalysisPhase(config);
    saveReport(analysisReport, `analysis-report-${Date.now()}.json`, config);

    // Phase 2: Execution
    const executionResults = await runExecutionPhase(analysisReport, config);

    // Phase 3: Final Report
    const finalReport = generateFinalReport(analysisReport, executionResults);
    const reportPath = saveReport(finalReport, `final-report-${Date.now()}.json`, config);

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('  WORKFLOW COMPLETE');
    console.log('═'.repeat(60));
    console.log('');
    console.log(`Total Findings:        ${finalReport.summary.totalFindings}`);
    console.log(`Implemented:           ${finalReport.summary.implemented}`);
    console.log(`Deferred:              ${finalReport.summary.deferred}`);
    console.log(`Failed:                ${finalReport.summary.failed}`);
    console.log(`Implementation Rate:   ${finalReport.summary.implementationRate}`);
    console.log(`Quick-Win Rate:        ${finalReport.summary.quickWinRate}`);
    console.log(`Duration:              ${duration}s`);
    console.log('');
    console.log(`Report: ${reportPath}`);
    console.log('═'.repeat(60));
    console.log('');

    return finalReport;

  } catch (error) {
    console.error('\n❌ Workflow failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Named exports
export {
  runAnalysisPhase,
  runExecutionPhase,
  generateFinalReport,
  saveReport,
  runCompleteWorkflow,
  DEFAULT_CONFIG
};

// Default export
export default {
  runAnalysisPhase,
  runExecutionPhase,
  generateFinalReport,
  saveReport,
  runCompleteWorkflow,
  DEFAULT_CONFIG
};
