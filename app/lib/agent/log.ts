import fs from 'fs';
import path from 'path';
import { getMindRoot } from '@/lib/fs';

const LOG_FILE = '.agent-log.json';
const MAX_SIZE = 500 * 1024; // 500KB

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
    const logPath = path.join(root, LOG_FILE);

    const line = JSON.stringify(entry) + '\n';

    // Check size and truncate if needed
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      if (stat.size > MAX_SIZE) {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.trimEnd().split('\n');
        // Keep the newer half
        const kept = lines.slice(Math.floor(lines.length / 2));
        fs.writeFileSync(logPath, kept.join('\n') + '\n');
      }
    }

    fs.appendFileSync(logPath, line);
  } catch {
    // Logging should never break tool execution
  }
}
