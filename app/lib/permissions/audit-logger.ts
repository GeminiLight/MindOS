/**
 * Audit Logger
 *
 * Records all Agent operations for debugging, security auditing, and learning.
 * Keeps recent logs in memory with optional persistence to disk.
 */

import type { AuditLogEntry, OperationResult, RiskLevel } from './types';

const MAX_MEMORY_LOGS = 1000;

export class AuditLogger {
  private logs: AuditLogEntry[] = [];

  /**
   * Log an operation
   */
  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date(),
    };

    // Add to memory queue
    this.logs.push(fullEntry);

    // Keep only recent logs
    if (this.logs.length > MAX_MEMORY_LOGS) {
      this.logs.shift();
    }

    // Optional: persist to disk (async, non-blocking)
    this.persistLog(fullEntry).catch((error) => {
      console.error('Failed to persist audit log:', error);
    });
  }

  /**
   * Log a successful operation
   */
  logSuccess(
    agent: string,
    operation: string,
    target: string,
    riskLevel: RiskLevel,
    userConfirmed?: boolean,
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      agent,
      operation,
      target,
      result: 'success',
      riskLevel,
      userConfirmed,
      metadata,
    });
  }

  /**
   * Log a failed operation
   */
  logError(
    agent: string,
    operation: string,
    target: string,
    riskLevel: RiskLevel,
    error: string,
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      agent,
      operation,
      target,
      result: 'error',
      riskLevel,
      error,
      metadata,
    });
  }

  /**
   * Log a denied operation
   */
  logDenied(
    agent: string,
    operation: string,
    target: string,
    riskLevel: RiskLevel,
    reason: string,
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      agent,
      operation,
      target,
      result: 'denied',
      riskLevel,
      error: reason,
      metadata,
    });
  }

  /**
   * Get recent logs
   */
  getRecentLogs(limit: number = 100, agent?: string): AuditLogEntry[] {
    let filtered = this.logs;

    if (agent) {
      filtered = filtered.filter((log) => log.agent === agent);
    }

    return filtered.slice(-limit).reverse();
  }

  /**
   * Get logs by result type
   */
  getLogsByResult(result: OperationResult, limit: number = 100): AuditLogEntry[] {
    return this.logs
      .filter((log) => log.result === result)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get logs by risk level
   */
  getLogsByRiskLevel(riskLevel: RiskLevel, limit: number = 100): AuditLogEntry[] {
    return this.logs
      .filter((log) => log.riskLevel === riskLevel)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get statistics
   */
  getStats() {
    const total = this.logs.length;
    const byResult = {
      success: this.logs.filter((l) => l.result === 'success').length,
      error: this.logs.filter((l) => l.result === 'error').length,
      denied: this.logs.filter((l) => l.result === 'denied').length,
    };
    const byRiskLevel = {
      safe: this.logs.filter((l) => l.riskLevel === 'safe').length,
      low: this.logs.filter((l) => l.riskLevel === 'low').length,
      medium: this.logs.filter((l) => l.riskLevel === 'medium').length,
      high: this.logs.filter((l) => l.riskLevel === 'high').length,
    };
    const userConfirmedCount = this.logs.filter((l) => l.userConfirmed).length;

    return {
      total,
      byResult,
      byRiskLevel,
      userConfirmedCount,
    };
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Persist log to disk (optional, non-blocking)
   */
  private async persistLog(entry: AuditLogEntry): Promise<void> {
    // Check if persistence is enabled
    if (process.env.MINDOS_AUDIT_LOG_PERSIST !== '1') {
      return;
    }

    // TODO: Implement disk persistence
    // - Write to ~/.mindos/audit.log in JSON Lines format
    // - Rotate logs when file size exceeds threshold
    // - Compress old logs
    //
    // For now, we only keep logs in memory
  }
}

// Singleton instance
let loggerInstance: AuditLogger | null = null;

/**
 * Get the global AuditLogger instance
 */
export function getAuditLogger(): AuditLogger {
  if (!loggerInstance) {
    loggerInstance = new AuditLogger();
  }
  return loggerInstance;
}
