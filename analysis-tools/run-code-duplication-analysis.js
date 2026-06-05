/**
 * Run code duplication analysis on FLAPS codebase
 */

import { analyzeCodeDuplication, generateDuplicationReport } from './analyzers/code-duplication-detector.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files to analyze
const filesToAnalyze = [
  path.resolve(__dirname, '../public/app.js'),
  path.resolve(__dirname, '../server.js')
];

console.log('Starting code duplication analysis...');
console.log('Files to analyze:', filesToAnalyze.map(f => path.basename(f)).join(', '));
console.log();

// Run analysis
const result = analyzeCodeDuplication(filesToAnalyze, {
  minLines: 5,
  minNodes: 10,
  similarityThreshold: 0.85
});

if (!result.success) {
  console.error('Analysis failed:', result.error);
  process.exit(1);
}

console.log('Analysis complete!');
console.log();
console.log('Summary:');
console.log(`  Total code blocks extracted: ${result.summary.totalBlocks}`);
console.log(`  Duplicate groups found: ${result.summary.duplicateGroups}`);
console.log(`  Total duplicate blocks: ${result.summary.totalDuplicates}`);
console.log();

if (result.findings.length > 0) {
  console.log(`Found ${result.findings.length} duplication findings:`);
  console.log();
  
  result.findings.forEach((finding, index) => {
    console.log(`${index + 1}. ${finding.description}`);
    console.log(`   Severity: ${finding.severity}, Effort: ${finding.effort}, Impact: ${finding.impact}`);
    console.log(`   Location: ${finding.file}:${finding.line}`);
    console.log(`   Recommendation: ${finding.recommendation}`);
    console.log();
  });
  
  // Generate JSON report
  const reportPath = path.resolve(__dirname, 'reports/code-duplication-findings.json');
  generateDuplicationReport(result.findings, reportPath);
  
} else {
  console.log('No code duplication found!');
}
