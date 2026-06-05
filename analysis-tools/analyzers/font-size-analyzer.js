/**
 * Font-Size Analyzer
 * 
 * Analyzes font-size usage in styles.css:
 * - Extracts all font-size declarations
 * - Checks for inconsistent units (px, rem, em mix)
 * - Identifies non-standard font sizes
 * - Finds very similar font sizes that should be consolidated
 * - Suggests a type scale (e.g., 12px, 14px, 16px, 18px, 24px, 32px)
 * - Checks for responsive typography patterns
 * 
 * Requirements: 3.3
 */

import fs from 'fs';
import path from 'path';
import { createFinding } from '../models.js';

/**
 * Recommended type scale based on common design systems
 * Using a modular scale approach with 4px increments for smaller sizes
 */
const RECOMMENDED_TYPE_SCALE = [9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48, 64];

/**
 * Tolerance for considering font sizes "similar" (in pixels)
 */
const SIMILARITY_THRESHOLD = 2;

/**
 * Parse font-size value and extract numeric value and unit
 * @param {string} value - Font-size value (e.g., "14px", "1.5rem", "clamp(...)")
 * @returns {Object|null} Object with { value: number, unit: string, original: string, isResponsive: boolean }
 */
function parseFontSize(value) {
  const trimmed = value.trim();
  
  // Check for responsive patterns (clamp, calc, var with calc)
  const isResponsive = /clamp\(|calc\(|min\(|max\(/i.test(trimmed);
  
  // Extract numeric value and unit for simple values
  const simpleMatch = trimmed.match(/^([0-9.]+)(px|rem|em|%)$/);
  if (simpleMatch) {
    return {
      value: parseFloat(simpleMatch[1]),
      unit: simpleMatch[2],
      original: trimmed,
      isResponsive: false
    };
  }
  
  // For complex values (clamp, calc, etc.), try to extract base values
  if (isResponsive) {
    // Extract all numeric values with units from the expression
    const values = [];
    const matches = trimmed.matchAll(/([0-9.]+)(px|rem|em|%)/g);
    for (const match of matches) {
      values.push({
        value: parseFloat(match[1]),
        unit: match[2]
      });
    }
    
    if (values.length > 0) {
      // Return the first value as representative, but mark as responsive
      return {
        value: values[0].value,
        unit: values[0].unit,
        original: trimmed,
        isResponsive: true,
        allValues: values
      };
    }
  }
  
  return null;
}

/**
 * Extract all font-size declarations from CSS content
 * @param {string} cssContent - Content of the CSS file
 * @returns {Array<Object>} Array of font-size declarations with context
 */
function extractFontSizes(cssContent) {
  const fontSizes = [];
  const lines = cssContent.split('\n');
  
  // Match font-size declarations
  // Pattern: font-size: value;
  const fontSizePattern = /font-size\s*:\s*([^;]+);/gi;
  
  let match;
  while ((match = fontSizePattern.exec(cssContent)) !== null) {
    const value = match[1].trim();
    const parsed = parseFontSize(value);
    
    if (parsed) {
      // Find line number
      const position = match.index;
      const beforeMatch = cssContent.substring(0, position);
      const lineNumber = beforeMatch.split('\n').length;
      
      // Extract selector context (look backward for the selector)
      let selector = 'unknown';
      for (let i = lineNumber - 1; i >= 0 && i < lines.length; i--) {
        const line = lines[i].trim();
        if (line.includes('{')) {
          // Found the opening brace, extract selector
          const selectorMatch = line.match(/([^{]+)\s*\{/);
          if (selectorMatch) {
            selector = selectorMatch[1].trim();
          }
          break;
        } else if (line && !line.includes(':')) {
          // This line might be part of the selector
          selector = line;
          break;
        }
      }
      
      fontSizes.push({
        ...parsed,
        line: lineNumber,
        selector,
        context: lines[lineNumber - 1]?.trim() || ''
      });
    }
  }
  
  return fontSizes;
}

/**
 * Analyze unit consistency across font-size declarations
 * @param {Array<Object>} fontSizes - Extracted font-size declarations
 * @returns {Object} Analysis of unit usage
 */
function analyzeUnitConsistency(fontSizes) {
  const unitCounts = {};
  const nonResponsive = fontSizes.filter(fs => !fs.isResponsive);
  
  nonResponsive.forEach(fs => {
    unitCounts[fs.unit] = (unitCounts[fs.unit] || 0) + 1;
  });
  
  const totalNonResponsive = nonResponsive.length;
  const units = Object.keys(unitCounts);
  
  return {
    unitCounts,
    totalNonResponsive,
    units,
    hasInconsistency: units.length > 1,
    dominantUnit: units.length > 0 
      ? units.reduce((a, b) => unitCounts[a] > unitCounts[b] ? a : b)
      : null
  };
}

/**
 * Convert font-size to pixels for comparison
 * Assumes 16px base font size for rem/em conversion
 * @param {Object} fontSize - Parsed font-size object
 * @returns {number} Size in pixels
 */
function toPx(fontSize) {
  switch (fontSize.unit) {
    case 'px':
      return fontSize.value;
    case 'rem':
    case 'em':
      return fontSize.value * 16;
    case '%':
      return (fontSize.value / 100) * 16;
    default:
      return fontSize.value;
  }
}

/**
 * Find font sizes that are very similar and should be consolidated
 * @param {Array<Object>} fontSizes - Extracted font-size declarations
 * @returns {Array<Array<Object>>} Groups of similar font sizes
 */
function findSimilarSizes(fontSizes) {
  const nonResponsive = fontSizes.filter(fs => !fs.isResponsive);
  const groups = [];
  const processed = new Set();
  
  for (let i = 0; i < nonResponsive.length; i++) {
    if (processed.has(i)) continue;
    
    const current = nonResponsive[i];
    const currentPx = toPx(current);
    const group = [current];
    processed.add(i);
    
    for (let j = i + 1; j < nonResponsive.length; j++) {
      if (processed.has(j)) continue;
      
      const other = nonResponsive[j];
      const otherPx = toPx(other);
      
      // Check if sizes are similar (within threshold)
      if (Math.abs(currentPx - otherPx) <= SIMILARITY_THRESHOLD && currentPx !== otherPx) {
        group.push(other);
        processed.add(j);
      }
    }
    
    // Only include groups with more than one item
    if (group.length > 1) {
      groups.push(group);
    }
  }
  
  return groups;
}

/**
 * Check if a font size matches the recommended type scale
 * @param {number} pxValue - Font size in pixels
 * @returns {boolean}
 */
function isOnTypeScale(pxValue) {
  return RECOMMENDED_TYPE_SCALE.some(size => Math.abs(size - pxValue) <= 0.5);
}

/**
 * Find the nearest recommended size on the type scale
 * @param {number} pxValue - Font size in pixels
 * @returns {number}
 */
function findNearestTypeScaleSize(pxValue) {
  return RECOMMENDED_TYPE_SCALE.reduce((nearest, size) => {
    return Math.abs(size - pxValue) < Math.abs(nearest - pxValue) ? size : nearest;
  });
}

/**
 * Get unique font sizes in pixels
 * @param {Array<Object>} fontSizes - Extracted font-size declarations
 * @returns {Array<number>} Sorted array of unique pixel values
 */
function getUniqueSizes(fontSizes) {
  const nonResponsive = fontSizes.filter(fs => !fs.isResponsive);
  const pxValues = nonResponsive.map(fs => toPx(fs));
  return [...new Set(pxValues)].sort((a, b) => a - b);
}

/**
 * Analyze font-size usage in styles.css
 * @param {string} projectRoot - Path to the project root
 * @returns {Array<Finding>} Array of findings for font-size issues
 */
export function analyzeFontSizes(projectRoot) {
  const findings = [];
  
  // File path
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  
  // Read file
  let cssContent;
  try {
    cssContent = fs.readFileSync(cssPath, 'utf-8');
  } catch (error) {
    console.error('Error reading CSS file:', error.message);
    return findings;
  }
  
  // Extract all font-size declarations
  const fontSizes = extractFontSizes(cssContent);
  
  if (fontSizes.length === 0) {
    return findings;
  }
  
  // Analyze unit consistency
  const unitAnalysis = analyzeUnitConsistency(fontSizes);
  
  // Finding 1: Inconsistent units
  if (unitAnalysis.hasInconsistency && unitAnalysis.units.length > 1) {
    const unitsDescription = Object.entries(unitAnalysis.unitCounts)
      .map(([unit, count]) => `${count} ${unit}`)
      .join(', ');
    
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'inconsistent-font-units',
      severity: 'moderate',
      effort: 'medium',
      impact: 60,
      file: cssPath,
      line: 1,
      description: `Inconsistent font-size units detected: ${unitsDescription}. Mixing units makes the design system harder to maintain.`,
      recommendation: `Standardize font-size declarations to use a single unit (preferably ${unitAnalysis.dominantUnit}) or use relative units (rem/em) for better accessibility and scalability.`,
      codeSnippet: `Mixed units: ${unitAnalysis.units.join(', ')}`
    }));
  }
  
  // Finding 2: Absolute pixel values that should be responsive
  const absolutePixelSizes = fontSizes.filter(fs => fs.unit === 'px' && !fs.isResponsive);
  
  if (absolutePixelSizes.length > 0) {
    // Group by selector for more useful reporting
    const largeAbsoluteSizes = absolutePixelSizes.filter(fs => fs.value >= 14);
    
    if (largeAbsoluteSizes.length > 0) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'absolute-font-sizes',
        severity: 'moderate',
        effort: 'medium',
        impact: 70,
        file: cssPath,
        line: largeAbsoluteSizes[0].line,
        description: `Found ${absolutePixelSizes.length} font-size declarations using absolute pixels. Absolute pixel values don't scale with user preferences or viewport size.`,
        recommendation: `Convert absolute font-size values to responsive units using clamp() for fluid typography (e.g., 'font-size: clamp(14px, 2vw, 18px)') or use rem units for better accessibility.`,
        codeSnippet: `Examples: ${largeAbsoluteSizes.slice(0, 3).map(fs => `${fs.selector}: ${fs.original}`).join('; ')}`
      }));
    }
  }
  
  // Finding 3: Similar font sizes that should be consolidated
  const similarGroups = findSimilarSizes(fontSizes);
  
  similarGroups.forEach(group => {
    const pxValues = group.map(fs => toPx(fs)).sort((a, b) => a - b);
    const minPx = pxValues[0];
    const maxPx = pxValues[pxValues.length - 1];
    const nearest = findNearestTypeScaleSize((minPx + maxPx) / 2);
    
    const selectors = group.map(fs => fs.selector).join(', ');
    const values = group.map(fs => `${fs.original} (${toPx(fs).toFixed(1)}px)`).join(', ');
    
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'similar-font-sizes',
      severity: 'minor',
      effort: 'quick-win',
      impact: 40,
      file: cssPath,
      line: group[0].line,
      description: `Found ${group.length} similar font sizes that differ by less than ${SIMILARITY_THRESHOLD}px: ${values}. These should likely be the same size for consistency.`,
      recommendation: `Consolidate these similar font sizes to a single value, preferably ${nearest}px (from recommended type scale).`,
      codeSnippet: `Affected selectors: ${selectors}`
    }));
  });
  
  // Finding 4: Non-standard font sizes (not on recommended type scale)
  const uniqueSizes = getUniqueSizes(fontSizes);
  const nonStandardSizes = uniqueSizes.filter(pxValue => !isOnTypeScale(pxValue));
  
  if (nonStandardSizes.length > 0) {
    const examples = nonStandardSizes.slice(0, 5).map(pxValue => {
      const nearest = findNearestTypeScaleSize(pxValue);
      return `${pxValue.toFixed(1)}px → ${nearest}px`;
    }).join(', ');
    
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'non-standard-font-sizes',
      severity: 'minor',
      effort: 'medium',
      impact: 50,
      file: cssPath,
      line: 1,
      description: `Found ${nonStandardSizes.length} font sizes that don't match the recommended type scale. A consistent type scale improves visual hierarchy and design coherence.`,
      recommendation: `Align font sizes to the recommended type scale: ${RECOMMENDED_TYPE_SCALE.join(', ')}px. Examples of suggested changes: ${examples}`,
      codeSnippet: `Non-standard sizes: ${nonStandardSizes.slice(0, 8).map(s => s.toFixed(1) + 'px').join(', ')}`
    }));
  }
  
  // Finding 5: Lack of responsive typography
  const responsiveSizes = fontSizes.filter(fs => fs.isResponsive);
  const responsivePercentage = (responsiveSizes.length / fontSizes.length) * 100;
  
  if (responsivePercentage < 20 && fontSizes.length >= 5) {
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'limited-responsive-typography',
      severity: 'moderate',
      effort: 'medium',
      impact: 65,
      file: cssPath,
      line: 1,
      description: `Only ${responsiveSizes.length} out of ${fontSizes.length} font-size declarations (${responsivePercentage.toFixed(1)}%) use responsive typography patterns. This limits adaptability across different viewport sizes.`,
      recommendation: `Increase use of responsive typography using clamp() for fluid scaling. Example: 'font-size: clamp(14px, 2vw, 18px)' creates font sizes that scale smoothly between min and max values based on viewport width.`,
      codeSnippet: `Responsive: ${responsiveSizes.length}/${fontSizes.length} (${responsivePercentage.toFixed(1)}%)`
    }));
  }
  
  return findings;
}

/**
 * Generate a detailed report of font-size analysis
 * @param {string} projectRoot - Path to the project root
 * @returns {Object} Detailed analysis report
 */
export function generateFontSizeReport(projectRoot) {
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  
  let cssContent;
  try {
    cssContent = fs.readFileSync(cssPath, 'utf-8');
  } catch (error) {
    return { error: error.message };
  }
  
  const fontSizes = extractFontSizes(cssContent);
  const unitAnalysis = analyzeUnitConsistency(fontSizes);
  const uniqueSizes = getUniqueSizes(fontSizes);
  const similarGroups = findSimilarSizes(fontSizes);
  const responsiveSizes = fontSizes.filter(fs => fs.isResponsive);
  
  const nonStandardSizes = uniqueSizes.filter(pxValue => !isOnTypeScale(pxValue));
  const standardSizes = uniqueSizes.filter(pxValue => isOnTypeScale(pxValue));
  
  return {
    summary: {
      totalDeclarations: fontSizes.length,
      uniqueSizes: uniqueSizes.length,
      responsiveDeclarations: responsiveSizes.length,
      responsivePercentage: ((responsiveSizes.length / fontSizes.length) * 100).toFixed(1) + '%'
    },
    units: {
      ...unitAnalysis,
      unitBreakdown: Object.entries(unitAnalysis.unitCounts).map(([unit, count]) => ({
        unit,
        count,
        percentage: ((count / unitAnalysis.totalNonResponsive) * 100).toFixed(1) + '%'
      }))
    },
    typeScale: {
      recommended: RECOMMENDED_TYPE_SCALE,
      current: uniqueSizes.map(px => Math.round(px)),
      onScale: standardSizes.length,
      offScale: nonStandardSizes.length,
      conformance: ((standardSizes.length / uniqueSizes.length) * 100).toFixed(1) + '%'
    },
    consolidation: {
      similarGroups: similarGroups.length,
      potentialReduction: similarGroups.reduce((sum, group) => sum + (group.length - 1), 0),
      groups: similarGroups.map(group => ({
        sizes: group.map(fs => fs.original),
        pxValues: group.map(fs => toPx(fs).toFixed(1) + 'px'),
        suggested: findNearestTypeScaleSize(toPx(group[0])) + 'px'
      }))
    },
    allDeclarations: fontSizes.map(fs => ({
      selector: fs.selector,
      value: fs.original,
      unit: fs.unit,
      isResponsive: fs.isResponsive,
      line: fs.line,
      pxEquivalent: fs.isResponsive ? 'varies' : toPx(fs).toFixed(1) + 'px'
    }))
  };
}

export default {
  analyzeFontSizes,
  generateFontSizeReport
};
