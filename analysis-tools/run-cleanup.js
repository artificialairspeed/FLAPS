#!/usr/bin/env node
/**
 * CLI entry point for running the complete cleanup workflow
 * Task 18: Execute full cleanup workflow
 * 
 * Usage: node analysis-tools/run-cleanup.js
 */

import { runCompleteWorkflow } from './orchestrator.js';

// Run the workflow
runCompleteWorkflow()
  .then((report) => {
    console.log('\n✅ Cleanup workflow completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Cleanup workflow failed:', error.message);
    process.exit(1);
  });
