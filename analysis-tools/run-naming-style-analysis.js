/**
 * Runner script for Naming and Style Checker
 * Analyzes the FLAPS codebase for naming and style issues
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { analyzeNamingAndStyle, generateNamingStyleReport } from './analyzers/naming-style-checker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define files to analyze
const filesToAnalyze = [
  path.join(__dirname, '../public/app.js'),
  path.join(__dirname, '../server.js'),
  path.join(__dirname, '../public/app.property.test.js'),
  path.join(__dirname, '../public/app.session.test.js'),
  path.join(__dirname, '../public/app.bugfix.test.js'),
  path.join(__dirname, '../public/app.preservation.test.js'),
  path.join(__dirname, '../public/app.reconnection-failure.test.js'),
  path.join(__dirname, '../server.unit.test.js')
];

// Filter to only existing files
const existingFiles = filesToAnalyze.filter(file => fs.existsSync(file));

console.log('🔍 Running Naming and Style Analysis...\n');
console.log(`Analyzing ${existingFiles.length} files:\n`);
existingFiles.forEach(file => console.log(`  - ${path.relative(process.cwd(), file)}`));
console.log();

// Run analysis
const results = analyzeNamingAndStyle(existingFiles);

// Display summary
console.log('📊 Analysis Summary:\n');
console.log(`  Total Functions: ${results.statistics.totalFunctions}`);
console.log(`  Total Variables: ${results.statistics.totalVariables}`);
console.log(`  Naming Violations: ${results.statistics.namingViolations}`);
console.log(`  var Declarations: ${results.statistics.varDeclarations}`);
console.log(`  console.log Statements: ${results.statistics.consoleLogStatements}`);
console.log(`  Magic Numbers: ${results.statistics.magicNumbers}`);
console.log(`  TODO Comments: ${results.statistics.todoComments}`);
console.log(`  Quote Inconsistencies: ${results.statistics.quoteInconsistencies}`);
console.log(`  Total Issues Found: ${results.findings.length}\n`);

// Generate and save report
const report = generateNamingStyleReport(results);
const reportPath = path.join(__dirname, 'reports/naming-style-analysis.md');

// Ensure reports directory exists
const reportsDir = path.join(__dirname, 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

fs.writeFileSync(reportPath, report);
console.log(`📄 Full report saved to: ${path.relative(process.cwd(), reportPath)}\n`);

// Save JSON findings
const jsonPath = path.join(__dirname, 'reports/naming-style-findings.json');
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log(`💾 JSON findings saved to: ${path.relative(process.cwd(), jsonPath)}\n`);

// Display top findings by category
console.log('🎯 Top Findings by Category:\n');

const bySubcategory = {};
results.findings.forEach(finding => {
  if (!bySubcategory[finding.subcategory]) {
    bySubcategory[finding.subcategory] = [];
  }
  bySubcategory[finding.subcategory].push(finding);
});

const categoryTitles = {
  'function-naming': 'Function Naming Issues',
  'variable-naming': 'Variable Naming Issues',
  'class-naming': 'Class Naming Issues',
  'var-declaration': 'var Declarations',
  'console-log': 'console.log Statements',
  'magic-number': 'Magic Numbers',
  'todo-comment': 'TODO/FIXME Comments',
  'quote-inconsistency': 'Quote Inconsistencies'
};

Object.entries(bySubcategory).forEach(([subcategory, findings]) => {
  console.log(`\n${categoryTitles[subcategory] || subcategory}: ${findings.length} found`);
  
  // Show first 3 examples
  findings.slice(0, 3).forEach(finding => {
    const fileName = path.basename(finding.file);
    console.log(`  • ${fileName}:${finding.line} - ${finding.description}`);
  });
  
  if (findings.length > 3) {
    console.log(`  ... and ${findings.length - 3} more`);
  }
});

console.log('\n✅ Analysis complete!\n');

