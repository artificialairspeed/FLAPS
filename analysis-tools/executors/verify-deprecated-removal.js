#!/usr/bin/env node

/**
 * Task 16.3: Verify No Deprecated References Remain
 * 
 * This script comprehensively verifies that all deprecated features identified
 * in tasks 16.1 and 16.2 have been completely removed with no remaining references.
 * 
 * Requirements: 4.11, 4.12, 8.1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deprecated CSS selectors removed in task 16.1
const REMOVED_CSS_SELECTORS = [
  'brandText',
  'subtitle',
  'tiny',
  'finalizeBtn',
  'queueHeader',
  'queuePoints',
  'pointsBadge',
  'hint',
  'queueLinkBtn',
  'readonly',
  'toast-error',
  'toast-warn',
  'toast-success',
  'footerIcon'
];

// Queue navigation features removed previously
const QUEUE_NAV_IDENTIFIERS = [
  'queueScrollOffset',
  'QUEUE_VISIBLE_COUNT',
  'scrollQueueUp',
  'scrollQueueDown',
  'initQueueNavigation',
  'queueNavControls',
  'queueScrollUp',
  'queueScrollDown',
  'queueCounter',
  'queueNavBtn',
  'queueNavIcon'
];

// Function parameters removed in task 16.2
const REMOVED_PARAMETERS = [
  { func: 'setShareLinks', param: 'mk', file: 'public/app.js' },
  { func: 'gracefulShutdown', param: 'signal', file: 'server.js' }
];

// Files to check
const FILES_TO_CHECK = [
  'public/app.js',
  'public/index.html',
  'public/styles.css',
  'server.js'
];

const TEST_FILES = [
  'public/app.property.test.js'
];

function readFile(filePath) {
  const fullPath = path.resolve(__dirname, '../../', filePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    return null;
  }
}

function searchInFile(content, pattern, caseSensitive = true) {
  if (!content) return [];
  
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(pattern, flags);
  const lines = content.split('\n');
  const matches = [];
  
  lines.forEach((line, index) => {
    if (regex.test(line)) {
      matches.push({
        line: index + 1,
        content: line.trim()
      });
    }
  });
  
  return matches;
}

function verifyCSSSelectorRemoval() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('1. VERIFYING CSS SELECTOR REMOVAL');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const findings = [];
  const cssContent = readFile('public/styles.css');
  const htmlContent = readFile('public/index.html');
  const appContent = readFile('public/app.js');
  
  REMOVED_CSS_SELECTORS.forEach(selector => {
    // Check CSS file for base definitions (not media query overrides)
    if (cssContent) {
      const basePattern = `^\\.${selector}\\s*\\{`;
      const baseMatches = searchInFile(cssContent, basePattern);
      
      if (baseMatches.length > 0) {
        findings.push({
          type: 'CSS_BASE_DEFINITION',
          selector: selector,
          file: 'public/styles.css',
          matches: baseMatches
        });
      }
      
      // Check for media query overrides
      const mediaPattern = `\\.${selector}\\s*\\{`;
      const mediaMatches = searchInFile(cssContent, mediaPattern);
      if (mediaMatches.length > 0) {
        findings.push({
          type: 'CSS_MEDIA_OVERRIDE',
          selector: selector,
          file: 'public/styles.css',
          matches: mediaMatches
        });
      }
    }
    
    // Check HTML for class usage
    if (htmlContent) {
      const htmlPattern = `class\\s*=\\s*["'][^"']*${selector}`;
      const htmlMatches = searchInFile(htmlContent, htmlPattern);
      if (htmlMatches.length > 0) {
        findings.push({
          type: 'HTML_CLASS',
          selector: selector,
          file: 'public/index.html',
          matches: htmlMatches
        });
      }
    }
    
    // Check JS for className assignments
    if (appContent) {
      const jsPattern = `className\\s*=\\s*["']${selector}["']|classList\\.(add|remove|toggle)\\(["']${selector}["']\\)`;
      const jsMatches = searchInFile(appContent, jsPattern);
      if (jsMatches.length > 0) {
        findings.push({
          type: 'JS_CLASSNAME',
          selector: selector,
          file: 'public/app.js',
          matches: jsMatches
        });
      }
    }
  });
  
  // Report findings
  if (findings.length === 0) {
    console.log('✅ PASS: All removed CSS selectors verified gone from main codebase\n');
    return { passed: true, findings: [] };
  } else {
    console.log('⚠️  WARNINGS FOUND:\n');
    findings.forEach((finding, i) => {
      console.log(`${i + 1}. ${finding.type}: .${finding.selector}`);
      console.log(`   File: ${finding.file}`);
      finding.matches.forEach(match => {
        console.log(`   Line ${match.line}: ${match.content}`);
      });
      console.log();
    });
    return { passed: false, findings };
  }
}

function verifyQueueNavigationRemoval() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('2. VERIFYING QUEUE NAVIGATION REMOVAL');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const findings = [];
  
  FILES_TO_CHECK.forEach(filePath => {
    const content = readFile(filePath);
    if (!content) return;
    
    QUEUE_NAV_IDENTIFIERS.forEach(identifier => {
      const pattern = identifier;
      const matches = searchInFile(content, pattern);
      
      if (matches.length > 0) {
        findings.push({
          identifier: identifier,
          file: filePath,
          matches: matches
        });
      }
    });
  });
  
  if (findings.length === 0) {
    console.log('✅ PASS: All queue navigation references removed\n');
    return { passed: true, findings: [] };
  } else {
    console.log('❌ FAIL: Queue navigation references still exist:\n');
    findings.forEach((finding, i) => {
      console.log(`${i + 1}. "${finding.identifier}" in ${finding.file}`);
      finding.matches.forEach(match => {
        console.log(`   Line ${match.line}: ${match.content}`);
      });
      console.log();
    });
    return { passed: false, findings };
  }
}

function verifyParameterRemoval() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('3. VERIFYING FUNCTION PARAMETER REMOVAL');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const findings = [];
  
  REMOVED_PARAMETERS.forEach(({ func, param, file }) => {
    const content = readFile(file);
    if (!content) return;
    
    // Check function definition for parameter
    const defPattern = `function\\s+${func}\\s*\\([^)]*${param}`;
    const defMatches = searchInFile(content, defPattern);
    
    if (defMatches.length > 0) {
      findings.push({
        type: 'FUNCTION_DEFINITION',
        func: func,
        param: param,
        file: file,
        matches: defMatches
      });
    }
    
    // Check function calls for parameter being passed
    const callPattern = `${func}\\s*\\([^,)]+,`;
    const callMatches = searchInFile(content, callPattern);
    
    if (callMatches.length > 0) {
      findings.push({
        type: 'FUNCTION_CALL',
        func: func,
        param: param,
        file: file,
        matches: callMatches
      });
    }
  });
  
  if (findings.length === 0) {
    console.log('✅ PASS: All removed function parameters verified gone\n');
    return { passed: true, findings: [] };
  } else {
    console.log('❌ FAIL: Removed function parameters still referenced:\n');
    findings.forEach((finding, i) => {
      console.log(`${i + 1}. ${finding.type}: ${finding.func}(... ${finding.param} ...) in ${finding.file}`);
      finding.matches.forEach(match => {
        console.log(`   Line ${match.line}: ${match.content}`);
      });
      console.log();
    });
    return { passed: false, findings };
  }
}

function checkTestFiles() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('4. CHECKING TEST FILES FOR DEPRECATED REFERENCES');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const findings = [];
  
  TEST_FILES.forEach(filePath => {
    const content = readFile(filePath);
    if (!content) return;
    
    // Check for removed CSS selectors
    REMOVED_CSS_SELECTORS.forEach(selector => {
      const pattern = `["']${selector}["']`;
      const matches = searchInFile(content, pattern);
      
      if (matches.length > 0) {
        findings.push({
          type: 'TEST_CSS_SELECTOR',
          selector: selector,
          file: filePath,
          matches: matches
        });
      }
    });
  });
  
  if (findings.length === 0) {
    console.log('✅ PASS: Test files have no deprecated references\n');
    return { passed: true, findings: [] };
  } else {
    console.log('⚠️  WARNING: Test files reference deprecated selectors:\n');
    findings.forEach((finding, i) => {
      console.log(`${i + 1}. .${finding.selector} in ${finding.file}`);
      finding.matches.forEach(match => {
        console.log(`   Line ${match.line}: ${match.content}`);
      });
      console.log();
    });
    console.log('NOTE: These test files may need updating if they test rendering functions.\n');
    return { passed: false, findings, warning: true };
  }
}

function generateSummary(results) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const allPassed = results.every(r => r.passed);
  const warnings = results.filter(r => r.warning);
  const failures = results.filter(r => !r.passed && !r.warning);
  
  console.log(`CSS Selector Removal:      ${results[0].passed ? '✅ PASS' : '⚠️  WARNING'}`);
  console.log(`Queue Navigation Removal:  ${results[1].passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Parameter Removal:         ${results[2].passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test File Check:           ${results[3].passed ? '✅ PASS' : '⚠️  WARNING'}`);
  
  console.log('\n' + '─'.repeat(60) + '\n');
  
  if (allPassed) {
    console.log('🎉 SUCCESS: All deprecated features completely removed!\n');
    return 0;
  } else if (failures.length === 0 && warnings.length > 0) {
    console.log('⚠️  WARNINGS ONLY: Main codebase clean, but see warnings above.\n');
    console.log('Action items:');
    if (warnings[0]) {
      console.log('- Remove orphaned media query overrides for deleted CSS selectors');
      console.log('- Update property test files to not use deleted CSS classes\n');
    }
    return 1;
  } else {
    console.log('❌ FAILURE: Deprecated references still exist in codebase.\n');
    console.log('Please review findings above and remove remaining references.\n');
    return 2;
  }
}

// Main execution
function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TASK 16.3: VERIFY NO DEPRECATED REFERENCES REMAIN');
  console.log('═══════════════════════════════════════════════════════════');
  
  const results = [
    verifyCSSSelectorRemoval(),
    verifyQueueNavigationRemoval(),
    verifyParameterRemoval(),
    checkTestFiles()
  ];
  
  const exitCode = generateSummary(results);
  
  // Save results to file
  const reportPath = path.resolve(__dirname, '../reports/TASK_16.3_VERIFICATION.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    task: '16.3',
    results: results,
    exitCode: exitCode
  }, null, 2));
  
  console.log(`Full results saved to: ${reportPath}\n`);
  
  process.exit(exitCode);
}

main();

export { 
  verifyCSSSelectorRemoval,
  verifyQueueNavigationRemoval,
  verifyParameterRemoval,
  checkTestFiles
};
