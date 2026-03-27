export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getMindRoot } from '@/lib/fs';
import { metrics } from '@/lib/metrics';

// Aligned with IGNORED_DIRS in lib/fs.ts and lib/core/tree.ts
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'app', '.next', '.DS_Store', 'mcp']);

/**
 * Recursively count files and sum their sizes under a directory.
 * Skips directories in IGNORED_DIRS (aligned with the rest of the codebase).
 */
function walkStats(dir: string): { fileCount: number; totalSizeBytes: number } {
  let fileCount = 0;
  let totalSizeBytes = 0;

  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          fileCount++;
          totalSizeBytes += stat.size;
        } catch { /* skip unreadable files */ }
      }
    }
  }

  walk(dir);
  return { fileCount, totalSizeBytes };
}

// ── TTL cache for walkStats (avoid blocking event loop every 5s poll) ──
let cachedKbStats: { fileCount: number; totalSizeBytes: number } | null = null;
let cachedKbStatsTs = 0;
const KB_STATS_TTL = 30_000; // 30s

function getCachedKbStats(mindRoot: string): { fileCount: number; totalSizeBytes: number } {
  const now = Date.now();
  if (cachedKbStats && now - cachedKbStatsTs < KB_STATS_TTL) return cachedKbStats;
  cachedKbStats = walkStats(mindRoot);
  cachedKbStatsTs = now;
  return cachedKbStats;
}

export async function GET() {
  const snap = metrics.getSnapshot();
  const mem = process.memoryUsage();
  const mindRoot = getMindRoot();

  const kbStats = getCachedKbStats(mindRoot);

  // Detect MCP status from environment / config
  const mcpPort = Number(process.env.MINDOS_MCP_PORT) || Number(process.env.MCP_PORT) || 8781;

  return NextResponse.json({
    system: {
      uptimeMs: Date.now() - snap.processStartTime,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
      nodeVersion: process.version,
    },
    application: {
      agentRequests: snap.agentRequests,
      toolExecutions: snap.toolExecutions,
      totalTokens: snap.totalTokens,
      avgResponseTimeMs: snap.avgResponseTimeMs,
      errors: snap.errors,
    },
    knowledgeBase: {
      root: mindRoot,
      fileCount: kbStats.fileCount,
      totalSizeBytes: kbStats.totalSizeBytes,
    },
    mcp: {
      running: true, // If this endpoint responds, the server is running
      port: mcpPort,
    },
  });
}
