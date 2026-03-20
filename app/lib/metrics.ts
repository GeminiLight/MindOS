/**
 * In-memory metrics collector for MindOS runtime observability.
 *
 * Singleton — import { metrics } from '@/lib/metrics' in any server-side code.
 * Data resets when the process restarts (no persistence needed).
 */

export interface MetricsSnapshot {
  processStartTime: number;
  agentRequests: number;
  toolExecutions: number;
  totalTokens: { input: number; output: number };
  avgResponseTimeMs: number;
  errors: number;
}

const MAX_RESPONSE_TIMES = 100;

class MetricsCollector {
  private processStartTime = Date.now();
  private agentRequests = 0;
  private toolExecutions = 0;
  private totalTokens = { input: 0, output: 0 };
  private responseTimes: number[] = [];
  private errors = 0;

  /** Record a completed agent request with its duration. */
  recordRequest(durationMs: number): void {
    this.agentRequests++;
    this.responseTimes.push(durationMs);
    if (this.responseTimes.length > MAX_RESPONSE_TIMES) {
      this.responseTimes.shift();
    }
  }

  /** Increment the tool execution counter. */
  recordToolExecution(): void {
    this.toolExecutions++;
  }

  /** Accumulate token usage. */
  recordTokens(input: number, output: number): void {
    this.totalTokens.input += input;
    this.totalTokens.output += output;
  }

  /** Increment the error counter. */
  recordError(): void {
    this.errors++;
  }

  /** Return a read-only snapshot of all metrics. */
  getSnapshot(): MetricsSnapshot {
    const avg =
      this.responseTimes.length > 0
        ? Math.round(this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length)
        : 0;

    return {
      processStartTime: this.processStartTime,
      agentRequests: this.agentRequests,
      toolExecutions: this.toolExecutions,
      totalTokens: { ...this.totalTokens },
      avgResponseTimeMs: avg,
      errors: this.errors,
    };
  }

  /** Reset all counters (useful for testing). */
  reset(): void {
    this.processStartTime = Date.now();
    this.agentRequests = 0;
    this.toolExecutions = 0;
    this.totalTokens = { input: 0, output: 0 };
    this.responseTimes = [];
    this.errors = 0;
  }
}

/** Global singleton — shared across all requests in the same Node process. */
export const metrics = new MetricsCollector();
