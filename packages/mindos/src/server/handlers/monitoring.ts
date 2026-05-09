import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';
import { MINDOS_IGNORED_DIRS } from '../runtime.js';

export type MonitoringMetricsSnapshot = {
  processStartTime: number;
  agentRequests: number;
  toolExecutions: number;
  totalTokens: { input: number; output: number };
  avgResponseTimeMs: number;
  errors: number;
};

export type MonitoringHandlerServices = {
  mindRoot: string;
  metricsSnapshot?: () => MonitoringMetricsSnapshot;
  memoryUsage?: () => { heapUsed: number; heapTotal: number; rss: number };
  nodeVersion?: string;
  mcpPort?: number;
};

export type MonitoringPayload = {
  system: {
    uptimeMs: number;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    nodeVersion: string;
  };
  application: Omit<MonitoringMetricsSnapshot, 'processStartTime'>;
  knowledgeBase: {
    root: string;
    fileCount: number;
    totalSizeBytes: number;
  };
  mcp: {
    running: boolean;
    port: number;
  };
};

export function handleMonitoringGet(
  services: MonitoringHandlerServices,
): MindosServerResponse<MonitoringPayload> {
  const snapshot = (services.metricsSnapshot ?? defaultMetricsSnapshot)();
  const memory = (services.memoryUsage ?? process.memoryUsage)();
  const kbStats = walkStats(services.mindRoot);
  const mcpPort = services.mcpPort ?? (Number(process.env.MINDOS_MCP_PORT) || Number(process.env.MCP_PORT) || 8781);

  return json({
    system: {
      uptimeMs: Date.now() - snapshot.processStartTime,
      memory: {
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        rss: memory.rss,
      },
      nodeVersion: services.nodeVersion ?? process.version,
    },
    application: {
      agentRequests: snapshot.agentRequests,
      toolExecutions: snapshot.toolExecutions,
      totalTokens: snapshot.totalTokens,
      avgResponseTimeMs: snapshot.avgResponseTimeMs,
      errors: snapshot.errors,
    },
    knowledgeBase: {
      root: services.mindRoot,
      fileCount: kbStats.fileCount,
      totalSizeBytes: kbStats.totalSizeBytes,
    },
    mcp: {
      running: true,
      port: mcpPort,
    },
  });
}

function defaultMetricsSnapshot(): MonitoringMetricsSnapshot {
  return {
    processStartTime: Date.now(),
    agentRequests: 0,
    toolExecutions: 0,
    totalTokens: { input: 0, output: 0 },
    avgResponseTimeMs: 0,
    errors: 0,
  };
}

function walkStats(root: string): { fileCount: number; totalSizeBytes: number } {
  let fileCount = 0;
  let totalSizeBytes = 0;
  if (!existsSync(root)) return { fileCount, totalSizeBytes };

  function walk(current: string) {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (MINDOS_IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          fileCount++;
          totalSizeBytes += stat.size;
        } catch {
          // Skip files removed during traversal.
        }
      }
    }
  }

  walk(root);
  return { fileCount, totalSizeBytes };
}
