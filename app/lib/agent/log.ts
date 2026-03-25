import fs from 'fs';
import path from 'path';
import { getMindRoot } from '@/lib/fs';
import { appendAgentAuditEvent } from '@/lib/core/agent-audit-log';

const LEGACY_LOG_FILE = '.agent-log.json';

interface AgentOpEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
}

/**
 * Append an agent operation entry to .agent-log.json (JSON Lines format).
 * Each line is a self-contained JSON object — easy to parse, grep, and tail.
 * Auto-truncates when file exceeds MAX_SIZE.
 */
export function logAgentOp(entry: AgentOpEntry): void {
  try {
    const root = getMindRoot();
    appendAgentAuditEvent(root, {
      ts: entry.ts,
      tool: entry.tool,
      params: entry.params,
      result: entry.result,
      message: entry.message,
      durationMs: entry.durationMs,
    });
    // Best-effort cleanup of legacy JSONL path.
    try {
      fs.rmSync(path.join(root, LEGACY_LOG_FILE), { force: true });
    } catch {
      // ignore
    }
  } catch {
    // Logging should never break tool execution
  }
}
