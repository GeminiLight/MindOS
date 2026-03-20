import { describe, it, expect, beforeEach } from 'vitest';
import { metrics } from '@/lib/metrics';

describe('MetricsCollector', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('initial state', () => {
    it('starts with zero counters', () => {
      const snap = metrics.getSnapshot();
      expect(snap.agentRequests).toBe(0);
      expect(snap.toolExecutions).toBe(0);
      expect(snap.totalTokens).toEqual({ input: 0, output: 0 });
      expect(snap.avgResponseTimeMs).toBe(0);
      expect(snap.errors).toBe(0);
    });

    it('has a valid processStartTime', () => {
      const snap = metrics.getSnapshot();
      expect(snap.processStartTime).toBeLessThanOrEqual(Date.now());
      expect(snap.processStartTime).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe('recordRequest', () => {
    it('increments agentRequests', () => {
      metrics.recordRequest(100);
      metrics.recordRequest(200);
      expect(metrics.getSnapshot().agentRequests).toBe(2);
    });

    it('calculates average response time', () => {
      metrics.recordRequest(100);
      metrics.recordRequest(300);
      expect(metrics.getSnapshot().avgResponseTimeMs).toBe(200);
    });

    it('keeps only the last 100 response times', () => {
      for (let i = 0; i < 120; i++) {
        metrics.recordRequest(i);
      }
      const snap = metrics.getSnapshot();
      expect(snap.agentRequests).toBe(120);
      // avg of 20..119 = (20+119)/2 = 69.5 → 70
      expect(snap.avgResponseTimeMs).toBe(70);
    });
  });

  describe('recordToolExecution', () => {
    it('increments toolExecutions', () => {
      metrics.recordToolExecution();
      metrics.recordToolExecution();
      metrics.recordToolExecution();
      expect(metrics.getSnapshot().toolExecutions).toBe(3);
    });
  });

  describe('recordTokens', () => {
    it('accumulates token counts', () => {
      metrics.recordTokens(100, 50);
      metrics.recordTokens(200, 100);
      const snap = metrics.getSnapshot();
      expect(snap.totalTokens).toEqual({ input: 300, output: 150 });
    });
  });

  describe('recordError', () => {
    it('increments error count', () => {
      metrics.recordError();
      expect(metrics.getSnapshot().errors).toBe(1);
    });
  });

  describe('getSnapshot', () => {
    it('returns a copy of totalTokens (not a reference)', () => {
      metrics.recordTokens(10, 5);
      const snap1 = metrics.getSnapshot();
      metrics.recordTokens(10, 5);
      const snap2 = metrics.getSnapshot();
      // snap1 should not be mutated by the second recordTokens call
      expect(snap1.totalTokens).toEqual({ input: 10, output: 5 });
      expect(snap2.totalTokens).toEqual({ input: 20, output: 10 });
    });
  });

  describe('reset', () => {
    it('resets all counters to initial state', () => {
      metrics.recordRequest(500);
      metrics.recordToolExecution();
      metrics.recordTokens(100, 50);
      metrics.recordError();
      metrics.reset();

      const snap = metrics.getSnapshot();
      expect(snap.agentRequests).toBe(0);
      expect(snap.toolExecutions).toBe(0);
      expect(snap.totalTokens).toEqual({ input: 0, output: 0 });
      expect(snap.avgResponseTimeMs).toBe(0);
      expect(snap.errors).toBe(0);
    });
  });
});
