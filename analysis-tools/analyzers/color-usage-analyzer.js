/**
 * Color Usage Analyzer
 * 
 * Analyzes color usage in styles.css:
 * - Extract all color values (hex, rgb, rgba, named colors)
 * - Identify duplicate or very similar colors (within color distance threshold)
 * - Check for inconsistent color formats
 * - Detect hardcoded colors that should use CSS variables
 * - Suggest color palette consolidation
 * - Check contrast ratios for accessibility
 * 
 * Requirements: 3.2
 */

import fs from 'fs';
import path from 'path';
import { createFinding } from '../models.js';

/**
 * Convert color to RGB array
 * @param {string} color - Color in any format
 * @returns {number[]|null} RGB array [r, g, b] or null if invalid
 */
function colorToRGB(color) {
  // Hex colors: #RGB or #RRGGBB
  const hexMatch = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return [r, g, b];
  }
  
  // RGB/RGBA: rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+)?\s*\)/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }
  
  // Named colors (common ones)
  const namedColors = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    cyan: [0, 255, 255],
    magenta: [255, 0, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    transparent: [0, 0, 0] // Special case
  };
  
  const lowerColor = color.toLowerCase();
  if (namedColors[lowerColor]) {
    return namedColors[lowerColor];
  }
  
  return null;
}

/**
 * Calculate Euclidean distance between two RGB colors
 * @param {number[]} rgb1 - First RGB array
 * @param {number[]} rgb2 - Second RGB array
 * @returns {number} Distance
 */
function colorDistance(rgb1, rgb2) {
  const rDiff = rgb1[0] - rgb2[0];
  const gDiff = rgb1[1] - rgb2[1];
  const bDiff = rgb1[2] - rgb2[2];
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

/**
 * Calculate relative luminance for contrast ratio
 * @param {number[]} rgb - RGB array
 * @returns {number} Relative luminance
 */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(val => {
    const sRGB = val / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors
 * @param {number[]} rgb1 - First RGB array
 * @param {number[]} rgb2 - Second RGB array
 * @returns {number} Contrast ratio
 */
function contrastRatio(rgb1, rgb2) {
  const lum1 = relativeLuminance(rgb1);
  const lum2 = relativeLuminance(rgb2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Extract all color values from CSS content
 * @param {string} cssContent - Content of the CSS file
 * @returns {Array} Array of color objects with value, line, and context
 */
function extractColors(cssContent) {
  const colors = [];
  const lines = cssContent.split('\n');
  
  // Patterns to match colors
  const hexPattern = /#[0-9a-fA-F]{3,6}\b/gi;
  const rgbPattern = /rgba?\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+)?\s*\)/gi;
  const namedPattern = /\b(white|black|red|green|blue|yellow|cyan|magenta|gray|grey|transparent)\b/gi;
  
  lines.forEach((line, index) => {
    // Skip CSS variable definitions (these are OK)
    if (line.trim().startsWith('--')) {
      return;
    }
    
    // Skip comments
    if (line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      return;
    }
    
    // Extract hex colors
    let match;
    const hexMatches = line.matchAll(hexPattern);
    for (match of hexMatches) {
      colors.push({
        value: match[0],
        line: index + 1,
        type: 'hex',
        context: line.trim()
      });
    }
    
    // Extract RGB/RGBA colors
    const rgbMatches = line.matchAll(rgbPattern);
    for (match of rgbMatches) {
      colors.push({
        value: match[0],
        line: index + 1,
        type: 'rgb',
        context: line.trim()
      });
    }
    
    // Extract named colors (but not in var() or custom property contexts)
    if (!line.includes('var(--') && !line.trim().startsWith('--')) {
      const namedMatches = line.matchAll(namedPattern);
      for (match of namedMatches) {
        // Skip if it's part of a property name or class name
        const beforeChar = line[match.index - 1];
        const afterChar = line[match.index + match[0].length];
        if (beforeChar !== '-' && beforeChar !== '.' && afterChar !== '-') {
          colors.push({
            value: match[0],
            line: index + 1,
            type: 'named',
            context: line.trim()
          });
        }
      }
    }
  });
  
  return colors;
}

/**
 * Extract CSS custom properties (variables)
 * @param {string} cssContent - Content of the CSS file
 * @returns {Object} Map of variable names to their values
 */
function extractCSSVariables(cssContent) {
  const variables = {};
  const lines = cssContent.split('\n');
  
  lines.forEach(line => {
    const match = line.match(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/);
    if (match) {
      variables[match[1]] = match[2].trim();
    }
  });
  
  return variables;
}

/**
 * Analyze color usage in styles.css
 * @param {string} projectRoot - Path to the project root
 * @returns {Object} Analysis results with findings and color palette
 */
export function analyzeColorUsage(projectRoot) {
  const findings = [];
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  
  // Read CSS file
  let cssContent;
  try {
    cssContent = fs.readFileSync(cssPath, 'utf-8');
  } catch (error) {
    console.error('Error reading styles.css:', error.message);
    return { findings, colorPalette: {} };
  }
  
  // Extract colors and CSS variables
  const colors = extractColors(cssContent);
  const cssVars = extractCSSVariables(cssContent);
  
  // Track unique colors for palette analysis
  const colorPalette = new Map();
  
  // 1. Check for hardcoded colors that should use CSS variables
  colors.forEach(colorObj => {
    const rgb = colorToRGB(colorObj.value);
    if (!rgb) return;
    
    // Check if this color matches any CSS variable
    let matchesVariable = false;
    for (const [varName, varValue] of Object.entries(cssVars)) {
      const varRgb = colorToRGB(varValue);
      if (varRgb && colorDistance(rgb, varRgb) < 10) { // Very similar
        matchesVariable = true;
        break;
      }
    }
    
    // If it doesn't match a variable, it's a hardcoded color
    if (!matchesVariable) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'hardcoded-color',
        severity: 'minor',
        effort: 'quick-win',
        impact: 40,
        file: cssPath,
        line: colorObj.line,
        description: `Hardcoded color '${colorObj.value}' should use a CSS custom property from the theme`,
        recommendation: `Replace with an appropriate var(--*) reference from the color theme`,
        codeSnippet: colorObj.context
      }));
    }
    
    // Track for palette analysis
    const colorKey = colorObj.value.toLowerCase();
    if (!colorPalette.has(colorKey)) {
      colorPalette.set(colorKey, {
        value: colorObj.value,
        rgb,
        occurrences: []
      });
    }
    colorPalette.get(colorKey).occurrences.push(colorObj.line);
  });
  
  // 2. Check for duplicate or very similar colors
  const colorArray = Array.from(colorPalette.values());
  for (let i = 0; i < colorArray.length; i++) {
    for (let j = i + 1; j < colorArray.length; j++) {
      const color1 = colorArray[i];
      const color2 = colorArray[j];
      
      if (!color1.rgb || !color2.rgb) continue;
      
      const distance = colorDistance(color1.rgb, color2.rgb);
      
      // Colors are very similar (threshold: 30 on RGB distance)
      if (distance < 30 && distance > 0) {
        findings.push(createFinding({
          category: 'visual',
          subcategory: 'similar-colors',
          severity: 'minor',
          effort: 'medium',
          impact: 35,
          file: cssPath,
          line: color1.occurrences[0],
          description: `Colors '${color1.value}' and '${color2.value}' are very similar (distance: ${distance.toFixed(1)})`,
          recommendation: `Consider consolidating these colors into a single value or CSS variable`,
          codeSnippet: `${color1.value} ≈ ${color2.value}`
        }));
      }
    }
  }
  
  // 3. Check for inconsistent color formats
  const formatCounts = {
    hex: colors.filter(c => c.type === 'hex').length,
    rgb: colors.filter(c => c.type === 'rgb').length,
    named: colors.filter(c => c.type === 'named').length
  };
  
  if (formatCounts.hex > 0 && formatCounts.rgb > 0) {
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'inconsistent-color-format',
      severity: 'minor',
      effort: 'quick-win',
      impact: 25,
      file: cssPath,
      line: 1,
      description: `Inconsistent color formats: ${formatCounts.hex} hex, ${formatCounts.rgb} rgb/rgba, ${formatCounts.named} named colors`,
      recommendation: `Standardize to a single format (preferably hex for brevity or CSS variables)`,
      codeSnippet: 'Multiple color formats in use'
    }));
  }
  
  // 4. Check contrast ratios for accessibility
  // Get background color (assuming --bg is the main background)
  const bgColor = cssVars['--bg'];
  const bgRgb = bgColor ? colorToRGB(bgColor) : null;
  
  // Get text color (assuming --text is the main text color)
  const textColor = cssVars['--text'];
  const textRgb = textColor ? colorToRGB(textColor) : null;
  
  if (bgRgb && textRgb) {
    const contrast = contrastRatio(bgRgb, textRgb);
    
    // WCAG AA requires 4.5:1 for normal text, 3:1 for large text
    // WCAG AAA requires 7:1 for normal text, 4.5:1 for large text
    if (contrast < 4.5) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'poor-contrast',
        severity: 'moderate',
        effort: 'medium',
        impact: 70,
        file: cssPath,
        line: 1,
        description: `Background (--bg) and text (--text) contrast ratio is ${contrast.toFixed(2)}:1, below WCAG AA standard (4.5:1)`,
        recommendation: `Increase contrast between background and text colors to meet accessibility standards`,
        codeSnippet: `--bg:${bgColor}; --text:${textColor}`
      }));
    } else if (contrast < 7) {
      findings.push(createFinding({
        category: 'visual',
        subcategory: 'suboptimal-contrast',
        severity: 'minor',
        effort: 'medium',
        impact: 40,
        file: cssPath,
        line: 1,
        description: `Background and text contrast ratio is ${contrast.toFixed(2)}:1, meets WCAG AA but not AAA standard (7:1)`,
        recommendation: `Consider increasing contrast to meet WCAG AAA standards for better accessibility`,
        codeSnippet: `--bg:${bgColor}; --text:${textColor}`
      }));
    }
  }
  
  // 5. Color palette consolidation suggestions
  if (colorPalette.size > 20) {
    findings.push(createFinding({
      category: 'visual',
      subcategory: 'color-palette-complexity',
      severity: 'minor',
      effort: 'complex',
      impact: 50,
      file: cssPath,
      line: 1,
      description: `Color palette contains ${colorPalette.size} unique colors, which may be excessive`,
      recommendation: `Review color palette and consolidate similar colors to simplify the design system`,
      codeSnippet: `${colorPalette.size} unique colors in use`
    }));
  }
  
  return {
    findings,
    colorPalette: Object.fromEntries(colorPalette)
  };
}

/**
 * Generate a detailed color analysis report
 * @param {string} projectRoot - Path to the project root
 * @returns {Object} Detailed report with color statistics and findings
 */
export function generateColorAnalysisReport(projectRoot) {
  const { findings, colorPalette } = analyzeColorUsage(projectRoot);
  
  const cssPath = path.join(projectRoot, 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');
  const colors = extractColors(cssContent);
  const cssVars = extractCSSVariables(cssContent);
  
  // Group colors by type
  const colorsByType = {
    hex: colors.filter(c => c.type === 'hex'),
    rgb: colors.filter(c => c.type === 'rgb'),
    named: colors.filter(c => c.type === 'named')
  };
  
  // Calculate statistics
  const report = {
    summary: {
      totalColors: colors.length,
      uniqueColors: Object.keys(colorPalette).length,
      cssVariables: Object.keys(cssVars).length,
      hardcodedColors: findings.filter(f => f.subcategory === 'hardcoded-color').length,
      formatInconsistencies: findings.filter(f => f.subcategory === 'inconsistent-color-format').length,
      similarColors: findings.filter(f => f.subcategory === 'similar-colors').length,
      contrastIssues: findings.filter(f => 
        f.subcategory === 'poor-contrast' || f.subcategory === 'suboptimal-contrast'
      ).length
    },
    colorsByType: {
      hex: colorsByType.hex.length,
      rgb: colorsByType.rgb.length,
      named: colorsByType.named.length
    },
    cssVariables: cssVars,
    colorPalette,
    findings,
    timestamp: new Date().toISOString()
  };
  
  return report;
}

export default {
  analyzeColorUsage,
  generateColorAnalysisReport
};
