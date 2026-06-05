#!/usr/bin/env node

/**
 * CLI Runner for Orchestration Workflow
 * 
 * Usage:
 *   node run-orchestration.js                    # Run complete workflow
 *   node run-orchestration.js --analysis-only    # Run analysis phase only
 *   node run-orchestration.js --help             # Show help
 */

import { runCompleteWorkflow, runAnalysisPhase, DEFAULT_CONFIG, saveReport } from './orchestrator.js';
import { formatReportAsMarkdown } from './report-generator.js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
Codebase Cleanup Orchestration Workflow

USAGE:
  node run-orchestration.js [OPTIONS]

OPTIONS:
  --analysis-only       Run only the analysis phase (no cleanup execution)
  --help, -h            Show this help message

EXAMPLES:
  node run-orchestration.js                    # Run complete workflow
  node run-orchestration.js --analysis-only    # Analyze only

The workflow performs:
  1. Analysis Phase   - Runs all analyzers to identify issues
  2. Execution Phase  - Applies fixes prioritizing quick-wins
  3. Verification     - Runs tests after each category
  4. Reporting        - Generates comprehensive reports

Reports are saved to: ${DEFAULT_CONFIG.reportDir}
`);
}

async function main() {
  // Parse command line arguments
  const analysisOnly = args.includes('--analysis-only');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    showHelp();
    process.exit(0);
  }

  try {
    if (analysisOnly) {
      console.log('Running analysis phase only...\n');
      const report = await runAnalysisPhase(DEFAULT_CONFIG);
      
      // Save JSON report
      const jsonPath = saveReport(report, `analysis-report-${Date.now()}.json`, DEFAULT_CONFIG);
      
      // Save Markdown report
      const markdown = formatReportAsMarkdown(report);
      const mdPath = path.join(DEFAULT_CONFIG.reportDir, `analysis-report-${Date.now()}.md`);
      fs.writeFileSync(mdPath, markdown, 'utf-8');
      console.log(`Markdown report saved to: ${mdPath}`);
      
      console.log('\n✅ Analysis complete!');
      console.log(`   Total findings: ${report.findings.length}`);
      console.log(`   Quick wins: ${report.summary.quickWins}`);
      
    } else {
      // Run complete workflow
      await runCompleteWorkflow(DEFAULT_CONFIG);
      console.log('\n✅ Workflow complete!');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
