/**
 * Change Tracker Integration Example
 * Demonstrates how to use the change tracking system with cleanup operations
 */

import {
  initializeChangeTracker,
  recordChange,
  recordChanges,
  revertChange,
  getImpactAnalysis,
  generateChangeReport,
  exportChanges,
  getChangeStatistics,
  getAllChanges
} from './change-tracker.js';
import { removeDeadCode } from './code-remover.js';
import { createFinding } from '../models.js';

/**
 * Example 1: Track a single code removal
 */
async function example1_trackSingleRemoval() {
  console.log('\n=== Example 1: Track Single Code Removal ===\n');
  
  // Initialize tracker
  initializeChangeTracker();
  
  // Create a finding
  const finding = createFinding({
    category: 'dead-code',
    subcategory: 'unused-function',
    severity: 'moderate',
    effort: 'quick-win',
    impact: 75,
    file: 'app.js',
    line: 42,
    column: 0,
    description: 'Unused function "calculateOldMetric"',
    recommendation: 'Remove unused function',
    codeSnippet: 'function calculateOldMetric() { return 0; }'
  });
  
  console.log('Finding:', finding.description);
  console.log('File:', finding.file);
  console.log('Line:', finding.line);
  
  // In real usage, removeDeadCode already creates a change record
  // This is just to demonstrate the API
  const change = recordChange({
    findingIds: [finding.id],
    file: finding.file,
    type: 'removal',
    beforeSnippet: finding.codeSnippet,
    afterSnippet: '',
    rationale: `Removed ${finding.description}. This function was never called in the codebase.`,
    testsPassedBefore: true,
    testsPassedAfter: true
  });
  
  console.log('\nChange recorded:', change.id);
  console.log('Timestamp:', change.timestamp);
  console.log('Tests passed:', change.testsPassedAfter);
}

/**
 * Example 2: Track batch cleanup operations
 */
async function example2_trackBatchCleanup() {
  console.log('\n=== Example 2: Track Batch Cleanup Operations ===\n');
  
  // Simulate multiple cleanup operations
  const changes = recordChanges([
    {
      findingIds: ['finding-1'],
      file: 'app.js',
      type: 'removal',
      beforeSnippet: 'function unused1() {}',
      afterSnippet: '',
      rationale: 'Removed unused function unused1',
      testsPassedAfter: true
    },
    {
      findingIds: ['finding-2'],
      file: 'app.js',
      type: 'removal',
      beforeSnippet: 'const unusedVar = 123;',
      afterSnippet: '',
      rationale: 'Removed unused variable unusedVar',
      testsPassedAfter: true
    },
    {
      findingIds: ['finding-3'],
      file: 'server.js',
      type: 'refactor',
      beforeSnippet: 'if (x) { if (y) { if (z) { ... } } }',
      afterSnippet: 'if (!x) return;\nif (!y) return;\nif (!z) return;',
      rationale: 'Reduced nesting using guard clauses',
      testsPassedAfter: true
    },
    {
      findingIds: ['finding-4'],
      file: 'styles.css',
      type: 'style',
      beforeSnippet: 'margin: 15px;',
      afterSnippet: 'margin: 16px;',
      rationale: 'Standardized spacing to 4px scale',
      testsPassedAfter: true
    }
  ]);
  
  console.log(`Recorded ${changes.length} changes`);
  changes.forEach((change, i) => {
    console.log(`  ${i + 1}. ${change.type} in ${change.file}`);
  });
}

/**
 * Example 3: Handle test failures and reverts
 */
async function example3_handleTestFailures() {
  console.log('\n=== Example 3: Handle Test Failures and Reverts ===\n');
  
  // Record a change that will fail tests
  const change = recordChange({
    findingIds: ['finding-5'],
    file: 'server.js',
    type: 'refactor',
    beforeSnippet: 'function important() { return result; }',
    afterSnippet: 'function important() { return newResult; }',
    rationale: 'Attempted to refactor function',
    testsPassedBefore: true,
    testsPassedAfter: false
  });
  
  console.log('Change recorded:', change.id);
  console.log('Tests passed after:', change.testsPassedAfter);
  
  // Tests failed, so we revert
  const reverted = revertChange(
    change.id,
    'Tests failed: 3 unit tests broke after refactoring. Need to investigate dependencies.'
  );
  
  console.log('\nChange reverted:', reverted.id);
  console.log('Revert reason:', reverted.revertReason);
  console.log('Reverted at:', reverted.revertedAt);
}

/**
 * Example 4: Generate impact analysis
 */
async function example4_impactAnalysis() {
  console.log('\n=== Example 4: Impact Analysis ===\n');
  
  const impact = getImpactAnalysis();
  
  console.log('Summary:');
  console.log(`  Total changes: ${impact.summary.totalChanges}`);
  console.log(`  Files affected: ${impact.summary.filesAffected}`);
  console.log(`  Test success rate: ${impact.summary.testSuccessRate}`);
  console.log(`  Revert rate: ${impact.summary.revertRate}`);
  
  console.log('\nChanges by type:');
  console.log(`  Removals: ${impact.byType.removal}`);
  console.log(`  Refactors: ${impact.byType.refactor}`);
  console.log(`  Additions: ${impact.byType.addition}`);
  console.log(`  Style: ${impact.byType.style}`);
  
  console.log('\nFiles affected:');
  impact.filesAffected.forEach(file => {
    const fileData = impact.byFile[file];
    console.log(`  ${file}: ${fileData.changeCount} changes`);
  });
}

/**
 * Example 5: Generate and export reports
 */
async function example5_generateReports() {
  console.log('\n=== Example 5: Generate and Export Reports ===\n');
  
  // Generate markdown report
  const markdownReport = generateChangeReport({
    format: 'markdown',
    includeSnippets: true,
    includeReverted: true
  });
  
  console.log('Markdown report preview:');
  console.log(markdownReport.substring(0, 500) + '...\n');
  
  // Export to file
  const exportResult = exportChanges(
    './analysis-tools/reports/change-tracking-report.md',
    {
      format: 'markdown',
      includeSnippets: true,
      includeReverted: true
    }
  );
  
  if (exportResult.success) {
    console.log('Report exported to:', exportResult.outputPath);
  }
  
  // Generate JSON for programmatic access
  const jsonReport = generateChangeReport({
    format: 'json',
    includeSnippets: false
  });
  
  console.log('\nJSON report summary:');
  console.log(`  Total changes in report: ${jsonReport.changes.length}`);
  console.log(`  Impact analysis included: ${jsonReport.impact ? 'Yes' : 'No'}`);
}

/**
 * Example 6: Query and filter changes
 */
async function example6_queryChanges() {
  console.log('\n=== Example 6: Query and Filter Changes ===\n');
  
  const stats = getChangeStatistics();
  
  console.log('Statistics:');
  console.log(`  Total changes: ${stats.totalChanges}`);
  console.log(`  Active changes: ${stats.activeChanges}`);
  console.log(`  Reverted changes: ${stats.revertedChanges}`);
  console.log(`  Unique findings addressed: ${stats.uniqueFindingsAddressed}`);
  console.log(`  Average changes per file: ${stats.averageChangesPerFile}`);
  
  if (stats.timeRange.earliest) {
    console.log(`  Time range: ${stats.timeRange.earliest} to ${stats.timeRange.latest}`);
  }
  
  // Get all active changes
  const activeChanges = getAllChanges({ includeReverted: false });
  console.log(`\nActive changes: ${activeChanges.length}`);
}

/**
 * Example 7: Real-world workflow simulation
 */
async function example7_workflowSimulation() {
  console.log('\n=== Example 7: Real-World Workflow Simulation ===\n');
  
  console.log('Phase 1: Dead code removal...');
  const deadCodeChanges = recordChanges([
    {
      findingIds: ['dc-1', 'dc-2'],
      file: 'app.js',
      type: 'removal',
      rationale: 'Removed 2 unused functions',
      testsPassedAfter: true
    },
    {
      findingIds: ['dc-3'],
      file: 'server.js',
      type: 'removal',
      rationale: 'Removed unused variable',
      testsPassedAfter: true
    }
  ]);
  console.log(`  ✓ ${deadCodeChanges.length} dead code changes applied`);
  
  console.log('\nPhase 2: Code optimization...');
  const optimizationChanges = recordChanges([
    {
      findingIds: ['opt-1'],
      file: 'app.js',
      type: 'refactor',
      rationale: 'Extracted duplicate code into helper function',
      testsPassedAfter: true
    },
    {
      findingIds: ['opt-2'],
      file: 'server.js',
      type: 'refactor',
      rationale: 'Reduced nesting depth from 4 to 2',
      testsPassedAfter: true
    }
  ]);
  console.log(`  ✓ ${optimizationChanges.length} optimization changes applied`);
  
  console.log('\nPhase 3: Style standardization...');
  const styleChanges = recordChanges([
    {
      findingIds: ['style-1', 'style-2', 'style-3'],
      file: 'styles.css',
      type: 'style',
      rationale: 'Standardized spacing to 4px scale',
      testsPassedAfter: true
    }
  ]);
  console.log(`  ✓ ${styleChanges.length} style changes applied`);
  
  console.log('\nPhase 4: Test failure simulation...');
  const failedChange = recordChange({
    findingIds: ['fail-1'],
    file: 'app.js',
    type: 'refactor',
    rationale: 'Attempted complex refactoring',
    testsPassedAfter: false
  });
  console.log(`  ✗ Change failed tests: ${failedChange.id}`);
  
  revertChange(failedChange.id, 'Test suite failed with 5 broken tests');
  console.log('  ↺ Change reverted');
  
  console.log('\nFinal Results:');
  const impact = getImpactAnalysis();
  console.log(`  Total successful changes: ${impact.summary.totalChanges}`);
  console.log(`  Test success rate: ${impact.summary.testSuccessRate}`);
  console.log(`  Revert rate: ${impact.summary.revertRate}`);
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        Change Tracker Integration Examples                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  try {
    await example1_trackSingleRemoval();
    await example2_trackBatchCleanup();
    await example3_handleTestFailures();
    await example4_impactAnalysis();
    await example5_generateReports();
    await example6_queryChanges();
    await example7_workflowSimulation();
    
    console.log('\n✓ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Error running examples:', error.message);
    console.error(error.stack);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  example1_trackSingleRemoval,
  example2_trackBatchCleanup,
  example3_handleTestFailures,
  example4_impactAnalysis,
  example5_generateReports,
  example6_queryChanges,
  example7_workflowSimulation,
  runAllExamples
};
