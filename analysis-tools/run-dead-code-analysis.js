#!/usr/bin/env node
/**
 * Run dead code analysis on FLAPS codebase
 * Task 2.1: Create function and variable usage tracker
 */

import { analyze } from './analyzers/dead-code-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files to analyze
const filesToAnalyze = [
  path.resolve(__dirname, '../server.js'),
  path.resolve(__dirname, '../public/app.js')
];

console.log('='.repeat(80));
console.log('Dead Code Analysis - FLAPS Codebase');
console.log('='.repeat(80));
console.log();

console.log('Analyzing files:');
filesToAnalyze.forEach(file => {
  console.log(`  - ${path.relative(__dirname, file)}`);
});
console.log();

// Run analysis
try {
  const result = analyze(filesToAnalyze);
  
  console.log('Symbol Table Statistics:');
  console.log(`  Functions defined: ${result.symbolTable.functionsCount}`);
  console.log(`  Variables declared: ${result.symbolTable.variablesCount}`);
  console.log(`  Function calls found: ${result.symbolTable.functionCallsCount}`);
  console.log(`  Variable references found: ${result.symbolTable.variableReferencesCount}`);
  console.log();
  
  console.log('Dead Code Findings:');
  console.log(`  Total findings: ${result.findings.length}`);
  console.log();
  
  if (result.findings.length === 0) {
    console.log('✓ No dead code detected!');
  } else {
    // Group by subcategory
    const bySubcategory = {};
    result.findings.forEach(finding => {
      if (!bySubcategory[finding.subcategory]) {
        bySubcategory[finding.subcategory] = [];
      }
      bySubcategory[finding.subcategory].push(finding);
    });
    
    // Display findings by category
    for (const [subcategory, findings] of Object.entries(bySubcategory)) {
      console.log(`\n${subcategory.toUpperCase().replace('-', ' ')} (${findings.length} items):`);
      console.log('-'.repeat(80));
      
      findings.forEach((finding, index) => {
        const fileName = path.basename(finding.file);
        console.log(`\n${index + 1}. ${finding.description}`);
        console.log(`   File: ${fileName}:${finding.line}`);
        console.log(`   Severity: ${finding.severity} | Effort: ${finding.effort} | Impact: ${finding.impact}`);
        console.log(`   Recommendation: ${finding.recommendation}`);
        
        if (finding.codeSnippet) {
          console.log(`   Code snippet:`);
          finding.codeSnippet.split('\n').forEach(line => {
            console.log(`     ${line}`);
          });
        }
      });
    }
  }
  
  // Save report to JSON
  const reportPath = path.resolve(__dirname, 'reports/dead-code-findings.json');
  const reportData = {
    timestamp: new Date().toISOString(),
    filesAnalyzed: filesToAnalyze,
    symbolTable: result.symbolTable,
    findings: result.findings,
    summary: {
      total: result.findings.length,
      unusedFunctions: result.findings.filter(f => f.subcategory === 'unused-function').length,
      unusedVariables: result.findings.filter(f => f.subcategory === 'unused-variable').length
    }
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log();
  console.log('='.repeat(80));
  console.log(`Report saved to: ${path.relative(__dirname, reportPath)}`);
  console.log('='.repeat(80));
  
} catch (error) {
  console.error('Error during analysis:', error.message);
  console.error(error.stack);
  process.exit(1);
}
