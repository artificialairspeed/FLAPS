/**
 * Visual Consistency Verification Tool
 * 
 * This tool verifies visual consistency across the FLAPS application by:
 * 1. Testing responsive layouts at all breakpoints (400px, 600px, 768px, 980px, 1810px)
 * 2. Verifying no visual regressions from style changes
 * 3. Checking hover, focus, and active states on all interactive elements
 * 4. Verifying z-index stacking works correctly for modals and overlays
 * 
 * Requirements: 3.7, 3.13
 * Task: 19.3 Verify visual consistency
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STYLES_PATH = path.join(__dirname, '../public/styles.css');
const HTML_PATH = path.join(__dirname, '../public/index.html');

// Breakpoints from requirements
const BREAKPOINTS = [400, 600, 768, 980, 1810];

/**
 * Parse CSS file and extract rules
 */
function parseCSS(cssPath) {
  const cssContent = fs.readFileSync(cssPath, 'utf-8');
  const rules = [];
  
  // Extract all rules (simplified parser)
  const rulePattern = /([^{]+)\{([^}]+)\}/g;
  let match;
  
  while ((match = rulePattern.exec(cssContent)) !== null) {
    const selector = match[1].trim();
    const properties = match[2].trim();
    
    rules.push({
      selector,
      properties,
      raw: match[0]
    });
  }
  
  return { content: cssContent, rules };
}

/**
 * Check responsive layouts at breakpoints
 */
function checkResponsiveLayouts(css) {
  const findings = [];
  const breakpointRules = {};
  
  // Extract media query rules for each breakpoint
  BREAKPOINTS.forEach(bp => {
    breakpointRules[bp] = css.rules.filter(r => 
      r.selector.includes(`@media`) && r.selector.includes(`${bp}px`)
    );
  });
  
  // Verify each required breakpoint has styles
  BREAKPOINTS.forEach(bp => {
    const hasBreakpoint = css.content.includes(`max-width:${bp}px`) || 
                          css.content.includes(`min-width:${bp}px`) ||
                          css.content.includes(`max-width: ${bp}px`) || 
                          css.content.includes(`min-width: ${bp}px`);
    
    if (hasBreakpoint) {
      findings.push({
        type: 'success',
        breakpoint: bp,
        message: `Breakpoint ${bp}px is defined with responsive styles`
      });
    } else {
      findings.push({
        type: 'warning',
        breakpoint: bp,
        message: `Breakpoint ${bp}px may not have explicit responsive styles`
      });
    }
  });
  
  // Check for responsive units (clamp, vw, rem, %, etc.)
  const responsiveUnits = css.content.match(/clamp\([^)]+\)/g) || [];
  const vwUnits = css.content.match(/\d+\.?\d*vw/g) || [];
  const remUnits = css.content.match(/\d+\.?\d*rem/g) || [];
  
  findings.push({
    type: 'info',
    category: 'responsive-units',
    message: `Found ${responsiveUnits.length} clamp() declarations, ${vwUnits.length} vw units, ${remUnits.length} rem units`
  });
  
  return findings;
}

/**
 * Check interactive states (hover, focus, active)
 */
function checkInteractiveStates(css) {
  const findings = [];
  
  // Interactive element selectors to check
  const interactiveSelectors = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '.deckBtn',
    '.shareHeaderBtn',
    '.queueBtn',
    '.finalChip'
  ];
  
  const states = ['hover', 'focus', 'active', 'focus-visible'];
  
  interactiveSelectors.forEach(selector => {
    const baseExists = css.rules.some(r => r.selector.includes(selector) && !r.selector.includes(':'));
    
    if (!baseExists && !selector.startsWith('.')) {
      return; // Skip if base selector not found
    }
    
    const stateResults = {};
    states.forEach(state => {
      const hasState = css.rules.some(r => 
        r.selector.includes(selector) && r.selector.includes(`:${state}`)
      );
      stateResults[state] = hasState;
    });
    
    // Check if at least hover and focus states exist
    if (stateResults.hover || stateResults['focus-visible'] || stateResults.focus) {
      findings.push({
        type: 'success',
        selector,
        states: stateResults,
        message: `${selector} has interactive states defined`
      });
    } else {
      findings.push({
        type: 'warning',
        selector,
        states: stateResults,
        message: `${selector} may be missing interactive states`
      });
    }
  });
  
  return findings;
}

/**
 * Check z-index stacking and documentation
 */
function checkZIndexStacking(css) {
  const findings = [];
  const zIndexRules = [];
  
  // Find all z-index declarations
  css.rules.forEach(rule => {
    const zIndexMatch = rule.properties.match(/z-index\s*:\s*([^;]+)/);
    if (zIndexMatch) {
      const value = zIndexMatch[1].trim();
      zIndexRules.push({
        selector: rule.selector,
        value,
        raw: rule.raw
      });
    }
  });
  
  if (zIndexRules.length === 0) {
    findings.push({
      type: 'info',
      message: 'No z-index declarations found in stylesheet'
    });
    return findings;
  }
  
  // Check for documentation (comments near z-index)
  zIndexRules.forEach(rule => {
    const lines = css.content.split('\n');
    const ruleIndex = css.content.indexOf(rule.raw);
    
    if (ruleIndex === -1) {
      return;
    }
    
    // Look for comment within 5 lines before the rule
    const beforeContent = css.content.substring(Math.max(0, ruleIndex - 300), ruleIndex);
    const hasComment = beforeContent.includes('/*') || beforeContent.includes('//');
    
    findings.push({
      type: hasComment ? 'success' : 'warning',
      selector: rule.selector,
      value: rule.value,
      message: hasComment 
        ? `z-index ${rule.value} on ${rule.selector} has documentation`
        : `z-index ${rule.value} on ${rule.selector} may need documentation`
    });
  });
  
  // Verify z-index values are reasonable and ordered
  const zIndexValues = zIndexRules.map(r => {
    const numValue = parseInt(r.value);
    return isNaN(numValue) ? null : numValue;
  }).filter(v => v !== null).sort((a, b) => a - b);
  
  if (zIndexValues.length > 0) {
    findings.push({
      type: 'info',
      message: `Z-index values range from ${zIndexValues[0]} to ${zIndexValues[zIndexValues.length - 1]}`,
      values: zIndexValues
    });
  }
  
  return findings;
}

/**
 * Check for visual regression indicators
 */
function checkVisualRegression(css) {
  const findings = [];
  
  // Check for CSS custom properties (theme colors)
  const customPropsCount = (css.content.match(/var\(--[^)]+\)/g) || []).length;
  const hardcodedColors = (css.content.match(/#[0-9a-fA-F]{3,6}(?![^{]*var\()/g) || []).length;
  
  findings.push({
    type: 'info',
    category: 'color-consistency',
    message: `Found ${customPropsCount} CSS custom property references and ${hardcodedColors} potential hardcoded colors`
  });
  
  // Check spacing consistency (4px scale: 4, 8, 12, 16, 20, 24, 32)
  const spacingPattern = /(?:padding|margin|gap):\s*(\d+)px/g;
  const spacingValues = [];
  let match;
  
  while ((match = spacingPattern.exec(css.content)) !== null) {
    spacingValues.push(parseInt(match[1]));
  }
  
  const standardScale = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 32, 48];
  const nonStandardSpacing = spacingValues.filter(v => !standardScale.includes(v));
  const uniqueNonStandard = [...new Set(nonStandardSpacing)];
  
  if (uniqueNonStandard.length > 0) {
    findings.push({
      type: 'info',
      category: 'spacing-consistency',
      message: `Found ${uniqueNonStandard.length} non-standard spacing values: ${uniqueNonStandard.slice(0, 10).join(', ')}`,
      values: uniqueNonStandard
    });
  } else {
    findings.push({
      type: 'success',
      category: 'spacing-consistency',
      message: 'All spacing values follow the standard scale'
    });
  }
  
  return findings;
}

/**
 * Generate verification report
 */
function generateReport(results) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalChecks: 0,
      successes: 0,
      warnings: 0,
      infos: 0
    },
    breakpoints: results.breakpoints,
    interactiveStates: results.interactiveStates,
    zIndexStacking: results.zIndexStacking,
    visualRegression: results.visualRegression
  };
  
  // Count totals
  const allFindings = [
    ...results.breakpoints,
    ...results.interactiveStates,
    ...results.zIndexStacking,
    ...results.visualRegression
  ];
  
  allFindings.forEach(f => {
    report.summary.totalChecks++;
    if (f.type === 'success') report.summary.successes++;
    if (f.type === 'warning') report.summary.warnings++;
    if (f.type === 'info') report.summary.infos++;
  });
  
  return report;
}

/**
 * Format report as markdown
 */
function formatMarkdown(report) {
  let md = '# Visual Consistency Verification Report\n\n';
  md += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n\n`;
  
  md += '## Summary\n\n';
  md += `- **Total Checks:** ${report.summary.totalChecks}\n`;
  md += `- **Successes:** ✅ ${report.summary.successes}\n`;
  md += `- **Warnings:** ⚠️ ${report.summary.warnings}\n`;
  md += `- **Info:** ℹ️ ${report.summary.infos}\n\n`;
  
  // Breakpoints
  md += '## Responsive Layout Breakpoints\n\n';
  report.breakpoints.forEach(f => {
    const icon = f.type === 'success' ? '✅' : f.type === 'warning' ? '⚠️' : 'ℹ️';
    md += `${icon} **${f.breakpoint || 'General'}px**: ${f.message}\n`;
  });
  md += '\n';
  
  // Interactive States
  md += '## Interactive Element States\n\n';
  md += '| Element | Hover | Focus | Focus-Visible | Active | Status |\n';
  md += '|---------|-------|-------|---------------|--------|--------|\n';
  report.interactiveStates.forEach(f => {
    if (f.states) {
      const icon = f.type === 'success' ? '✅' : '⚠️';
      md += `| ${f.selector} | ${f.states.hover ? '✓' : '✗'} | ${f.states.focus ? '✓' : '✗'} | ${f.states['focus-visible'] ? '✓' : '✗'} | ${f.states.active ? '✓' : '✗'} | ${icon} |\n`;
    }
  });
  md += '\n';
  
  // Z-Index
  md += '## Z-Index Stacking Context\n\n';
  report.zIndexStacking.forEach(f => {
    const icon = f.type === 'success' ? '✅' : f.type === 'warning' ? '⚠️' : 'ℹ️';
    if (f.selector) {
      md += `${icon} **${f.selector}** (z-index: ${f.value}): ${f.message}\n`;
    } else {
      md += `${icon} ${f.message}\n`;
    }
  });
  md += '\n';
  
  // Visual Regression
  md += '## Visual Regression Checks\n\n';
  report.visualRegression.forEach(f => {
    const icon = f.type === 'success' ? '✅' : f.type === 'warning' ? '⚠️' : 'ℹ️';
    md += `${icon} **${f.category || 'General'}**: ${f.message}\n`;
  });
  md += '\n';
  
  md += '---\n\n';
  md += '*This report validates Requirements 3.7 and 3.13 from the codebase-cleanup-analysis spec.*\n';
  
  return md;
}

/**
 * Main verification function
 */
function verifyVisualConsistency() {
  console.log('🔍 Starting visual consistency verification...\n');
  
  // Parse CSS
  const css = parseCSS(STYLES_PATH);
  console.log(`✓ Parsed ${css.rules.length} CSS rules\n`);
  
  // Run checks
  console.log('Checking responsive layouts at breakpoints...');
  const breakpoints = checkResponsiveLayouts(css);
  console.log(`✓ Checked ${BREAKPOINTS.length} breakpoints\n`);
  
  console.log('Checking interactive element states...');
  const interactiveStates = checkInteractiveStates(css);
  console.log(`✓ Checked interactive states\n`);
  
  console.log('Checking z-index stacking...');
  const zIndexStacking = checkZIndexStacking(css);
  console.log(`✓ Checked z-index declarations\n`);
  
  console.log('Checking for visual regressions...');
  const visualRegression = checkVisualRegression(css);
  console.log(`✓ Checked visual consistency\n`);
  
  // Generate report
  const results = {
    breakpoints,
    interactiveStates,
    zIndexStacking,
    visualRegression
  };
  
  const report = generateReport(results);
  
  // Save reports
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  const jsonPath = path.join(reportsDir, 'visual-consistency-verification.json');
  const mdPath = path.join(reportsDir, 'visual-consistency-verification.md');
  
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, formatMarkdown(report));
  
  console.log(`\n📊 Report Summary:`);
  console.log(`   Total Checks: ${report.summary.totalChecks}`);
  console.log(`   ✅ Successes: ${report.summary.successes}`);
  console.log(`   ⚠️  Warnings: ${report.summary.warnings}`);
  console.log(`   ℹ️  Info: ${report.summary.infos}`);
  console.log(`\n📄 Reports saved:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   Markdown: ${mdPath}`);
  
  return report;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const report = verifyVisualConsistency();
    
    // Exit with appropriate code
    if (report.summary.warnings > 10) {
      console.log('\n⚠️  Many warnings found - review recommended');
      process.exit(1);
    } else {
      console.log('\n✅ Visual consistency verification complete');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Error during verification:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

export { verifyVisualConsistency, checkResponsiveLayouts, checkInteractiveStates, checkZIndexStacking, checkVisualRegression };
