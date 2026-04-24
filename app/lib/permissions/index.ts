/**
 * Permission System
 *
 * Unified entry point for the simplified permission system.
 * Provides a high-level API for checking permissions and logging operations.
 */

export * from './types';
export * from './patterns';
export { PermissionChecker, getPermissionChecker } from './checker';
export { AuditLogger, getAuditLogger } from './audit-logger';
export { WhitelistManager, getWhitelistManager } from './whitelist';

import { getPermissionChecker } from './checker';
import { getAuditLogger } from './audit-logger';
import { getWhitelistManager } from './whitelist';
import type { FileOperation, PermissionCheckResult } from './types';

/**
 * High-level permission check with whitelist support
 */
export function checkFilePermission(
  operation: FileOperation,
  filePath: string,
  agent: string = 'unknown'
): PermissionCheckResult {
  const checker = getPermissionChecker();
  const whitelist = getWhitelistManager();
  const logger = getAuditLogger();

  // Check whitelist first
  if (whitelist.isWhitelisted(filePath, 'file')) {
    logger.logSuccess(agent, `${operation}_file`, filePath, 'safe', false, {
      whitelisted: true,
    });
    return {
      allowed: true,
      requiresConfirmation: false,
      riskLevel: 'safe',
      reason: 'Whitelisted by user',
    };
  }

  // Perform permission check
  const result = checker.checkFileOperation(operation, filePath);

  // Log the check
  if (result.allowed && !result.requiresConfirmation) {
    logger.logSuccess(agent, `${operation}_file`, filePath, result.riskLevel);
  }

  return result;
}

/**
 * High-level command permission check with whitelist support
 */
export function checkCommandPermission(
  command: string,
  agent: string = 'unknown'
): PermissionCheckResult {
  const checker = getPermissionChecker();
  const whitelist = getWhitelistManager();
  const logger = getAuditLogger();

  // Check whitelist first
  if (whitelist.isWhitelisted(command, 'command')) {
    logger.logSuccess(agent, 'shell_command', command, 'safe', false, {
      whitelisted: true,
    });
    return {
      allowed: true,
      requiresConfirmation: false,
      riskLevel: 'safe',
      reason: 'Whitelisted by user',
    };
  }

  // Perform permission check
  const result = checker.checkShellCommand(command);

  // Log the check
  if (result.allowed && !result.requiresConfirmation) {
    logger.logSuccess(agent, 'shell_command', command, result.riskLevel);
  }

  return result;
}

/**
 * Check if permission system is enabled
 */
export function isPermissionSystemEnabled(): boolean {
  return process.env.MINDOS_DISABLE_PERMISSIONS !== '1';
}

/**
 * Get permission system statistics
 */
export function getPermissionStats() {
  const logger = getAuditLogger();
  const whitelist = getWhitelistManager();

  return {
    enabled: isPermissionSystemEnabled(),
    audit: logger.getStats(),
    whitelist: whitelist.getStats(),
  };
}
