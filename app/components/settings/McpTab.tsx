import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { McpStatus, AgentInfo, McpTabProps } from './types';
import ServerStatus from './McpServerStatus';
import AgentInstall from './McpAgentInstall';
import SkillsSection from './McpSkillsSection';

// Re-export types for backward compatibility
export type { McpStatus, AgentInfo, SkillInfo, McpTabProps } from './types';

/* ── Main McpTab ───────────────────────────────────────────────── */

export function McpTab({ t }: McpTabProps) {
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [statusData, agentsData] = await Promise.all([
        apiFetch<McpStatus>('/api/mcp/status'),
        apiFetch<{ agents: AgentInfo[] }>('/api/mcp/agents'),
      ]);
      setMcpStatus(statusData);
      setAgents(agentsData.agents);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const m = t.settings?.mcp;

  return (
    <div className="space-y-6">
      {/* MCP Server Status — compact card */}
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
        <ServerStatus status={mcpStatus} agents={agents} t={t} />
      </div>

      {/* Skills */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">{m?.skillsTitle ?? 'Skills'}</h3>
        <SkillsSection t={t} />
      </div>

      {/* Agent Configuration */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">{m?.agentsTitle ?? 'Agent Configuration'}</h3>
        <AgentInstall agents={agents} t={t} onRefresh={fetchAll} />
      </div>
    </div>
  );
}
