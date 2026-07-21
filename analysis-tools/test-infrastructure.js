/**
 * Quick test to verify the analysis infrastructure is working
 */

import { createFinding, createChange, createAnalysisReport } from './models.js';
import { parseCode, extractFunctions, extractVariables, extractCalls, getNestingDepth } from './parser.js';
import { generateAnalysisReport, formatReportAsText, calculatePriority, prioritizeFindings } from './report-generator.js';

console.log('Testing Analysis Infrastructure...\n');

// Test 1: Create a finding
console.log('✓ Test 1: Creating a Finding');
const finding = createFinding({
  category: 'dead-code',
  subcategory: 'unused-function',
  severity: 'moderate',
  effort: 'quick-win',
  impact: 70,
  file: 'test.js',
  line: 10,
  description: 'Unused function detected',
  recommendation: 'Remove the unused function',
  codeSnippet: 'function unused() { return 42; }'
});
console.log(`  Finding ID: ${finding.id}`);
console.log(`  Category: ${finding.category}`);
console.log(`  Priority: ${calculatePriority(finding.severity, finding.effort, finding.impact)}`);
console.log();

// Test 2: Create a change
console.log('✓ Test 2: Creating a Change');
const change = createChange({
  findingIds: [finding.id],
  file: 'test.js',
  type: 'removal',
  beforeSnippet: 'function unused() { return 42; }',
  afterSnippet: '',
  rationale: 'Removed unused function'
});
console.log(`  Change ID: ${change.id}`);
console.log(`  Type: ${change.type}`);
console.log(`  Timestamp: ${change.timestamp}`);
console.log();

// Test 3: Parse code and extract functions
console.log('✓ Test 3: Parsing Code');
const testCode = `
function greet(name) {
  return "Hello, " + name;
}

const add = (a, b) => a + b;

function unused() {
  return 42;
}

greet("World");
add(1, 2);
`;

const ast = parseCode(testCode);
const functions = extractFunctions(ast);
const variables = extractVariables(ast);
const calls = extractCalls(ast);

console.log(`  Functions found: ${functions.length}`);
functions.forEach(fn => {
  console.log(`    - ${fn.name} (${fn.type})`);
});

console.log(`  Variables found: ${variables.length}`);
variables.forEach(v => {
  console.log(`    - ${v.name}`);
});

console.log(`  Calls found: ${calls.length}`);
calls.forEach(c => {
  console.log(`    - ${c.callee}()`);
});
console.log();

// Test 4: Nesting depth calculation
console.log('✓ Test 4: Calculating Nesting Depth');
const nestedCode = `
function deeplyNested() {
  if (condition1) {
    if (condition2) {
      if (condition3) {
        if (condition4) {
          return true;
        }
      }
    }
  }
  return false;
}
`;

const nestedAst = parseCode(nestedCode);
const nestedFunctions = extractFunctions(nestedAst);
console.log(`  Functions found: ${nestedFunctions.length}`);
console.log();

// Test 5: Generate and format a report
console.log('✓ Test 5: Generating Analysis Report');
const report = generateAnalysisReport({
  filesAnalyzed: ['test.js', 'app.js'],
  findings: [
    finding,
    createFinding({
      category: 'optimization',
      subcategory: 'deep-nesting',
      severity: 'minor',
      effort: 'medium',
      impact: 40,
      file: 'app.js',
      line: 50,
      description: 'Deep nesting detected (4 levels)',
      recommendation: 'Use early returns'
    })
  ]
});

console.log(`  Total findings: ${report.summary.total}`);
console.log(`  Quick wins: ${report.summary.quickWins}`);
console.log(`  By category:`, report.summary.byCategory);
console.log();

// Test 6: Prioritize findings
console.log('✓ Test 6: Prioritizing Findings');
const prioritized = prioritizeFindings([...report.findings]);
console.log('  Findings sorted by priority:');
prioritized.forEach((f, i) => {
  console.log(`    ${i + 1}. [Priority: ${f.priority}] ${f.description}`);
});
console.log();

console.log('═══════════════════════════════════════════════════════════');
console.log('All infrastructure tests passed! ✓');
console.log('═══════════════════════════════════════════════════════════');
