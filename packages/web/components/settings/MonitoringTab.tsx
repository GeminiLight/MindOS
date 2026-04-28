'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, Cpu, Database, HardDrive, Loader2, RefreshCw, Zap } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { Messages } from '@/lib/i18n';

interface MonitoringData {
  system: {
    uptimeMs: number;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    nodeVersion: string;
  };
  application: {
    agentRequests: number;
    toolExecutions: number;
    totalTokens: { input: number; output: number };
    avgResponseTimeMs: number;
    errors: number;
  };
  knowledgeBase: {
    root: string;
    fileCount: number;
    totalSizeBytes: number;
  };
  mcp: {
    running: boolean;
    port: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`h-2 w-full rounded-full bg-muted ${className ?? ''}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${pct > 85 ? 'bg-destructive' : 'bg-[var(--amber)]'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

export interface MonitoringTabProps {
  t: Messages;
}

export function MonitoringTab({ t }: MonitoringTabProps) {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const mon = t.settings.monitoring;

  const fetchData = useCallback(async () => {
    try {
      const d = await apiFetch<MonitoringData>('/api/monitoring', { timeout: 5000 });
      setData(d);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        {mon.fetchError || 'Failed to load monitoring data'}
      </div>
    );
  }

  if (!data) return null;

  const { system, application, knowledgeBase, mcp } = data;
  const heapPct = system.memory.heapTotal > 0
    ? Math.round((system.memory.heapUsed / system.memory.heapTotal) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* System */}
      <section>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          <Cpu size={13} />
          {mon.system || 'System'}
        </p>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{mon.heapMemory || 'Heap Memory'}</span>
              <span className="tabular-nums">{formatBytes(system.memory.heapUsed)} / {formatBytes(system.memory.heapTotal)} ({heapPct}%)</span>
            </div>
            <ProgressBar value={system.memory.heapUsed} max={system.memory.heapTotal} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label={mon.rss || 'RSS'} value={formatBytes(system.memory.rss)} />
            <StatCard label={mon.uptime || 'Uptime'} value={formatUptime(system.uptimeMs)} />
            <StatCard label={mon.nodeVersion || 'Node'} value={system.nodeVersion} />
          </div>
        </div>
      </section>

      {/* Application */}
      <section>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          <Zap size={13} />
          {mon.application || 'Application'}
        </p>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label={mon.requests || 'Requests'} value={application.agentRequests} />
          <StatCard label={mon.toolCalls || 'Tool Calls'} value={application.toolExecutions} />
          <StatCard label={mon.avgResponse || 'Avg Response'} value={application.avgResponseTimeMs > 0 ? `${application.avgResponseTimeMs}ms` : '—'} />
          <StatCard
            label={mon.tokens || 'Tokens'}
            value={`${(application.totalTokens.input + application.totalTokens.output).toLocaleString()}`}
            sub={`↑${application.totalTokens.input.toLocaleString()} ↓${application.totalTokens.output.toLocaleString()}`}
          />
          <StatCard label={mon.errors || 'Errors'} value={application.errors} />
        </div>
      </section>

      {/* Knowledge Base */}
      <section>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          <Database size={13} />
          {mon.knowledgeBase || 'Knowledge Base'}
        </p>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label={mon.files || 'Files'} value={knowledgeBase.fileCount} />
          <StatCard label={mon.totalSize || 'Total Size'} value={formatBytes(knowledgeBase.totalSizeBytes)} />
          <StatCard label={mon.rootPath || 'Root'} value={knowledgeBase.root.split('/').pop() ?? knowledgeBase.root} sub={knowledgeBase.root} />
        </div>
      </section>

      {/* MCP */}
      <section>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          <HardDrive size={13} />
          MCP
        </p>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label={mon.mcpStatus || 'Status'}
            value={mcp.running ? (mon.mcpRunning || 'Running') : (mon.mcpStopped || 'Stopped')}
          />
          <StatCard label={mon.mcpPort || 'Port'} value={mcp.port} />
        </div>
      </section>

      {/* Refresh indicator */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
        {mon.autoRefresh || 'Auto-refresh every 5s'}
      </div>
    </div>
  );
}
