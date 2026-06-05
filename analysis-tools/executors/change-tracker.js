/**
 * Change Tracking System
 * Task 17.3: Create change tracking system
 * Requirements: 7.8, 7.9
 * 
 * Records all code changes made during the cleanup process, including before/after states
 * and impact analysis. Provides persistence, querying, and reporting capabilities.
 */

import { createChange } from '../models.js';
import * as fs from 'fs';
import * as path from 'path';

const CHANGES_DIR = path.join(process.cwd(), '.kiro', 'changes');
const CHANGES_DB_FILE = path.join(CHANGES_DIR, 'changes.json');

/**
 * Initialize the change tracking system
 * Creates necessary directories and database file if they don't exist
 */
export function initializeChangeTracker() {
  if (!fs.existsSync(CHANGES_DIR)) {
    fs.mkdirSync(CHANGES_DIR, { recursive: true });
  }

  if (!fs.existsSync(CHANGES_DB_FILE)) {
    fs.writeFileSync(CHANGES_DB_FILE, JSON.stringify({
      changes: [],
      metadata: {
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: '1.0.0'
      }
    }, null, 2), 'utf-8');
  }
}

/**
 * Load all changes from the database
 * @returns {Object} Database object with changes array and metadata
 */
export function loadChanges() {
  try {
    initializeChangeTracker();
    const content = fs.readFileSync(CHANGES_DB_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error loading changes:', error.message);
    return {
      changes: [],
      metadata: {
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: '1.0.0'
      }
    };
  }
}

/**
 * Save changes to the database
 * @param {Object} database - Database object with changes array and metadata
 */
export function saveChanges(database) {
  try {
    database.metadata.lastModified = new Date().toISOString();
    fs.writeFileSync(CHANGES_DB_FILE, JSON.stringify(database, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving changes:', error.message);
    throw error;
  }
}

/**
 * Record a change to the tracking system
 * @param {Object} changeParams - Parameters for creating a change record
 * @returns {Object} The created change record
 */
export function recordChange(changeParams) {
  const change = createChange(changeParams);
  const database = loadChanges();
  
  database.changes.push(change);
  saveChanges(database);
  
  return change;
}

/**
 * Record multiple changes in batch
 * @param {Object[]} changeParamsArray - Array of change parameters
 * @returns {Object[]} Array of created change records
 */
export function recordChanges(changeParamsArray) {
  const database = loadChanges();
  const newChanges = [];
  
  for (const params of changeParamsArray) {
    const change = createChange(params);
    database.changes.push(change);
    newChanges.push(change);
  }
  
  saveChanges(database);
  return newChanges;
}

/**
 * Mark a change as reverted
 * @param {string} changeId - ID of the change to revert
 * @param {string} reason - Reason for reversion
 * @returns {Object} Updated change record or null if not found
 */
export function revertChange(changeId, reason = '') {
  const database = loadChanges();
  const change = database.changes.find(c => c.id === changeId);
  
  if (!change) {
    return null;
  }
  
  change.reverted = true;
  change.revertReason = reason;
  change.revertedAt = new Date().toISOString();
  
  saveChanges(database);
  return change;
}

/**
 * Mark multiple changes as reverted
 * @param {string[]} changeIds - Array of change IDs to revert
 * @param {string} reason - Reason for reversion
 * @returns {Object[]} Array of reverted change records
 */
export function revertChanges(changeIds, reason = '') {
  const database = loadChanges();
  const reverted = [];
  
  for (const changeId of changeIds) {
    const change = database.changes.find(c => c.id === changeId);
    if (change) {
      change.reverted = true;
      change.revertReason = reason;
      change.revertedAt = new Date().toISOString();
      reverted.push(change);
    }
  }
  
  saveChanges(database);
  return reverted;
}

/**
 * Get all changes
 * @param {Object} options - Filter options
 * @param {boolean} options.includeReverted - Include reverted changes (default: true)
 * @returns {Object[]} Array of change records
 */
export function getAllChanges(options = {}) {
  const { includeReverted = true } = options;
  const database = loadChanges();
  
  if (includeReverted) {
    return database.changes;
  }
  
  return database.changes.filter(c => !c.reverted);
}

/**
 * Get changes by file
 * @param {string} filePath - File path to filter by
 * @param {Object} options - Filter options
 * @returns {Object[]} Array of change records for the specified file
 */
export function getChangesByFile(filePath, options = {}) {
  const { includeReverted = true } = options;
  const allChanges = getAllChanges({ includeReverted });
  
  return allChanges.filter(c => c.file === filePath);
}

/**
 * Get changes by type
 * @param {string} type - Change type ('removal', 'refactor', 'addition', 'style')
 * @param {Object} options - Filter options
 * @returns {Object[]} Array of change records of the specified type
 */
export function getChangesByType(type, options = {}) {
  const { includeReverted = true } = options;
  const allChanges = getAllChanges({ includeReverted });
  
  return allChanges.filter(c => c.type === type);
}

/**
 * Get changes by finding ID
 * @param {string} findingId - Finding ID to filter by
 * @returns {Object[]} Array of change records addressing the specified finding
 */
export function getChangesByFinding(findingId) {
  const allChanges = getAllChanges({ includeReverted: true });
  
  return allChanges.filter(c => c.findingIds.includes(findingId));
}

/**
 * Get changes within a time range
 * @param {string} startTime - ISO 8601 start timestamp
 * @param {string} endTime - ISO 8601 end timestamp
 * @returns {Object[]} Array of change records within the time range
 */
export function getChangesByTimeRange(startTime, endTime) {
  const allChanges = getAllChanges({ includeReverted: true });
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  return allChanges.filter(c => {
    const changeTime = new Date(c.timestamp);
    return changeTime >= start && changeTime <= end;
  });
}

/**
 * Get impact analysis for all changes
 * @returns {Object} Impact analysis with statistics and metrics
 */
export function getImpactAnalysis() {
  const allChanges = getAllChanges({ includeReverted: false });
  const allChangesIncludingReverted = getAllChanges({ includeReverted: true });
  
  // Group by file
  const fileImpact = {};
  allChanges.forEach(change => {
    if (!fileImpact[change.file]) {
      fileImpact[change.file] = {
        file: change.file,
        changeCount: 0,
        types: {},
        testsPassedAll: true,
        changes: []
      };
    }
    
    fileImpact[change.file].changeCount++;
    fileImpact[change.file].types[change.type] = (fileImpact[change.file].types[change.type] || 0) + 1;
    fileImpact[change.file].testsPassedAll = fileImpact[change.file].testsPassedAll && change.testsPassedAfter;
    fileImpact[change.file].changes.push(change);
  });
  
  // Group by type
  const typeStats = {
    removal: 0,
    refactor: 0,
    addition: 0,
    style: 0
  };
  
  allChanges.forEach(change => {
    if (typeStats.hasOwnProperty(change.type)) {
      typeStats[change.type]++;
    }
  });
  
  // Test success rate
  const testsPassedCount = allChanges.filter(c => c.testsPassedAfter).length;
  const testsFailedCount = allChanges.filter(c => !c.testsPassedAfter).length;
  const testSuccessRate = allChanges.length > 0 
    ? (testsPassedCount / allChanges.length * 100).toFixed(1) 
    : '0.0';
  
  // Revert rate
  const revertedCount = allChangesIncludingReverted.filter(c => c.reverted).length;
  const revertRate = allChangesIncludingReverted.length > 0
    ? (revertedCount / allChangesIncludingReverted.length * 100).toFixed(1)
    : '0.0';
  
  // Files affected
  const filesAffected = Object.keys(fileImpact);
  
  return {
    summary: {
      totalChanges: allChanges.length,
      totalChangesIncludingReverted: allChangesIncludingReverted.length,
      revertedChanges: revertedCount,
      revertRate: `${revertRate}%`,
      filesAffected: filesAffected.length,
      testSuccessRate: `${testSuccessRate}%`,
      testsPassedCount,
      testsFailedCount
    },
    byType: typeStats,
    byFile: fileImpact,
    filesAffected
  };
}

/**
 * Generate a detailed change report
 * @param {Object} options - Report options
 * @param {boolean} options.includeReverted - Include reverted changes
 * @param {boolean} options.includeSnippets - Include code snippets
 * @param {string} options.format - Output format ('json' or 'markdown')
 * @returns {string|Object} Formatted report
 */
export function generateChangeReport(options = {}) {
  const {
    includeReverted = true,
    includeSnippets = true,
    format = 'markdown'
  } = options;
  
  const changes = getAllChanges({ includeReverted });
  const impact = getImpactAnalysis();
  
  if (format === 'json') {
    return {
      impact,
      changes: changes.map(change => {
        if (!includeSnippets) {
          const { beforeSnippet, afterSnippet, ...rest } = change;
          return rest;
        }
        return change;
      })
    };
  }
  
  // Generate markdown report
  let report = '# Change Tracking Report\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  // Summary section
  report += '## Summary\n\n';
  report += `- **Total Changes**: ${impact.summary.totalChanges}\n`;
  report += `- **Total Changes (including reverted)**: ${impact.summary.totalChangesIncludingReverted}\n`;
  report += `- **Reverted Changes**: ${impact.summary.revertedChanges} (${impact.summary.revertRate})\n`;
  report += `- **Files Affected**: ${impact.summary.filesAffected}\n`;
  report += `- **Test Success Rate**: ${impact.summary.testSuccessRate}\n`;
  report += `- **Tests Passed**: ${impact.summary.testsPassedCount}\n`;
  report += `- **Tests Failed**: ${impact.summary.testsFailedCount}\n\n`;
  
  // Changes by type
  report += '## Changes by Type\n\n';
  report += `- **Removal**: ${impact.byType.removal}\n`;
  report += `- **Refactor**: ${impact.byType.refactor}\n`;
  report += `- **Addition**: ${impact.byType.addition}\n`;
  report += `- **Style**: ${impact.byType.style}\n\n`;
  
  // Changes by file
  report += '## Changes by File\n\n';
  impact.filesAffected.forEach(file => {
    const fileData = impact.byFile[file];
    report += `### ${file}\n\n`;
    report += `- **Change Count**: ${fileData.changeCount}\n`;
    report += `- **All Tests Passed**: ${fileData.testsPassedAll ? 'Yes' : 'No'}\n`;
    report += `- **Types**: ${Object.entries(fileData.types).map(([type, count]) => `${type}(${count})`).join(', ')}\n\n`;
  });
  
  // Detailed changes
  if (includeSnippets) {
    report += '## Detailed Changes\n\n';
    
    changes.forEach((change, index) => {
      report += `### Change ${index + 1}: ${change.id}\n\n`;
      report += `- **File**: ${change.file}\n`;
      report += `- **Type**: ${change.type}\n`;
      report += `- **Timestamp**: ${change.timestamp}\n`;
      report += `- **Tests Passed Before**: ${change.testsPassedBefore ? 'Yes' : 'No'}\n`;
      report += `- **Tests Passed After**: ${change.testsPassedAfter ? 'Yes' : 'No'}\n`;
      report += `- **Reverted**: ${change.reverted ? 'Yes' : 'No'}\n`;
      
      if (change.reverted && change.revertReason) {
        report += `- **Revert Reason**: ${change.revertReason}\n`;
      }
      
      report += `- **Finding IDs**: ${change.findingIds.join(', ')}\n`;
      report += `- **Rationale**: ${change.rationale}\n\n`;
      
      if (change.beforeSnippet) {
        report += '**Before:**\n\n';
        report += '```javascript\n';
        report += change.beforeSnippet;
        report += '\n```\n\n';
      }
      
      if (change.afterSnippet) {
        report += '**After:**\n\n';
        report += '```javascript\n';
        report += change.afterSnippet;
        report += '\n```\n\n';
      }
      
      report += '---\n\n';
    });
  }
  
  return report;
}

/**
 * Export changes to a file
 * @param {string} outputPath - Path to export file
 * @param {Object} options - Export options
 * @returns {Object} Result with success status
 */
export function exportChanges(outputPath, options = {}) {
  try {
    const report = generateChangeReport(options);
    
    if (options.format === 'json') {
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    } else {
      fs.writeFileSync(outputPath, report, 'utf-8');
    }
    
    return {
      success: true,
      outputPath,
      format: options.format || 'markdown'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Clear all changes from the database
 * WARNING: This is destructive and cannot be undone
 * @returns {Object} Result with success status
 */
export function clearAllChanges() {
  try {
    const database = {
      changes: [],
      metadata: {
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: '1.0.0'
      }
    };
    
    saveChanges(database);
    
    return {
      success: true,
      message: 'All changes cleared from database'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get statistics about changes
 * @returns {Object} Statistics object with various metrics
 */
export function getChangeStatistics() {
  const allChanges = getAllChanges({ includeReverted: true });
  const activeChanges = getAllChanges({ includeReverted: false });
  
  // Time range
  let earliestChange = null;
  let latestChange = null;
  
  if (allChanges.length > 0) {
    const sortedByTime = [...allChanges].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
    earliestChange = sortedByTime[0].timestamp;
    latestChange = sortedByTime[sortedByTime.length - 1].timestamp;
  }
  
  // Finding coverage
  const findingIds = new Set();
  allChanges.forEach(change => {
    change.findingIds.forEach(id => findingIds.add(id));
  });
  
  return {
    totalChanges: allChanges.length,
    activeChanges: activeChanges.length,
    revertedChanges: allChanges.length - activeChanges.length,
    uniqueFindingsAddressed: findingIds.size,
    timeRange: {
      earliest: earliestChange,
      latest: latestChange
    },
    averageChangesPerFile: activeChanges.length > 0 
      ? (activeChanges.length / new Set(activeChanges.map(c => c.file)).size).toFixed(2)
      : 0
  };
}
