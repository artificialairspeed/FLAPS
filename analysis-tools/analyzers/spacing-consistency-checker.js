/**
 * Spacing Consistency Checker
 * 
 * Analyzes spacing consistency in styles.css:
 * - Identifies all margin and padding values
 * - Checks for inconsistent spacing units (px, rem, em mix)
 * - Finds non-standard spacing values (not multiples of 4px/0.25rem)
 * - Detects duplicate or very similar spacing values
 * - Suggests a consistent spacing scale
 * 
 * Requirements: 3.1, 3.4
 */

import fs from 'fs';
import path from 'path';
import { createFinding } from '../models.js';

/**
 * Standard spacing scale (multiples of 4px)
 */
const STANDARD_SPACING_SCALE = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 48, 64];

/**
 * Extract all spacing values from CSS content
 * @param {string} cssContent - Content of the CSS file
 * @returns {Array<Object>} Array of spacing value objects
 */
function extractSpacingValues(cssContent) {
  const spacingValues = [];
  const lines = cssContent.split('\n');
  
  // Properties to track
  const spacingProps = ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                        'gap', 'row-gap', 'column-gap'];
  
  lines.forEach((line, index) => {
    spacingProps.forEach(prop => {
      // Match property with value (handles shorthand and single values)
      // Pattern: property: value1 value2 value3 value4
      const pattern = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'gi');
      const matches = line.matchAll(pattern);
      
      for (const match of matches) {
        const valueString = match[1].trim();
        
        // Skip CSS variables and calculations
        if (valueString.includes('var(') || valueString.includes('calc(')) {
          continue;
        }
        
        // Extract individual values (for shorthand properties like margin: 10px 20px)
        const values = valueString.split(/\s+/);
        
        values.forEach(value => {
          // Parse the value
          const parsed = parseSpacingValue(value);
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

/**
 * Parse a spacing value into its numeric value and unit
 * @param {string} value - The spacing value (e.g., "10px", "1rem", "0.5em")
 * @returns {Object|null} Parsed value object or null if invalid
 */
function parseSpacingValue(value) {
  // Handle 0 without unit
  if (value === '0' || value === '0px') {
    return { numeric: 0, unit: 'px', original: value };
  }
  
  // Match number + unit pattern
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

/**
 * Convert spacing value to pixels for comparison
 * @param {Object} parsed - Parsed spacing value
 * @returns {number} Value in pixels
 */
function toPx(parsed) {
  if (parsed.unit === 'px') {
    return parsed.numeric;
  } else if (parsed.unit === 'rem') {
    // Assume 1rem = 16px (standard)
    return parsed.numeric * 16;
  } else if (parsed.unit === 'em') {
    // Assume 1em = 16px (standard)
    return parsed.numeric * 16;
  }
  return parsed.numeric;
}

/**
 * Check if a value is on the standard spacing scale
 * @param {number} pxValue - Value in pixels
 * @returns {boolean} True if on standard scale
 */
function isOnStandardScale(pxValue) {
  // Allow 1px tolerance for rounding
  return STANDARD_SPACING_SCALE.some(standard => Math.abs(pxValue - standard) <= 1);
}

/**
 * Get the closest standard spacing value
 * @param {number} pxValue - Value in pixels
 * @returns {number} Closest standard value
 */
function getClosestStandard(pxValue) {
  let closest = STANDARD_SPACING_SCALE[0];
  let minDiff = Math.abs(pxValue - closest);
  
  STANDARD_SPACING_SCALE.forEach(standard => {
    const diff = Math.abs(pxValue - standard);
    if (diff < minDiff) {
      minDiff = diff;
      closest = standard;
    }
  });
  
  return closest;
}

/**
 * Find inconsistent spacing units
 * @param {Array<Object>} spacingValues - All spacing values
 * @returns {Object} Statistics about unit usage
 */
function analyzeUnitConsistency(spacingValues) {
  const unitCounts = {};
  
  spacingValues.forEach(sv => {
    const unit = sv.parsed.unit;
    unitCounts[unit] = (unitCounts[unit] || 0) + 1;
  });
  
  return {
    units: unitCounts,
    isConsistent: Object.keys(unitCounts).length <= 1,
    dominantUnit: Object.entries(unitCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  };
}

/**
 * Find spacing values that are very similar (potential duplicates)
 * @param {Array<Object>} spacingValues - All spacing values
 * @returns {Array<Object>} Groups of similar values
 */
function findSimilarValues(spacingValues) {
  const similarGroups = [];
  const processed = new Set();
  
  spacingValues.forEach((sv1, i) => {
    if (processed.has(i)) return;
    
    const px1 = toPx(sv1.parsed);
    const similar = [sv1];
    
    spacingValues.forEach((sv2, j) => {
      if (i !== j && !processed.has(j)) {
        const px2 = toPx(sv2.parsed);
        // Consider similar if within 2px of each other
        if (Math.abs(px1 - px2) > 0 && Math.abs(px1 - px2) <= 2) {
          similar.push(sv2);
          processed.add(j);
        }
      }
    });
    
    if (similar.length > 1) {
      similarGroups.push({
        avgValue: px1,
        values: similar
      });
    }
    
    processed.add(i);
  });
  
  return similarGroups;
}

/**
 * Analyze spacing consistency in styles.css
 * @param {string} projectRoot - Path to the project root
 * @returns {Array<Finding>} Array of findings for spacing consistency issues
 */
export function analyzeSpacingConsistency(projectRoot) {
  const findings = [];
  
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  
  let cssContent;
  try {
    cssContent = fs.readFileSync(cssPath, 'utf-8');
  } catch (error) {
    console.error('Error reading CSS file:', error.message);
    return findings;
  }
  
  // Extract all spacing values
  const spacingValues = extractSpacingValues(cssContent);
  
  if (spacingValues.length === 0) {
    return findings;
  }
  
  // Analyze unit consistency
  const unitAnalysis = analyzeUnitConsistency(spacingValues);
  
  // Finding 1: Mixed spacing units
  if (!unitAnalysis.isConsistent) {
    const unitList = Object.entries(unitAnalysis.units)
      .map(([unit, count]) => `${count}× ${unit}`)
      .join(', ');
    
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'inconsistent-spacing-units',
      severity: 'moderate',
      effort: 'medium',
      impact: 65,
      file: cssPath,
      line: 1,
      description: `Inconsistent spacing units found: ${unitList}. Mixing different units makes it harder to maintain consistent spacing.`,
      recommendation: `Standardize all spacing to use ${unitAnalysis.dominantUnit} for consistency. Consider using a spacing scale with consistent units.`,
      codeSnippet: `Mixed units: ${unitList}`
    }));
  }
  
  // Finding 2: Non-standard spacing values
  const nonStandardValues = spacingValues.filter(sv => {
    const pxValue = toPx(sv.parsed);
    return pxValue > 0 && !isOnStandardScale(pxValue);
  });
  
  if (nonStandardValues.length > 0) {
    // Group by unique px values
    const uniqueNonStandard = {};
    nonStandardValues.forEach(sv => {
      const pxValue = toPx(sv.parsed);
      const key = Math.round(pxValue);
      if (!uniqueNonStandard[key]) {
        uniqueNonStandard[key] = [];
      }
      uniqueNonStandard[key].push(sv);
    });
    
    // Create findings for each non-standard value
    Object.entries(uniqueNonStandard).forEach(([pxValue, occurrences]) => {
      const px = parseFloat(pxValue);
      const closest = getClosestStandard(px);
      const exampleLine = occurrences[0].line;
      const exampleValue = occurrences[0].value;
      
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'non-standard-spacing',
        severity: 'minor',
        effort: 'quick-win',
        impact: 40,
        file: cssPath,
        line: exampleLine,
        description: `Non-standard spacing value ${exampleValue} (≈${px}px) found in ${occurrences.length} location(s). Not aligned with 4px spacing scale.`,
        recommendation: `Replace with ${closest}px to align with standard spacing scale. Found at: ${occurrences.slice(0, 3).map(o => `line ${o.line}`).join(', ')}${occurrences.length > 3 ? ` and ${occurrences.length - 3} more` : ''}.`,
        codeSnippet: occurrences[0].context
      }));
    });
  }
  
  // Finding 3: Similar values (potential duplicates)
  const similarGroups = findSimilarValues(spacingValues);
  
  similarGroups.forEach(group => {
    const values = group.values.map(v => v.value).filter((v, i, arr) => arr.indexOf(v) === i);
    const lines = group.values.slice(0, 3).map(v => v.line);
    
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'similar-spacing-values',
      severity: 'minor',
      effort: 'quick-win',
      impact: 35,
      file: cssPath,
      line: lines[0],
      description: `Very similar spacing values found: ${values.join(', ')}. These differ by only 1-2px and should likely be consolidated.`,
      recommendation: `Consolidate to a single standard value: ${getClosestStandard(group.avgValue)}px. Found at lines: ${lines.join(', ')}${group.values.length > 3 ? ` and ${group.values.length - 3} more` : ''}.`,
      codeSnippet: values.join(', ')
    }));
  });
  
  return findings;
}

/**
 * Generate a spacing analysis report
 * @param {Array<Object>} spacingValues - All spacing values
 * @returns {Object} Detailed spacing analysis report
 */
export function generateSpacingReport(spacingValues) {
  const unitCounts = {};
  const valueCounts = {};
  const nonStandard = [];
  
  spacingValues.forEach(sv => {
    // Count units
    unitCounts[sv.parsed.unit] = (unitCounts[sv.parsed.unit] || 0) + 1;
    
    // Count unique values
    const pxValue = Math.round(toPx(sv.parsed));
    valueCounts[pxValue] = (valueCounts[pxValue] || 0) + 1;
    
    // Track non-standard values
    if (pxValue > 0 && !isOnStandardScale(pxValue)) {
      nonStandard.push({ value: pxValue, line: sv.line });
    }
  });
  
  return {
    totalSpacingDeclarations: spacingValues.length,
    unitDistribution: unitCounts,
    uniqueValues: Object.keys(valueCounts).length,
    mostCommonValues: Object.entries(valueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value: `${value}px`, count })),
    nonStandardCount: nonStandard.length,
    standardSpacingScale: STANDARD_SPACING_SCALE.map(v => `${v}px`),
    recommendation: generateScaleRecommendation(valueCounts)
  };
}

/**
 * Generate recommended spacing scale based on actual usage
 * @param {Object} valueCounts - Count of each spacing value
 * @returns {string} Recommendation text
 */
function generateScaleRecommendation(valueCounts) {
  const usedStandard = STANDARD_SPACING_SCALE.filter(std => valueCounts[std] > 0);
  
  if (usedStandard.length >= 8) {
    return `Current usage shows good alignment with standard spacing scale. Focus on eliminating non-standard values.`;
  } else {
    return `Adopt a consistent spacing scale: ${STANDARD_SPACING_SCALE.slice(0, 12).join('px, ')}px. This will provide sufficient variety while maintaining consistency.`;
  }
}

/**
 * Write spacing analysis to JSON report
 * @param {string} projectRoot - Path to project root
 * @param {Array<Finding>} findings - Findings from analysis
 * @param {Object} report - Detailed spacing report
 */
export function writeSpacingReport(projectRoot, findings, report) {
  const reportPath = path.join(projectRoot, 'analysis-tools', 'reports', 'spacing-consistency-analysis.json');
  
  const fullReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFindings: findings.length,
      bySeverity: {
        critical: findings.filter(f => f.severity === 'critical').length,
        moderate: findings.filter(f => f.severity === 'moderate').length,
        minor: findings.filter(f => f.severity === 'minor').length
      },
      bySubcategory: {
        inconsistentUnits: findings.filter(f => f.subcategory === 'inconsistent-spacing-units').length,
        nonStandard: findings.filter(f => f.subcategory === 'non-standard-spacing').length,
        similar: findings.filter(f => f.subcategory === 'similar-spacing-values').length
      }
    },
    spacingAnalysis: report,
    findings: findings.map(f => ({
      id: f.id,
      subcategory: f.subcategory,
      severity: f.severity,
      effort: f.effort,
      impact: f.impact,
      line: f.line,
      description: f.description,
      recommendation: f.recommendation,
      codeSnippet: f.codeSnippet
    }))
  };
  
  try {
    fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
    console.log(`Spacing analysis report written to: ${reportPath}`);
  } catch (error) {
    console.error('Error writing spacing report:', error.message);
  }
}

export default {
  analyzeSpacingConsistency,
  generateSpacingReport,
  writeSpacingReport
};
