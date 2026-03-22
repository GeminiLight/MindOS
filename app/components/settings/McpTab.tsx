import { Loader2 } from 'lucide-react';
import { useMcpDataOptional } from '@/hooks/useMcpData';
import type { McpTabProps } from './types';
import AgentInstall from './McpAgentInstall';
import SkillsSection from './McpSkillsSection';

// Re-export types for backward compatibility
export type { McpStatus, AgentInfo, SkillInfo, McpTabProps } from './types';

/* ── Main McpTab ───────────────────────────────────────────────── */

export function McpTab({ t }: McpTabProps) {
  const mcp = useMcpDataOptional();
  const m = t.settings?.mcp;

  if (!mcp || mcp.loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Server status summary (minimal — full status is in sidebar AgentsPanel) */}
      {mcp.status && (
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
          <div className="flex items-center gap-2.5 text-xs">
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${mcp.status.running ? 'bg-success' : 'bg-muted-foreground'}`} />
            <span className="text-foreground font-medium">
              {mcp.status.running ? (m?.running ?? 'Running') : (m?.stopped ?? 'Stopped')}
            </span>
            {mcp.status.running && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-muted-foreground">{mcp.status.endpoint}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{mcp.status.toolCount} tools</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Skills (full CRUD — search, edit, delete, create, language switch) */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">{m?.skillsTitle ?? 'Skills'}</h3>
        <SkillsSection t={t} />
      </div>

      {/* Batch Agent Install */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">{m?.agentsTitle ?? 'Agent Configuration'}</h3>
        <AgentInstall agents={mcp.agents} t={t} onRefresh={mcp.refresh} />
      </div>
    </div>
  );
}
