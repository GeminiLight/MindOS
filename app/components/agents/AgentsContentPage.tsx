'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { useMcpData } from '@/lib/stores/mcp-store';
import { useA2aRegistry } from '@/hooks/useA2aRegistry';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import {
  bucketAgents,
  buildRiskQueue,
  type AgentsDashboardTab,
} from './agents-content-model';
import AgentsOverviewSection from './AgentsOverviewSection';
import AgentsMcpSection from './AgentsMcpSection';
import AgentsSkillsSection from './AgentsSkillsSection';
import AgentsPanelA2aTab from './AgentsPanelA2aTab';
import AgentsPanelSessionsTab from './AgentsPanelSessionsTab';
import AgentActivitySection from './AgentActivitySection';
import CustomAgentModal from './CustomAgentModal';
import { ConfirmDialog } from './AgentsPrimitives';
import type { AgentInfo } from '@/components/settings/types';

export default function AgentsContentPage({ tab }: { tab: AgentsDashboardTab }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const mcp = useMcpData();
  const a2a = useA2aRegistry();
  const pageHeader = useMemo(() => {
    if (tab === 'activity') {
      return {
        title: a.navActivity ?? 'Activity',
        subtitle: a.activitySubtitle ?? 'Agent operations audit log.',
      };
    }
    if (tab === 'sessions') {
      return {
        title: 'Sessions',
        subtitle: 'Active ACP agent sessions.',
      };
    }
    if (tab === 'a2a') {
      return {
        title: a.navNetwork,
        subtitle: a.a2aTabEmptyHint,
      };
    }
    if (tab === 'skills') {
      return {
        title: a.navSkills,
        subtitle: a.skills.capabilityGroups,
      };
    }
    if (tab === 'mcp') {
      return {
        title: a.navMcp,
        subtitle: a.mcp.connectionGraph,
      };
    }
    return {
      title: a.title,
      subtitle: a.subtitle,
    };
  }, [a, tab]);

  const buckets = useMemo(() => bucketAgents(mcp.agents), [mcp.agents]);
  const mcpEnabled = mcp.status?.connectionMode?.mcp ?? false;
  const riskQueue = useMemo(
    () =>
      buildRiskQueue({
        mcpRunning: !!mcp.status?.running,
        mcpEnabled,
        detectedCount: buckets.detected.length,
        notFoundCount: buckets.notFound.length,
        allSkillsDisabled: mcp.skills.length > 0 && mcp.skills.every((s) => !s.enabled),
        copy: a.overview,
      }),
    [mcp.skills, mcp.status?.running, mcpEnabled, buckets.detected.length, buckets.notFound.length, a.overview],
  );
  const enabledSkillCount = useMemo(
    () => mcp.skills.filter((skill) => skill.enabled).length,
    [mcp.skills],
  );

  /* ─── Custom Agent Modal State ─── */
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [removeAgent, setRemoveAgent] = useState<AgentInfo | null>(null);
  const [removing, setRemoving] = useState(false);

  const handleAddCustomAgent = useCallback(() => {
    setEditingAgent(null);
    setCustomModalOpen(true);
  }, []);

  const handleEditCustomAgent = useCallback((agent: AgentInfo) => {
    setEditingAgent(agent);
    setCustomModalOpen(true);
  }, []);

  const handleRemoveCustomAgent = useCallback((agent: AgentInfo) => {
    setRemoveAgent(agent);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    if (!removeAgent) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/agents/custom', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: removeAgent.key }),
      });
      if (res.ok) {
        toast.success(a.overview.customAgentRemoved(removeAgent.name));
        mcp.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || a.overview.customAgentFailedRemove);
      }
    } catch {
      toast.error(a.overview.customAgentNetworkError);
    } finally {
      setRemoving(false);
      setRemoveAgent(null);
    }
  }, [removeAgent, mcp, a.overview]);

  const handleCustomAgentSuccess = useCallback(() => {
    mcp.refresh();
  }, [mcp]);

  const copySnippet = async (agentKey: string) => {
    const agent = mcp.agents.find((item) => item.key === agentKey);
    if (!agent) return;
    const snippet = generateSnippet(agent, mcp.status, agent.preferredTransport);
    const ok = await copyToClipboard(snippet.snippet);
    if (ok) toast.copy();
  };

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{pageHeader.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{pageHeader.subtitle}</p>
      </header>

      {/* Loading skeleton — shown while initial data loads */}
      {mcp.loading && tab === 'overview' && <OverviewSkeleton />}

      {!mcp.loading && tab === 'overview' && (
        <AgentsOverviewSection
          copy={a.overview}
          buckets={buckets}
          riskQueue={riskQueue}
          mcpRunning={!!mcp.status?.running}
          mcpPort={mcp.status?.port ?? null}
          mcpToolCount={mcp.status?.toolCount ?? 0}
          mcpEnabled={mcpEnabled}
          enabledSkillCount={enabledSkillCount}
          allAgents={mcp.agents}
          pulseCopy={a.workspacePulse}
          a2aCount={a2a.agents.length}
          onAddCustomAgent={handleAddCustomAgent}
          onEditCustomAgent={handleEditCustomAgent}
          onRemoveCustomAgent={handleRemoveCustomAgent}
        />
      )}

      {tab === 'mcp' && mcpEnabled && (
        <AgentsMcpSection copy={{ ...a.mcp, status: a.status }} mcp={mcp} buckets={buckets} copyState={null} onCopySnippet={copySnippet} />
      )}

      {/* MCP tab accessed but mode disabled — show hint */}
      {tab === 'mcp' && !mcpEnabled && !mcp.loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">{a.mcp?.mcpDisabledMessage ?? 'MCP mode is not enabled.'}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{a.mcp?.mcpDisabledHint ?? 'Enable it in Settings → Connections to use MCP agents.'}</p>
        </div>
      )}

      {tab === 'skills' && (
        <AgentsSkillsSection copy={a.skills} mcp={mcp} buckets={buckets} />
      )}

      {tab === 'a2a' && (
        <AgentsPanelA2aTab
          agents={a2a.agents}
          discovering={a2a.discovering}
          error={a2a.error}
          onDiscover={a2a.discover}
          onRemove={a2a.remove}
        />
      )}

      {tab === 'sessions' && (
        <AgentsPanelSessionsTab />
      )}

      {tab === 'activity' && (
        <AgentActivitySection />
      )}

      {/* Custom Agent Modal */}
      <CustomAgentModal
        open={customModalOpen}
        onClose={() => { setCustomModalOpen(false); setEditingAgent(null); }}
        onSuccess={handleCustomAgentSuccess}
        existingAgents={mcp.agents}
        editAgent={editingAgent}
      />

      {/* Remove Confirmation */}
      <ConfirmDialog
        open={!!removeAgent}
        title={removeAgent ? a.overview.customAgentRemoveTitle(removeAgent.name) : ''}
        message={a.overview.customAgentRemoveMessage as string}
        confirmLabel={a.overview.customAgentRemoveConfirm as string}
        cancelLabel={a.overview.customAgentCancel as string}
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveAgent(null)}
        variant="destructive"
      />
    </div>
  );
}

/* ────────── Loading skeleton for Overview ────────── */

function OverviewSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Stats bar skeleton */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/10">
          <div className="h-4 w-32 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-3 py-3.5 flex flex-col items-center gap-2">
              <div className="h-3 w-16 bg-muted rounded" />
              <div className="h-5 w-8 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Quick nav skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-3 w-full bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Agent cards skeleton */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="h-3 w-16 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-full bg-muted" />
                <div className="flex-1 h-4 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded" />
              </div>
              <div className="h-3 w-2/3 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}