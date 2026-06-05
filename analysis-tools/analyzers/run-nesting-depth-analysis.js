/**
 * Run nesting depth analysis on the FLAPS codebase
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  analyzeNestingDepth,
  generateNestingDepthReport,
  getNestingDepthStats
} from './nesting-depth-analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target files to analyze
const targetFiles = [
  path.join(__dirname, '../../server.js'),
  path.join(__dirname, '../../public/app.js')
];

console.log('Running Nesting Depth Analysis on FLAPS codebase...\n');

// Filter to only existing files
const filesToAnalyze = targetFiles.filter(file => {
  if (!fs.existsSync(file)) {
    console.warn(`Warning: File not found: ${file}`);
    return false;
  }
  return true;
});

if (filesToAnalyze.length === 0) {
  console.error('Error: No files to analyze');
  process.exit(1);
}

console.log('Analyzing files:');
filesToAnalyze.forEach(file => console.log(`  - ${path.basename(file)}`));
console.log('');

// Run the analysis
const results = analyzeNestingDepth(filesToAnalyze);

// Generate statistics
const stats = getNestingDepthStats(results);

console.log('=== Analysis Statistics ===');
console.log(`Total nested blocks: ${stats.total}`);
console.log(`Maximum nesting depth: ${stats.maxDepth}`);
console.log(`Average nesting depth: ${stats.avgDepth}`);
console.log(`Blocks exceeding 3 levels: ${stats.exceeding3}`);
console.log(`Blocks exceeding 5 levels: ${stats.exceeding5}`);
console.log('');

if (Object.keys(stats.byType).length > 0) {
  console.log('=== By Statement Type ===');
  Object.entries(stats.byType).forEach(([type, data]) => {
    console.log(`${type}: ${data.count} blocks, avg depth: ${data.avgDepth}`);
  });
  console.log('');
}

console.log(`=== Findings ===`);
console.log(`Total findings: ${results.findings.length}`);
console.log('');

if (results.findings.length > 0) {
  console.log('Deeply nested blocks:');
  results.findings.forEach((finding, index) => {
    const block = results.nestedBlocks.find(b => b.file === finding.file && b.line === finding.line);
    console.log(`\n${index + 1}. ${path.basename(finding.file)}:${finding.line}`);
    console.log(`   Type: ${block?.type || 'Unknown'}`);
    console.log(`   Depth: ${block?.depth || 'N/A'} levels`);
    console.log(`   Severity: ${finding.severity}`);
    console.log(`   ${finding.description}`);
  });
} else {
  console.log('✓ No deeply nested blocks found (all within recommended depth of 3)');
}

// Generate and save reports
const reportDir = path.join(__dirname, '../reports');
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

// Generate markdown report
const markdownReport = generateNestingDepthReport(results);
const markdownPath = path.join(reportDir, 'nesting-depth-analysis.md');
fs.writeFileSync(markdownPath, markdownReport);
console.log(`\n✓ Markdown report saved to: ${markdownPath}`);

// Generate JSON report
const jsonReport = {
  timestamp: new Date().toISOString(),
  analyzer: 'nesting-depth-analyzer',
  files: filesToAnalyze.map(f => path.basename(f)),
  statistics: stats,
  findings: results.findings.map(f => ({
    id: f.id,
    category: f.category,
    subcategory: f.subcategory,
    severity: f.severity,
    effort: f.effort,
    impact: f.impact,
    file: path.basename(f.file),
    line: f.line,
    description: f.description,
    recommendation: f.recommendation
  })),
  nestedBlocks: results.nestedBlocks.map(b => ({
    type: b.type,
    file: path.basename(b.file),
    line: b.line,
    depth: b.depth
  }))
};

const jsonPath = path.join(reportDir, 'nesting-depth-findings.json');
fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
console.log(`✓ JSON report saved to: ${jsonPath}`);

console.log('\n✓ Analysis complete!');
