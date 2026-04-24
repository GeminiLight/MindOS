/**
 * Tests for AuditLogger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger } from '@/lib/permissions/audit-logger';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  describe('log', () => {
    it('records a log entry', () => {
      logger.log({
        agent: 'test-agent',
        operation: 'read_file',
        target: '/home/user/test.txt',
        result: 'success',
        riskLevel: 'safe',
      });

      const logs = logger.getRecentLogs(10);
      expect(logs).toHaveLength(1);
      expect(logs[0].agent).toBe('test-agent');
      expect(logs[0].operation).toBe('read_file');
      expect(logs[0].target).toBe('/home/user/test.txt');
      expect(logs[0].result).toBe('success');
      expect(logs[0].riskLevel).toBe('safe');
      expect(logs[0].timestamp).toBeInstanceOf(Date);
    });

    it('adds timestamp automatically', () => {
      const before = new Date();
      logger.log({
        agent: 'test-agent',
        operation: 'test',
        target: 'test',
        result: 'success',
        riskLevel: 'safe',
      });
      const after = new Date();

      const logs = logger.getRecentLogs(1);
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('keeps only recent 1000 logs', () => {
      // Add 1100 logs
      for (let i = 0; i < 1100; i++) {
        logger.log({
          agent: 'test-agent',
          operation: `operation-${i}`,
          target: `target-${i}`,
          result: 'success',
          riskLevel: 'safe',
        });
      }

      const logs = logger.getRecentLogs(2000);
      expect(logs).toHaveLength(1000);
      // Should keep the most recent logs (1000-1099)
      expect(logs[0].operation).toBe('operation-1099');
      expect(logs[999].operation).toBe('operation-100');
    });
  });

  describe('logSuccess', () => {
    it('logs a successful operation', () => {
      logger.logSuccess('agent1', 'write_file', '/home/user/test.txt', 'safe');

      const logs = logger.getRecentLogs(1);
      expect(logs[0].result).toBe('success');
      expect(logs[0].agent).toBe('agent1');
      expect(logs[0].operation).toBe('write_file');
      expect(logs[0].riskLevel).toBe('safe');
    });

    it('logs user confirmation flag', () => {
      logger.logSuccess('agent1', 'delete_file', '/home/user/test.txt', 'medium', true);

      const logs = logger.getRecentLogs(1);
      expect(logs[0].userConfirmed).toBe(true);
    });

    it('logs metadata', () => {
      logger.logSuccess('agent1', 'test', 'target', 'safe', false, { key: 'value' });

      const logs = logger.getRecentLogs(1);
      expect(logs[0].metadata).toEqual({ key: 'value' });
    });
  });

  describe('logError', () => {
    it('logs a failed operation', () => {
      logger.logError('agent1', 'write_file', '/etc/passwd', 'high', 'Permission denied');

      const logs = logger.getRecentLogs(1);
      expect(logs[0].result).toBe('error');
      expect(logs[0].error).toBe('Permission denied');
      expect(logs[0].riskLevel).toBe('high');
    });
  });

  describe('logDenied', () => {
    it('logs a denied operation', () => {
      logger.logDenied('agent1', 'shell_command', 'rm -rf /', 'high', 'User denied');

      const logs = logger.getRecentLogs(1);
      expect(logs[0].result).toBe('denied');
      expect(logs[0].error).toBe('User denied');
      expect(logs[0].riskLevel).toBe('high');
    });
  });

  describe('getRecentLogs', () => {
    beforeEach(() => {
      logger.logSuccess('agent1', 'op1', 'target1', 'safe');
      logger.logSuccess('agent2', 'op2', 'target2', 'low');
      logger.logSuccess('agent1', 'op3', 'target3', 'medium');
    });

    it('returns logs in reverse chronological order', () => {
      const logs = logger.getRecentLogs(10);
      expect(logs).toHaveLength(3);
      expect(logs[0].operation).toBe('op3'); // Most recent
      expect(logs[2].operation).toBe('op1'); // Oldest
    });

    it('limits the number of logs returned', () => {
      const logs = logger.getRecentLogs(2);
      expect(logs).toHaveLength(2);
      expect(logs[0].operation).toBe('op3');
      expect(logs[1].operation).toBe('op2');
    });

    it('filters by agent', () => {
      const logs = logger.getRecentLogs(10, 'agent1');
      expect(logs).toHaveLength(2);
      expect(logs[0].operation).toBe('op3');
      expect(logs[1].operation).toBe('op1');
    });
  });

  describe('getLogsByResult', () => {
    beforeEach(() => {
      logger.logSuccess('agent1', 'op1', 'target1', 'safe');
      logger.logError('agent1', 'op2', 'target2', 'high', 'Error');
      logger.logDenied('agent1', 'op3', 'target3', 'high', 'Denied');
      logger.logSuccess('agent1', 'op4', 'target4', 'safe');
    });

    it('filters by success result', () => {
      const logs = logger.getLogsByResult('success', 10);
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.result === 'success')).toBe(true);
    });

    it('filters by error result', () => {
      const logs = logger.getLogsByResult('error', 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].operation).toBe('op2');
    });

    it('filters by denied result', () => {
      const logs = logger.getLogsByResult('denied', 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].operation).toBe('op3');
    });
  });

  describe('getLogsByRiskLevel', () => {
    beforeEach(() => {
      logger.logSuccess('agent1', 'op1', 'target1', 'safe');
      logger.logSuccess('agent1', 'op2', 'target2', 'low');
      logger.logSuccess('agent1', 'op3', 'target3', 'medium');
      logger.logSuccess('agent1', 'op4', 'target4', 'high');
    });

    it('filters by safe risk level', () => {
      const logs = logger.getLogsByRiskLevel('safe', 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].riskLevel).toBe('safe');
    });

    it('filters by high risk level', () => {
      const logs = logger.getLogsByRiskLevel('high', 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].riskLevel).toBe('high');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      logger.logSuccess('agent1', 'op1', 'target1', 'safe');
      logger.logSuccess('agent1', 'op2', 'target2', 'low', true);
      logger.logError('agent1', 'op3', 'target3', 'medium', 'Error');
      logger.logDenied('agent1', 'op4', 'target4', 'high', 'Denied');
    });

    it('returns correct statistics', () => {
      const stats = logger.getStats();

      expect(stats.total).toBe(4);
      expect(stats.byResult.success).toBe(2);
      expect(stats.byResult.error).toBe(1);
      expect(stats.byResult.denied).toBe(1);
      expect(stats.byRiskLevel.safe).toBe(1);
      expect(stats.byRiskLevel.low).toBe(1);
      expect(stats.byRiskLevel.medium).toBe(1);
      expect(stats.byRiskLevel.high).toBe(1);
      expect(stats.userConfirmedCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('clears all logs', () => {
      logger.logSuccess('agent1', 'op1', 'target1', 'safe');
      logger.logSuccess('agent1', 'op2', 'target2', 'safe');

      expect(logger.getRecentLogs(10)).toHaveLength(2);

      logger.clear();

      expect(logger.getRecentLogs(10)).toHaveLength(0);
    });
  });
});
