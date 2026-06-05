#!/usr/bin/env node

/**
 * Runner script for spacing consistency analysis
 * 
 * Executes the spacing consistency checker on the FLAPS codebase
 * and generates a detailed report.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeSpacingConsistency, generateSpacingReport, writeSpacingReport } from './analyzers/spacing-consistency-checker.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('Starting spacing consistency analysis...\n');

// Run the analysis
const findings = analyzeSpacingConsistency(projectRoot);

// Read CSS to generate detailed report
const cssPath = path.join(projectRoot, 'public', 'styles.css');
const cssContent = fs.readFileSync(cssPath, 'utf-8');

// Extract spacing values for detailed report
function extractSpacingValuesLocal(cssContent) {
  const spacingValues = [];
  const lines = cssContent.split('\n');
  
  const spacingProps = ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                        'gap', 'row-gap', 'column-gap'];
  
  lines.forEach((line, index) => {
    spacingProps.forEach(prop => {
      const pattern = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'gi');
      const matches = line.matchAll(pattern);
      
      for (const match of matches) {
        const valueString = match[1].trim();
        
        if (valueString.includes('var(') || valueString.includes('calc(')) {
          continue;
        }
        
        const values = valueString.split(/\s+/);
        
        values.forEach(value => {
          const parsed = parseSpacingValueLocal(value);
          if (parsed) {
            spacingValues.push({
              property: prop,
              value: value,
              parsed: parsed,
              line: index + 1,
              context: line.trim()
            });
          }
        });
      }
    });
  });
  
  return spacingValues;
}

function parseSpacingValueLocal(value) {
  if (value === '0' || value === '0px') {
    return { numeric: 0, unit: 'px', original: value };
  }
  
  const match = value.match(/^(-?[\d.]+)(px|rem|em)$/);
  if (match) {
    return {
      numeric: parseFloat(match[1]),
      unit: match[2],
      original: value
    };
  }
  
  return null;
}

const spacingValues = extractSpacingValuesLocal(cssContent);
const report = generateSpacingReport(spacingValues);

// Write report to file
writeSpacingReport(projectRoot, findings, report);

// Display results
console.log('=== Spacing Consistency Analysis Results ===\n');

console.log(`Total spacing declarations: ${report.totalSpacingDeclarations}`);
console.log(`Unique spacing values: ${report.uniqueValues}`);
console.log(`Non-standard values: ${report.nonStandardCount}\n`);

console.log('Unit distribution:');
Object.entries(report.unitDistribution).forEach(([unit, count]) => {
  console.log(`  ${unit}: ${count}`);
});

console.log('\nMost common spacing values:');
report.mostCommonValues.slice(0, 5).forEach(({ value, count }) => {
  console.log(`  ${value}: ${count}×`);
});

console.log(`\n=== Findings (${findings.length} issues) ===\n`);

if (findings.length === 0) {
  console.log('✓ No spacing consistency issues found!');
} else {
  // Group by subcategory
  const bySubcategory = {};
  findings.forEach(f => {
    if (!bySubcategory[f.subcategory]) {
      bySubcategory[f.subcategory] = [];
    }
    bySubcategory[f.subcategory].push(f);
  });
  
  Object.entries(bySubcategory).forEach(([subcategory, items]) => {
    console.log(`${subcategory} (${items.length}):`);
    items.forEach(finding => {
      console.log(`  [${finding.severity.toUpperCase()}] Line ${finding.line}`);
      console.log(`    ${finding.description}`);
      console.log(`    → ${finding.recommendation}\n`);
    });
  });
}

console.log(`\n=== Recommendation ===`);
console.log(report.recommendation);
console.log(`\nSuggested spacing scale: ${report.standardSpacingScale.slice(0, 12).join(', ')}`);

console.log('\n✓ Analysis complete!');
console.log(`Full report saved to: analysis-tools/reports/spacing-consistency-analysis.json\n`);
