/**
 * Permission system types
 *
 * Defines the core types for the simplified permission system that protects
 * users from dangerous Agent operations while keeping the system lightweight.
 */

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high';

export type OperationResult = 'success' | 'error' | 'denied';

export type FileOperation = 'read' | 'write' | 'delete';

export interface PermissionCheckResult {
  /** Whether the operation is allowed to proceed */
  allowed: boolean;

  /** Whether user confirmation is required */
  requiresConfirmation: boolean;

  /** Human-readable reason for the decision */
  reason?: string;

  /** Risk level of the operation */
  riskLevel: RiskLevel;

  /** Matched pattern (for debugging) */
  matchedPattern?: string;
}

export interface AuditLogEntry {
  /** Timestamp of the operation */
  timestamp: Date;

  /** Agent name that performed the operation */
  agent: string;

  /** Type of operation (e.g., "delete_file", "shell_command") */
  operation: string;

  /** Target of the operation (file path, command, etc.) */
  target: string;

  /** Result of the operation */
  result: OperationResult;

  /** Risk level assessed */
  riskLevel: RiskLevel;

  /** Whether user confirmed the operation */
  userConfirmed?: boolean;

  /** Error message if operation failed */
  error?: string;

  /** Additional context */
  metadata?: Record<string, unknown>;
}

export interface PermissionConfirmRequest {
  /** Unique ID for this confirmation request */
  id: string;

  /** Operation type */
  operation: string;

  /** Target of the operation */
  target: string;

  /** Risk level */
  riskLevel: RiskLevel;

  /** Detailed description for the user */
  description: string;

  /** Timestamp when request was created */
  createdAt: Date;
}

export interface PermissionConfirmResponse {
  /** Request ID */
  id: string;

  /** User's decision */
  decision: 'allow_once' | 'allow_always' | 'deny';

  /** Timestamp of the decision */
  decidedAt: Date;
}

export interface WhitelistEntry {
  /** Pattern to match (regex string) */
  pattern: string;

  /** Type of pattern (command, file, path) */
  type: 'command' | 'file' | 'path';

  /** When this entry was added */
  addedAt: Date;

  /** Optional expiry time */
  expiresAt?: Date;
}
