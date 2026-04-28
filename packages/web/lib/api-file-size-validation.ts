/**
 * File size validation utilities for API safety.
 * 
 * Prevents large files from blocking API routes and causing OOM.
 * Enforces strict size limits with early validation.
 */

import fs from 'fs';
import path from 'path';
import { formatBytes } from './api-cache-headers';

/** Maximum size for a single attached file (10 MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum cumulative size for all attached files (100 MB) */
export const MAX_TOTAL_ATTACHED_SIZE = 100 * 1024 * 1024;

/**
 * Validate that a file exists and is within size limits.
 * Checks both individual file size and cumulative total.
 * 
 * @param filePath - Path to file to validate
 * @param cumulativeSize - Running total of all files loaded so far
 * @returns Object with validation result and updated cumulative size
 */
export function validateFileSize(
  filePath: string,
  cumulativeSize: number = 0,
): { valid: boolean; fileSize: number; newCumulativeSize: number; error?: string } {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    
    // Check individual file size
    if (fileSize > MAX_FILE_SIZE) {
      return {
        valid: false,
        fileSize,
        newCumulativeSize: cumulativeSize,
        error: `File "${path.basename(filePath)}" is too large: ${formatBytes(fileSize)} (limit: ${formatBytes(MAX_FILE_SIZE)})`,
      };
    }
    
    // Check cumulative size
    const newCumulativeSize = cumulativeSize + fileSize;
    if (newCumulativeSize > MAX_TOTAL_ATTACHED_SIZE) {
      return {
        valid: false,
        fileSize,
        newCumulativeSize,
        error: `Total attached files too large: ${formatBytes(newCumulativeSize)} (limit: ${formatBytes(MAX_TOTAL_ATTACHED_SIZE)})`,
      };
    }
    
    return {
      valid: true,
      fileSize,
      newCumulativeSize,
    };
  } catch (err) {
    return {
      valid: false,
      fileSize: 0,
      newCumulativeSize: cumulativeSize,
      error: `Cannot access file "${path.basename(filePath)}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Validate multiple files before processing.
 * Returns all validation results or first error.
 * 
 * @param filePaths - Array of file paths to validate
 * @returns Object with validation results for each file
 */
export function validateFileBatch(filePaths: string[]): {
  valid: boolean;
  totalSize: number;
  results: Array<{ path: string; size: number; valid: boolean; error?: string }>;
} {
  const results: Array<{ path: string; size: number; valid: boolean; error?: string }> = [];
  let totalSize = 0;
  
  for (const filePath of filePaths) {
    const validation = validateFileSize(filePath, totalSize);
    
    if (!validation.valid) {
      results.push({
        path: filePath,
        size: validation.fileSize,
        valid: false,
        error: validation.error,
      });
      return { valid: false, totalSize, results };
    }
    
    results.push({
      path: filePath,
      size: validation.fileSize,
      valid: true,
    });
    
    totalSize = validation.newCumulativeSize;
  }
  
  return { valid: true, totalSize, results };
}
