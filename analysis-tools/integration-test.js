/**
 * Integration test demonstrating the complete analysis workflow
 */

import {
  parseCode,
  extractFunctions,
  extractCalls,
  createFinding,
  generateAnalysisReport,
  prioritizeFindings,
  formatReportAsText,
  formatReportAsMarkdown,
  groupByCategory,
  getNestingDepth,
  countFunctionLines,
  traverse
} from './index.js';

console.log('═══════════════════════════════════════════════════════════');
console.log('     ANALYSIS INFRASTRUCTURE INTEGRATION TEST');
console.log('═══════════════════════════════════════════════════════════\n');

// Sample code to analyze (simulates a real JavaScript file)
const sampleCode = `
// Used function
function calculateFibonacci(n) {
  if (n <= 1) return n;
  return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}

// Unused function
function oldProcessing() {
  console.log('This is never called');
  return 42;
}

// Another used function
const formatResult = (value) => {
  return "Result: " + value;
};

// Function with deep nesting
function deeplyNestedLogic(data) {
  if (data) {
    if (data.user) {
      if (data.user.permissions) {
        if (data.user.permissions.admin) {
          return true;
        }
      }
    }
  }
  return false;
}

// Long function (simulated)
function veryLongFunction() {
  let result = 0;
  // Imagine 150+ lines of code here
  for (let i = 0; i < 100; i++) {
    result += i;
  }
  return result;
}

// Usage
const fib5 = calculateFibonacci(5);
const formatted = formatResult(fib5);
console.log(formatted);
`;

console.log('Step 1: Parsing code...');
const ast = parseCode(sampleCode);
console.log('✓ Code parsed successfully\n');

console.log('Step 2: Extracting functions and calls...');
const functions = extractFunctions(ast);
const calls = extractCalls(ast);

console.log(`Found ${functions.length} functions:`);
functions.forEach(fn => {
  console.log(`  - ${fn.name} (line ${fn.line})`);
});

console.log(`\nFound ${calls.length} function calls:`);
calls.forEach(call => {
  console.log(`  - ${call.callee}()`);
});
console.log();

console.log('Step 3: Analyzing for dead code...');
const calledFunctions = new Set(calls.map(c => c.callee));
const unusedFunctions = functions.filter(f => 
  f.name !== '<anonymous>' && !calledFunctions.has(f.name)
);

console.log(`Found ${unusedFunctions.length} unused functions:`);
unusedFunctions.forEach(fn => {
  console.log(`  - ${fn.name}`);
});
console.log();

console.log('Step 4: Analyzing for deep nesting...');
const deeplyNested = [];
traverse(ast, {
  FunctionDeclaration(node) {
    if (node.body) {
      const depth = getNestingDepth(node.body);
      const lines = countFunctionLines(node);
      
      if (depth > 3) {
        deeplyNested.push({
          name: node.id?.name || '<anonymous>',
          depth,
          lines,
          line: node.loc?.start.line || 0
        });
      }
    }
  }
});

console.log(`Found ${deeplyNested.length} deeply nested functions:`);
deeplyNested.forEach(fn => {
  console.log(`  - ${fn.name} (depth: ${fn.depth}, line: ${fn.line})`);
});
console.log();

console.log('Step 5: Creating findings...');
const findings = [];

// Dead code findings
unusedFunctions.forEach(fn => {
  findings.push(createFinding({
    category: 'dead-code',
    subcategory: 'unused-function',
    severity: 'moderate',
    effort: 'quick-win',
    impact: 60,
    file: 'sample.js',
    line: fn.line,
    description: `Unused function: ${fn.name}`,
    recommendation: `Remove the unused function ${fn.name}`,
    codeSnippet: `function ${fn.name}(${fn.params.join(', ')}) { ... }`
  }));
});

// Deep nesting findings
deeplyNested.forEach(fn => {
  findings.push(createFinding({
    category: 'optimization',
    subcategory: 'deep-nesting',
    severity: 'minor',
    effort: 'medium',
    impact: 40,
    file: 'sample.js',
    line: fn.line,
    description: `Deep nesting in ${fn.name} (${fn.depth} levels)`,
    recommendation: 'Refactor using guard clauses or early returns',
    codeSnippet: `function ${fn.name}() { /* ${fn.depth} levels deep */ }`
  }));
});

console.log(`Created ${findings.length} findings\n`);

console.log('Step 6: Generating analysis report...');
const report = generateAnalysisReport({
  filesAnalyzed: ['sample.js'],
  findings
});

console.log('Report summary:');
console.log(`  Total findings: ${report.summary.total}`);
console.log(`  Quick wins: ${report.summary.quickWins}`);
console.log(`  By category:`, JSON.stringify(report.summary.byCategory));
console.log(`  By severity:`, JSON.stringify(report.summary.bySeverity));
console.log(`  By effort:`, JSON.stringify(report.summary.byEffort));
console.log();

console.log('Step 7: Prioritizing findings...');
const prioritized = prioritizeFindings([...report.findings]);
console.log('Prioritized findings (highest first):');
prioritized.forEach((f, i) => {
  console.log(`  ${i + 1}. [Priority: ${f.priority}] ${f.description}`);
});
console.log();

console.log('Step 8: Grouping by category...');
const grouped = groupByCategory(prioritized);
console.log('Findings by category:');
Object.entries(grouped).forEach(([category, items]) => {
  console.log(`  ${category}: ${items.length} findings`);
});
console.log();

console.log('Step 9: Generating formatted reports...');
const textReport = formatReportAsText({ ...report, findings: prioritized });
const markdownReport = formatReportAsMarkdown({ ...report, findings: prioritized });

console.log('\n--- TEXT REPORT ---');
console.log(textReport);

console.log('\n--- MARKDOWN REPORT (first 500 chars) ---');
console.log(markdownReport.substring(0, 500) + '...\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('     INTEGRATION TEST COMPLETED SUCCESSFULLY ✓');
console.log('═══════════════════════════════════════════════════════════');
console.log('\nThe analysis infrastructure is ready to use!');
console.log('Next steps:');
console.log('  1. Create specific analyzers in analysis-tools/analyzers/');
console.log('  2. Create cleanup executors in analysis-tools/executors/');
console.log('  3. Run analysis on the FLAPS codebase');
