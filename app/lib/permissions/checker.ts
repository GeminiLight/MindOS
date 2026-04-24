/**
 * Permission Checker
 *
 * Core logic for checking whether operations are safe or require user confirmation.
 * Implements a lightweight permission system that protects against dangerous operations
 * while keeping false positives low.
 */

import path from 'path';
import type {
  PermissionCheckResult,
  FileOperation,
} from './types';
import {
  DANGEROUS_COMMAND_PATTERNS,
  SENSITIVE_FILE_PATTERNS,
  DANGEROUS_PATH_PATTERNS,
  SAFE_COMMAND_PATTERNS,
} from './patterns';

export class PermissionChecker {
  /**
   * Check if a file operation is allowed
   */
  checkFileOperation(
    operation: FileOperation,
    filePath: string
  ): PermissionCheckResult {
    // Normalize path for consistent checking
    const normalizedPath = this.normalizePath(filePath);

    // Read operations are always safe
    if (operation === 'read') {
      return {
        allowed: true,
        requiresConfirmation: false,
        riskLevel: 'safe',
      };
    }

    // Check for dangerous paths
    const dangerousPath = this.checkDangerousPath(normalizedPath);
    if (dangerousPath) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Operation targets system directory: ${dangerousPath.description}`,
        riskLevel: 'high',
        matchedPattern: dangerousPath.pattern.source,
      };
    }

    // Delete operations always require confirmation
    if (operation === 'delete') {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: 'File deletion requires user confirmation',
        riskLevel: 'medium',
      };
    }

    // Write operations to sensitive files require confirmation
    if (operation === 'write') {
      const sensitiveFile = this.checkSensitiveFile(normalizedPath);
      if (sensitiveFile) {
        return {
          allowed: false,
          requiresConfirmation: true,
          reason: `Writing to sensitive file: ${sensitiveFile.description}`,
          riskLevel: 'high',
          matchedPattern: sensitiveFile.pattern.source,
        };
      }
    }

    // Default: allow write operations to normal files
    return {
      allowed: true,
      requiresConfirmation: false,
      riskLevel: 'safe',
    };
  }

  /**
   * Check if a shell command is allowed
   */
  checkShellCommand(command: string): PermissionCheckResult {
    // Trim and normalize whitespace
    const normalizedCommand = command.trim().replace(/\s+/g, ' ');

    // Check for dangerous command patterns FIRST (before safe whitelist)
    for (const { pattern, description } of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(normalizedCommand)) {
        return {
          allowed: false,
          requiresConfirmation: true,
          reason: `Dangerous command detected: ${description}`,
          riskLevel: 'high',
          matchedPattern: pattern.source,
        };
      }
    }

    // Check if command involves dangerous paths
    const dangerousPath = this.checkCommandForDangerousPaths(normalizedCommand);
    if (dangerousPath) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Command targets system directory: ${dangerousPath.description}`,
        riskLevel: 'high',
        matchedPattern: dangerousPath.pattern.source,
      };
    }

    // Check safe command whitelist (after dangerous checks)
    for (const safePattern of SAFE_COMMAND_PATTERNS) {
      if (safePattern.test(normalizedCommand)) {
        return {
          allowed: true,
          requiresConfirmation: false,
          riskLevel: 'safe',
        };
      }
    }

    // Default: allow command but log it
    return {
      allowed: true,
      requiresConfirmation: false,
      riskLevel: 'low',
    };
  }

  /**
   * Normalize file path for consistent checking across platforms
   */
  private normalizePath(filePath: string): string {
    // Convert backslashes to forward slashes for consistent checking
    let normalized = filePath.replace(/\\/g, '/');

    // Don't use path.resolve() as it converts to current system's absolute path
    // which breaks cross-platform path checking (e.g., C:/Windows on macOS)
    // Just normalize the slashes and return

    return normalized;
  }

  /**
   * Check if path matches sensitive file patterns
   */
  private checkSensitiveFile(filePath: string) {
    const basename = path.basename(filePath);
    const fullPath = filePath;

    for (const { pattern, description } of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(basename) || pattern.test(fullPath)) {
        return { pattern, description };
      }
    }

    return null;
  }

  /**
   * Check if path matches dangerous path patterns
   */
  private checkDangerousPath(filePath: string) {
    for (const { pattern, description } of DANGEROUS_PATH_PATTERNS) {
      if (pattern.test(filePath)) {
        return { pattern, description };
      }
    }

    return null;
  }

  /**
   * Check if command contains references to dangerous paths
   */
  private checkCommandForDangerousPaths(command: string) {
    for (const { pattern, description } of DANGEROUS_PATH_PATTERNS) {
      if (pattern.test(command)) {
        return { pattern, description };
      }
    }

    return null;
  }
}

// Singleton instance
let checkerInstance: PermissionChecker | null = null;

/**
 * Get the global PermissionChecker instance
 */
export function getPermissionChecker(): PermissionChecker {
  if (!checkerInstance) {
    checkerInstance = new PermissionChecker();
  }
  return checkerInstance;
}
