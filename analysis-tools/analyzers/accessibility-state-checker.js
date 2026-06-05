/**
 * Accessibility State Checker
 * 
 * Parses styles.css and index.html to check accessibility-related CSS states:
 * - Check for :focus styles on interactive elements
 * - Verify :hover has corresponding :focus
 * - Identify missing ARIA-related CSS
 * - Check for visibility of focus indicators
 * - Verify disabled state styling
 * 
 * Requirements: 3.6
 */

import fs from 'fs';
import path from 'path';
import { createFinding } from '../models.js';

/**
 * Extract interactive elements from HTML
 * @param {string} htmlContent - Content of the HTML file
 * @returns {Object} Object containing interactive elements with their selectors
 */
function extractInteractiveElements(htmlContent) {
  const elements = {
    buttons: new Set(),
    links: new Set(),
    inputs: new Set(),
    textareas: new Set(),
    selects: new Set()
  };
  
  // Extract button elements with id or class
  const buttonMatches = htmlContent.matchAll(/<button[^>]*(?:id\s*=\s*["']([^"']+)["']|class\s*=\s*["']([^"']+)["'])[^>]*>/gi);
  for (const match of buttonMatches) {
    const id = match[1];
    const classes = match[2] ? match[2].split(/\s+/) : [];
    if (id) elements.buttons.add(`#${id}`);
    classes.forEach(c => elements.buttons.add(`.${c}`));
  }
  
  // Extract anchor elements with id or class
  const linkMatches = htmlContent.matchAll(/<a[^>]*(?:id\s*=\s*["']([^"']+)["']|class\s*=\s*["']([^"']+)["'])[^>]*>/gi);
  for (const match of linkMatches) {
    const id = match[1];
    const classes = match[2] ? match[2].split(/\s+/) : [];
    if (id) elements.links.add(`#${id}`);
    classes.forEach(c => elements.links.add(`.${c}`));
  }
  
  // Extract input elements with id or class
  const inputMatches = htmlContent.matchAll(/<input[^>]*(?:id\s*=\s*["']([^"']+)["']|class\s*=\s*["']([^"']+)["'])[^>]*>/gi);
  for (const match of inputMatches) {
    const id = match[1];
    const classes = match[2] ? match[2].split(/\s+/) : [];
    if (id) elements.inputs.add(`#${id}`);
    classes.forEach(c => elements.inputs.add(`.${c}`));
  }
  
  // Extract textarea elements with id or class
  const textareaMatches = htmlContent.matchAll(/<textarea[^>]*(?:id\s*=\s*["']([^"']+)["']|class\s*=\s*["']([^"']+)["'])[^>]*>/gi);
  for (const match of textareaMatches) {
    const id = match[1];
    const classes = match[2] ? match[2].split(/\s+/) : [];
    if (id) elements.textareas.add(`#${id}`);
    classes.forEach(c => elements.textareas.add(`.${c}`));
  }
  
  // Extract select elements with id or class
  const selectMatches = htmlContent.matchAll(/<select[^>]*(?:id\s*=\s*["']([^"']+)["']|class\s*=\s*["']([^"']+)["'])[^>]*>/gi);
  for (const match of selectMatches) {
    const id = match[1];
    const classes = match[2] ? match[2].split(/\s+/) : [];
    if (id) elements.selects.add(`#${id}`);
    classes.forEach(c => elements.selects.add(`.${c}`));
  }
  
  return {
    buttons: Array.from(elements.buttons),
    links: Array.from(elements.links),
    inputs: Array.from(elements.inputs),
    textareas: Array.from(elements.textareas),
    selects: Array.from(elements.selects)
  };
}

/**
 * Extract all pseudo-class states from CSS
 * @param {string} cssContent - Content of the CSS file
 * @returns {Object} Object containing selectors with different pseudo-classes
 */
function extractPseudoClassStates(cssContent) {
  const states = {
    hover: new Set(),
    focus: new Set(),
    focusVisible: new Set(),
    active: new Set(),
    disabled: new Set()
  };
  
  // Remove comments
  const cleanedCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Extract :hover selectors
  const hoverMatches = cleanedCss.matchAll(/([.#][\w-]+):hover/g);
  for (const match of hoverMatches) {
    states.hover.add(match[1]);
  }
  
  // Extract :focus selectors
  const focusMatches = cleanedCss.matchAll(/([.#][\w-]+):focus(?![a-z-])/g);
  for (const match of focusMatches) {
    states.focus.add(match[1]);
  }
  
  // Extract :focus-visible selectors
  const focusVisibleMatches = cleanedCss.matchAll(/([.#][\w-]+):focus-visible/g);
  for (const match of focusVisibleMatches) {
    states.focusVisible.add(match[1]);
  }
  
  // Extract :active selectors
  const activeMatches = cleanedCss.matchAll(/([.#][\w-]+):active/g);
  for (const match of activeMatches) {
    states.active.add(match[1]);
  }
  
  // Extract :disabled selectors
  const disabledMatches = cleanedCss.matchAll(/([.#][\w-]+):disabled/g);
  for (const match of disabledMatches) {
    states.disabled.add(match[1]);
  }
  
  // Also check for generic element type selectors (button:hover, a:focus, etc.)
  const genericHover = cleanedCss.matchAll(/\b(button|a|input|textarea|select):hover/g);
  for (const match of genericHover) {
    states.hover.add(match[1]);
  }
  
  const genericFocus = cleanedCss.matchAll(/\b(button|a|input|textarea|select):focus(?![a-z-])/g);
  for (const match of genericFocus) {
    states.focus.add(match[1]);
  }
  
  const genericFocusVisible = cleanedCss.matchAll(/\b(button|a|input|textarea|select):focus-visible/g);
  for (const match of genericFocusVisible) {
    states.focusVisible.add(match[1]);
  }
  
  const genericActive = cleanedCss.matchAll(/\b(button|a|input|textarea|select):active/g);
  for (const match of genericActive) {
    states.active.add(match[1]);
  }
  
  const genericDisabled = cleanedCss.matchAll(/\b(button|input|textarea|select):disabled/g);
  for (const match of genericDisabled) {
    states.disabled.add(match[1]);
  }
  
  return {
    hover: Array.from(states.hover),
    focus: Array.from(states.focus),
    focusVisible: Array.from(states.focusVisible),
    active: Array.from(states.active),
    disabled: Array.from(states.disabled)
  };
}

/**
 * Check if focus indicator is visible (has non-zero outline or border)
 * @param {string} cssContent - Content of the CSS file
 * @param {string} selector - The selector to check
 * @returns {boolean} True if focus indicator is likely visible
 */
function hasFocusIndicator(cssContent, selector) {
  // Look for the selector with :focus or :focus-visible
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const focusPattern = new RegExp(`${escapedSelector}:(?:focus|focus-visible)[^{]*\\{([^}]+)\\}`, 'g');
  const matches = cssContent.match(focusPattern);
  
  if (!matches) return false;
  
  // Check if the matched rules contain outline or border properties
  for (const match of matches) {
    // Check for outline (but not outline:none or outline:0)
    if (/outline\s*:[^;}]*(?!none|0)[^;}]+/i.test(match)) {
      return true;
    }
    // Check for border changes
    if (/border(?:-\w+)?\s*:[^;}]*(?!none|0)[^;}]+/i.test(match)) {
      return true;
    }
    // Check for box-shadow (can be used as focus indicator)
    if (/box-shadow\s*:[^;}]*(?!none)[^;}]+/i.test(match)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if element type has generic styles
 * @param {string} cssContent - Content of the CSS file
 * @param {string} elementType - The element type (button, a, input, etc.)
 * @param {string} state - The state to check (hover, focus, etc.)
 * @returns {boolean} True if generic style exists
 */
function hasGenericState(cssContent, elementType, state) {
  const pattern = new RegExp(`\\b${elementType}:${state}(?![a-z-])`, 'i');
  return pattern.test(cssContent);
}

/**
 * Get selector base without pseudo-classes
 * @param {string} selector - The full selector
 * @returns {string} Base selector
 */
function getBaseSelector(selector) {
  return selector.split(':')[0];
}

/**
 * Analyze accessibility states in CSS
 * @param {string} projectRoot - Path to the project root
 * @returns {Array<Finding>} Array of findings for accessibility issues
 */
export function analyzeAccessibilityStates(projectRoot) {
  const findings = [];
  
  // File paths
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  const htmlPath = path.join(projectRoot, 'public', 'index.html');
  
  // Read files
  let cssContent, htmlContent;
  try {
    cssContent = fs.readFileSync(cssPath, 'utf-8');
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  } catch (error) {
    console.error('Error reading files:', error.message);
    return findings;
  }
  
  // Extract interactive elements
  const interactiveElements = extractInteractiveElements(htmlContent);
  
  // Extract pseudo-class states
  const states = extractPseudoClassStates(cssContent);
  
  // Check each button for accessibility states
  interactiveElements.buttons.forEach(selector => {
    const hasHover = states.hover.includes(selector) || hasGenericState(cssContent, 'button', 'hover');
    const hasFocus = states.focus.includes(selector) || states.focusVisible.includes(selector) || 
                     hasGenericState(cssContent, 'button', 'focus') || hasGenericState(cssContent, 'button', 'focus-visible');
    const hasActive = states.active.includes(selector) || hasGenericState(cssContent, 'button', 'active');
    
    // Check if :hover exists but :focus doesn't
    if (hasHover && !hasFocus) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'missing-focus-state',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 70,
        file: cssPath,
        line: 1,
        description: `Button selector '${selector}' has :hover state but missing :focus state for keyboard accessibility`,
        recommendation: `Add a :focus or :focus-visible style for '${selector}' that mirrors or enhances the :hover state`,
        codeSnippet: selector
      }));
    }
    
    // Check if focus indicator is visible
    if (hasFocus && !hasFocusIndicator(cssContent, selector) && !hasFocusIndicator(cssContent, 'button')) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'invisible-focus-indicator',
        severity: 'critical',
        effort: 'quick-win',
        impact: 85,
        file: cssPath,
        line: 1,
        description: `Button selector '${selector}' has :focus state but no visible focus indicator (outline, border, or box-shadow)`,
        recommendation: `Add a visible outline, border, or box-shadow to the :focus state of '${selector}'`,
        codeSnippet: selector
      }));
    }
  });
  
  // Check each link for accessibility states
  interactiveElements.links.forEach(selector => {
    const hasHover = states.hover.includes(selector) || hasGenericState(cssContent, 'a', 'hover');
    const hasFocus = states.focus.includes(selector) || states.focusVisible.includes(selector) || 
                     hasGenericState(cssContent, 'a', 'focus') || hasGenericState(cssContent, 'a', 'focus-visible');
    
    // Check if :hover exists but :focus doesn't
    if (hasHover && !hasFocus) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'missing-focus-state',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 70,
        file: cssPath,
        line: 1,
        description: `Link selector '${selector}' has :hover state but missing :focus state for keyboard accessibility`,
        recommendation: `Add a :focus or :focus-visible style for '${selector}' that mirrors or enhances the :hover state`,
        codeSnippet: selector
      }));
    }
    
    // Check if focus indicator is visible
    if (hasFocus && !hasFocusIndicator(cssContent, selector) && !hasFocusIndicator(cssContent, 'a')) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'invisible-focus-indicator',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 75,
        file: cssPath,
        line: 1,
        description: `Link selector '${selector}' has :focus state but no visible focus indicator (outline, border, or box-shadow)`,
        recommendation: `Add a visible outline, border, or box-shadow to the :focus state of '${selector}'`,
        codeSnippet: selector
      }));
    }
  });
  
  // Check inputs for focus states
  [...interactiveElements.inputs, ...interactiveElements.textareas, ...interactiveElements.selects].forEach(selector => {
    const elementType = interactiveElements.inputs.includes(selector) ? 'input' : 
                       interactiveElements.textareas.includes(selector) ? 'textarea' : 'select';
    const hasFocus = states.focus.includes(selector) || states.focusVisible.includes(selector) || 
                     hasGenericState(cssContent, elementType, 'focus') || hasGenericState(cssContent, elementType, 'focus-visible');
    
    if (!hasFocus) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'missing-focus-state',
        severity: 'moderate',
        effort: 'quick-win',
        impact: 65,
        file: cssPath,
        line: 1,
        description: `Input selector '${selector}' is missing :focus state for keyboard accessibility`,
        recommendation: `Add a :focus or :focus-visible style for '${selector}' to indicate when the input has keyboard focus`,
        codeSnippet: selector
      }));
    }
  });
  
  // Check for ARIA-related CSS (optional but good practice)
  const hasAriaHidden = /\[aria-hidden["']?=["']?true["']?\]/i.test(cssContent);
  const hasAriaDisabled = /\[aria-disabled["']?=["']?true["']?\]/i.test(cssContent);
  const hasAriaExpanded = /\[aria-expanded\]/i.test(cssContent);
  
  // If HTML uses aria attributes but CSS doesn't style them, that's a finding
  if (htmlContent.includes('aria-hidden') && !hasAriaHidden) {
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'missing-aria-css',
      severity: 'minor',
      effort: 'quick-win',
      impact: 40,
      file: cssPath,
      line: 1,
      description: `HTML uses aria-hidden attribute but CSS doesn't include [aria-hidden="true"] selector for styling`,
      recommendation: `Consider adding CSS rules for [aria-hidden="true"] to ensure proper visual treatment`,
      codeSnippet: '[aria-hidden="true"]'
    }));
  }
  
  // Check for disabled state styling on inputs
  const inputsNeedDisabled = [...interactiveElements.inputs, ...interactiveElements.textareas, ...interactiveElements.selects];
  if (inputsNeedDisabled.length > 0) {
    const hasGenericDisabled = hasGenericState(cssContent, 'input', 'disabled') || 
                               hasGenericState(cssContent, 'textarea', 'disabled') || 
                               hasGenericState(cssContent, 'select', 'disabled');
    
    if (!hasGenericDisabled && states.disabled.length === 0) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'missing-disabled-state',
        severity: 'minor',
        effort: 'quick-win',
        impact: 50,
        file: cssPath,
        line: 1,
        description: `Form inputs are missing :disabled state styling`,
        recommendation: `Add :disabled pseudo-class styles for input, textarea, and select elements to visually indicate disabled state`,
        codeSnippet: 'input:disabled, textarea:disabled, select:disabled'
      }));
    }
  }
  
  return findings;
}

/**
 * Generate a summary report of accessibility state analysis
 * @param {Array<Finding>} findings - Findings from accessibility state analysis
 * @returns {Object} Summary report
 */
export function generateAccessibilityStateSummary(findings) {
  const missingFocus = findings.filter(f => f.subcategory === 'missing-focus-state');
  const invisibleIndicators = findings.filter(f => f.subcategory === 'invisible-focus-indicator');
  const missingAria = findings.filter(f => f.subcategory === 'missing-aria-css');
  const missingDisabled = findings.filter(f => f.subcategory === 'missing-disabled-state');
  
  return {
    totalIssues: findings.length,
    missingFocusStates: missingFocus.length,
    invisibleFocusIndicators: invisibleIndicators.length,
    missingAriaCss: missingAria.length,
    missingDisabledStates: missingDisabled.length,
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
  analyzeAccessibilityStates,
  generateAccessibilityStateSummary
};
