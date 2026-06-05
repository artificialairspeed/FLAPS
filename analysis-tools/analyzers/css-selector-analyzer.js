/**
 * CSS Selector Usage Analyzer
 * 
 * Parses styles.css to extract all class and ID selectors,
 * parses index.html and checks dynamically added classes in app.js,
 * identifies CSS selectors never applied to any DOM elements,
 * and generates findings for unused CSS with severity and impact scores.
 * 
 * Requirements: 1.4
 */

import fs from 'fs';
import path from 'path';
import { createFinding } from '../models.js';

/**
 * Extract all CSS selectors from a CSS file
 * @param {string} cssContent - Content of the CSS file
 * @returns {Object} Object containing class selectors and id selectors
 */
function extractCSSSelectors(cssContent) {
  const classSelectors = new Set();
  const idSelectors = new Set();
  
  // Remove comments
  const cleanedCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Match class selectors: .className
  const classMatches = cleanedCss.matchAll(/\.([a-zA-Z_][\w-]*)/g);
  for (const match of classMatches) {
    classSelectors.add(match[1]);
  }
  
  // Match ID selectors: #idName
  // But exclude hex color codes (which are #followed by hex digits)
  const idMatches = cleanedCss.matchAll(/#([a-zA-Z_][\w-]*)/g);
  for (const match of idMatches) {
    const idName = match[1];
    // Exclude if it looks like a hex color (all hex digits)
    if (!/^[0-9a-fA-F]+$/.test(idName)) {
      idSelectors.add(idName);
    }
  }
  
  return {
    classes: Array.from(classSelectors).sort(),
    ids: Array.from(idSelectors).sort()
  };
}

/**
 * Extract all class and ID references from HTML
 * @param {string} htmlContent - Content of the HTML file
 * @returns {Object} Object containing class references and id references
 */
function extractHTMLReferences(htmlContent) {
  const classRefs = new Set();
  const idRefs = new Set();
  
  // Match class attributes: class="class1 class2 class3"
  const classMatches = htmlContent.matchAll(/class\s*=\s*["']([^"']+)["']/gi);
  for (const match of classMatches) {
    const classes = match[1].split(/\s+/).filter(c => c.length > 0);
    classes.forEach(c => classRefs.add(c));
  }
  
  // Match id attributes: id="idName"
  const idMatches = htmlContent.matchAll(/id\s*=\s*["']([^"']+)["']/gi);
  for (const match of idMatches) {
    idRefs.add(match[1]);
  }
  
  return {
    classes: Array.from(classRefs).sort(),
    ids: Array.from(idRefs).sort()
  };
}

/**
 * Extract dynamically added/removed classes from JavaScript
 * @param {string} jsContent - Content of the JavaScript file
 * @returns {Object} Object containing dynamically referenced classes
 */
function extractDynamicClasses(jsContent) {
  const dynamicClasses = new Set();
  
  // Match classList.add('className')
  const addMatches = jsContent.matchAll(/classList\.add\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of addMatches) {
    dynamicClasses.add(match[1]);
  }
  
  // Match classList.remove('className')
  const removeMatches = jsContent.matchAll(/classList\.remove\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of removeMatches) {
    dynamicClasses.add(match[1]);
  }
  
  // Match classList.toggle('className')
  const toggleMatches = jsContent.matchAll(/classList\.toggle\s*\(\s*['"]([^'"]+)['"]\s*[,)]/g);
  for (const match of toggleMatches) {
    dynamicClasses.add(match[1]);
  }
  
  // Match className = 'className1 className2'
  const classNameMatches = jsContent.matchAll(/className\s*=\s*['"]([^'"]+)['"]/g);
  for (const match of classNameMatches) {
    const classes = match[1].split(/\s+/).filter(c => c.length > 0);
    classes.forEach(c => dynamicClasses.add(c));
  }
  
  // Match className = `template literal`
  // Extract static class names from template literals
  const templateMatches = jsContent.matchAll(/className\s*=\s*`([^`]+)`/g);
  for (const match of templateMatches) {
    // Extract only the static parts (not variable interpolations)
    const staticParts = match[1].split(/\$\{[^}]+\}/);
    staticParts.forEach(part => {
      const classes = part.split(/\s+/).filter(c => c.length > 0 && /^[a-zA-Z_][\w-]*$/.test(c));
      classes.forEach(c => dynamicClasses.add(c));
    });
  }
  
  // Match innerHTML or outerHTML assignments (handle both single and double quotes)
  // Pattern 1: innerHTML = '...' or innerHTML = "..."
  const htmlSingleMatches = jsContent.matchAll(/(?:innerHTML|outerHTML)\s*=\s*'([^']+)'/g);
  for (const match of htmlSingleMatches) {
    const htmlContent = match[1];
    // Extract classes from class="..."
    const classAttrs = htmlContent.matchAll(/class\s*=\s*"([^"]+)"/gi);
    for (const classMatch of classAttrs) {
      const classes = classMatch[1].split(/\s+/).filter(c => c.length > 0);
      classes.forEach(c => dynamicClasses.add(c));
    }
  }
  
  const htmlDoubleMatches = jsContent.matchAll(/(?:innerHTML|outerHTML)\s*=\s*"([^"]+)"/g);
  for (const match of htmlDoubleMatches) {
    const htmlContent = match[1];
    // Extract classes from class='...'
    const classAttrs = htmlContent.matchAll(/class\s*=\s*'([^']+)'/gi);
    for (const classMatch of classAttrs) {
      const classes = classMatch[1].split(/\s+/).filter(c => c.length > 0);
      classes.forEach(c => dynamicClasses.add(c));
    }
  }
  
  // Match className += ' className' or className = something + ' className'
  const concatMatches = jsContent.matchAll(/className\s*[+]=?\s*['"`]\s*([^'"`]+)['"`]/g);
  for (const match of concatMatches) {
    const classes = match[1].split(/\s+/).filter(c => c.length > 0 && /^[a-zA-Z_][\w-]*$/.test(c));
    classes.forEach(c => dynamicClasses.add(c));
  }
  
  // Match patterns like: 'className1' + (condition ? ' className2' : '')
  // This captures conditional class additions
  const ternaryMatches = jsContent.matchAll(/['"`]([a-zA-Z_][\w-]*)['"`]\s*[+:]\s*\(/g);
  for (const match of ternaryMatches) {
    dynamicClasses.add(match[1]);
  }
  
  // Match string concatenation patterns with space: ' className'
  const spaceClassMatches = jsContent.matchAll(/['"`]\s+([a-zA-Z_][\w-]*)['"`]/g);
  for (const match of spaceClassMatches) {
    dynamicClasses.add(match[1]);
  }
  
  return {
    classes: Array.from(dynamicClasses).sort()
  };
}

/**
 * Get line number where a CSS selector is defined
 * @param {string} cssContent - Content of the CSS file
 * @param {string} selector - The selector to find
 * @param {string} type - 'class' or 'id'
 * @returns {number} Line number (1-indexed)
 */
function getSelectorLineNumber(cssContent, selector, type) {
  const lines = cssContent.split('\n');
  const prefix = type === 'class' ? '.' : '#';
  const searchPattern = new RegExp(`\\${prefix}${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  
  for (let i = 0; i < lines.length; i++) {
    if (searchPattern.test(lines[i])) {
      return i + 1;
    }
  }
  
  return 1; // Fallback
}

/**
 * Calculate severity based on selector characteristics
 * @param {string} selector - The CSS selector
 * @param {string} cssContent - Full CSS content
 * @returns {'critical'|'moderate'|'minor'}
 */
function calculateSeverity(selector, cssContent) {
  // Count how many rules use this selector
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const classPattern = new RegExp(`\\.${escapedSelector}(?![\\w-])`, 'g');
  const matches = cssContent.match(classPattern) || [];
  
  // Multiple uses = higher severity
  if (matches.length >= 5) {
    return 'moderate';
  } else if (matches.length >= 2) {
    return 'minor';
  }
  
  return 'minor';
}

/**
 * Calculate impact score based on CSS complexity
 * @param {string} selector - The CSS selector
 * @param {string} cssContent - Full CSS content
 * @returns {number} Impact score (0-100)
 */
function calculateImpact(selector, cssContent) {
  // Count occurrences
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const classPattern = new RegExp(`\\.${escapedSelector}(?![\\w-])`, 'g');
  const matches = cssContent.match(classPattern) || [];
  
  // Base impact: more occurrences = higher impact
  let impact = Math.min(matches.length * 10, 50);
  
  // Check for media queries using this selector (adds complexity)
  const mediaQueryPattern = new RegExp(`@media[^{]*{[^}]*\\.${escapedSelector}(?![\\w-])`, 'g');
  const mediaMatches = cssContent.match(mediaQueryPattern) || [];
  impact += mediaMatches.length * 15;
  
  // Cap at 100
  return Math.min(impact, 100);
}

/**
 * Analyze CSS selector usage
 * @param {string} projectRoot - Path to the project root
 * @returns {Array<Finding>} Array of findings for unused CSS selectors
 */
export function analyzeCSSSelectors(projectRoot) {
  const findings = [];
  
  // File paths
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  const htmlPath = path.join(projectRoot, 'public', 'index.html');
  const jsPath = path.join(projectRoot, 'public', 'app.js');
  
  // Read files
  let cssContent, htmlContent, jsContent;
  try {
    cssContent = fs.readFileSync(cssPath, 'utf-8');
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    jsContent = fs.readFileSync(jsPath, 'utf-8');
  } catch (error) {
    console.error('Error reading files:', error.message);
    return findings;
  }
  
  // Extract selectors from CSS
  const cssSelectors = extractCSSSelectors(cssContent);
  
  // Extract references from HTML
  const htmlRefs = extractHTMLReferences(htmlContent);
  
  // Extract dynamic classes from JavaScript
  const dynamicClasses = extractDynamicClasses(jsContent);
  
  // Combine all used classes
  const usedClasses = new Set([...htmlRefs.classes, ...dynamicClasses.classes]);
  
  // Combine all used IDs
  const usedIds = new Set(htmlRefs.ids);
  
  // Find unused class selectors
  cssSelectors.classes.forEach(className => {
    if (!usedClasses.has(className)) {
      const line = getSelectorLineNumber(cssContent, className, 'class');
      const severity = calculateSeverity(className, cssContent);
      const impact = calculateImpact(className, cssContent);
      
      findings.push(createFinding({
        category: 'dead-code',
        subcategory: 'unused-css-class',
        severity,
        effort: 'quick-win',
        impact,
        file: cssPath,
        line,
        description: `CSS class selector '.${className}' is defined but never used in HTML or JavaScript`,
        recommendation: `Remove the '.${className}' selector and its associated styles from styles.css`,
        codeSnippet: `.${className}`
      }));
    }
  });
  
  // Find unused ID selectors
  cssSelectors.ids.forEach(idName => {
    if (!usedIds.has(idName)) {
      const line = getSelectorLineNumber(cssContent, idName, 'id');
      const severity = 'minor'; // IDs are typically less complex
      const impact = 30; // Lower impact for single-use IDs
      
      findings.push(createFinding({
        category: 'dead-code',
        subcategory: 'unused-css-id',
        severity,
        effort: 'quick-win',
        impact,
        file: cssPath,
        line,
        description: `CSS ID selector '#${idName}' is defined but never used in HTML`,
        recommendation: `Remove the '#${idName}' selector and its associated styles from styles.css`,
        codeSnippet: `#${idName}`
      }));
    }
  });
  
  return findings;
}

/**
 * Generate a summary report of CSS selector analysis
 * @param {Array<Finding>} findings - Findings from CSS selector analysis
 * @returns {Object} Summary report
 */
export function generateCSSAnalysisSummary(findings) {
  const unusedClasses = findings.filter(f => f.subcategory === 'unused-css-class');
  const unusedIds = findings.filter(f => f.subcategory === 'unused-css-id');
  
  return {
    totalUnused: findings.length,
    unusedClasses: unusedClasses.length,
    unusedIds: unusedIds.length,
    totalImpact: findings.reduce((sum, f) => sum + f.impact, 0),
    averageImpact: findings.length > 0 
      ? Math.round(findings.reduce((sum, f) => sum + f.impact, 0) / findings.length)
      : 0,
    bySeverity: {
      critical: findings.filter(f => f.severity === 'critical').length,
      moderate: findings.filter(f => f.severity === 'moderate').length,
      minor: findings.filter(f => f.severity === 'minor').length
    }
  };
}

export default {
  analyzeCSSSelectors,
  generateCSSAnalysisSummary
};
