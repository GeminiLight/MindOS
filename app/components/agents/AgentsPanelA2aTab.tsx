'use client';

import { useState, useCallback } from 'react';
import { Check, ChevronDown, ChevronUp, Clock, Code2, Globe, Loader2, MessageSquare, Network, RefreshCw, RotateCcw, Save, Settings2, Trash2, Wifi, WifiOff, Wrench, Zap } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { useAcpConfig } from '@/hooks/useAcpConfig';
import type { RemoteAgent, DelegationRecord } from '@/lib/a2a/types';
import type { AcpRegistryEntry } from '@/lib/acp/types';
import { useDelegationHistory } from '@/hooks/useDelegationHistory';
import { useAcpRegistry } from '@/hooks/useAcpRegistry';
import { useAcpDetection } from '@/hooks/useAcpDetection';
import { openAskModal } from '@/hooks/useAskModal';
import DiscoverAgentModal from './DiscoverAgentModal';

interface AgentsPanelA2aTabProps {
  agents: RemoteAgent[];
  discovering: boolean;
  error: string | null;
  onDiscover: (url: string) => Promise<RemoteAgent | null>;
  onRemove: (id: string) => void;
}

export default function AgentsPanelA2aTab({
  agents,
  discovering,
  error,
  onDiscover,
  onRemove,
}: AgentsPanelA2aTabProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [showModal, setShowModal] = useState(false);
  const { delegations } = useDelegationHistory(true);
  const acp = useAcpRegistry();

  const isEmpty = agents.length === 0 && !acp.loading && acp.agents.length === 0;

  return (
    <div className="space-y-5">
      {/* Header + Discover button */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{p.a2aTabTitle}</h2>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Globe size={12} />
          {p.a2aDiscover}
        </button>
      </div>

      {/* Unified empty state when both A2A and ACP are empty */}
      {isEmpty ? (
        <NetworkEmptyState
          onDiscover={() => setShowModal(true)}
          onBrowseRegistry={acp.retry}
        />
      ) : (
        <>
          {/* Remote A2A agent list */}
          {agents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-gradient-to-b from-card/80 to-card/40 p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-3">
                <Globe size={20} className="text-muted-foreground/50" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-muted-foreground mb-1">{p.a2aTabEmpty}</p>
              <p className="text-xs text-muted-foreground/70 leading-relaxed max-w-xs mx-auto">
                {p.a2aTabEmptyHint}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => (
                <RemoteAgentRow key={agent.id} agent={agent} onRemove={onRemove} removeCopy={p.a2aRemoveAgent} skillsCopy={p.a2aSkills} />
              ))}
            </div>
          )}

          {/* ACP Registry section */}
          <AcpRegistrySection />

          {/* Recent Delegations */}
          <DelegationHistorySection delegations={delegations} />
        </>
      )}

      <DiscoverAgentModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onDiscover={onDiscover}
        discovering={discovering}
        error={error}
      />
    </div>
  );
}

/* ────────── Network Empty State ────────── */

function NetworkEmptyState({
  onDiscover,
  onBrowseRegistry,
}: {
  onDiscover: () => void;
  onBrowseRegistry: () => void;
}) {
  const { t } = useLocale();
  const p = t.panels.agents;

  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-gradient-to-b from-card/80 to-card/40 p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-4">
        <Network size={22} className="text-muted-foreground/50" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{p.networkEmptyTitle}</p>
      <p className="text-xs text-muted-foreground/70 leading-relaxed max-w-sm mx-auto mb-5">
        {p.networkEmptyDesc}
      </p>
      <div className="flex items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onDiscover}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Globe size={12} />
          {p.networkDiscoverBtn}
        </button>
        <button
          type="button"
          onClick={onBrowseRegistry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Network size={12} />
          {p.networkBrowseBtn}
        </button>
      </div>
    </div>
  );
}

/* ────────── Quick Actions ────────── */

interface QuickAction {
  labelKey: 'acpQuickReview' | 'acpQuickFix' | 'acpQuickExplain';
  icon: typeof Code2;
  promptSuffix: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { labelKey: 'acpQuickReview', icon: Code2, promptSuffix: 'review the code in this project' },
  { labelKey: 'acpQuickFix', icon: Wrench, promptSuffix: 'find and fix bugs in this project' },
  { labelKey: 'acpQuickExplain', icon: MessageSquare, promptSuffix: 'explain the structure of this project' },
];

/* ────────── ACP Registry Section ────────── */

function AcpRegistrySection() {
  const { t } = useLocale();
  const p = t.panels.agents;
  const acp = useAcpRegistry();
  const detection = useAcpDetection();
  const acpConfig = useAcpConfig();
  const [showAvailable, setShowAvailable] = useState(false);

  if (acp.loading) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {p.acpSectionTitle}
        </h3>
        <div className="flex items-center justify-center py-6 gap-2">
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{p.acpLoading}</span>
        </div>
      </div>
    );
  }

  if (acp.error) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {p.acpSectionTitle}
        </h3>
        <div className="rounded-lg border border-border/60 bg-card/80 p-4 text-center">
          <p className="text-xs text-muted-foreground mb-2">{p.acpLoadFailed}</p>
          <button
            type="button"
            onClick={acp.retry}
            className="text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {p.acpRetry}
          </button>
        </div>
      </div>
    );
  }

  if (acp.agents.length === 0) return null;

  const installedAgents: { agent: AcpRegistryEntry; info: { id: string; name: string; binaryPath: string } }[] = [];
  const notInstalledAgents: { agent: AcpRegistryEntry; installCmd: string | null; packageName: string | null }[] = [];

  for (const agent of acp.agents) {
    const installed = detection.installedAgents.find((d) => d.id === agent.id);
    if (installed) {
      installedAgents.push({ agent, info: installed });
    } else {
      const notInstalled = detection.notInstalledAgents.find((d) => d.id === agent.id);
      notInstalledAgents.push({
        agent,
        installCmd: notInstalled?.installCmd ?? null,
        packageName: notInstalled?.packageName ?? agent.packageName ?? null,
      });
    }
  }

  return (
    <div className="space-y-3">
      {/* ── Installed Agents ── */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {p.acpSectionTitle}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => detection.refresh()}
            disabled={detection.loading}
            className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <RefreshCw size={10} className={detection.loading ? 'animate-spin' : ''} />
            {p.acpScan}
          </button>
          {installedAgents.length > 0 && (
            <span className="text-2xs text-muted-foreground/60">
              {p.acpSectionDesc(installedAgents.length)}
            </span>
          )}
        </div>
      </div>

      {installedAgents.length > 0 ? (
        <div className="space-y-2">
          {installedAgents.map(({ agent, info }) => (
            <AcpAgentCard
              key={agent.id}
              agent={agent}
              installed={info}
              detectionDone={!detection.loading}
              acpConfig={acpConfig}
            />
          ))}
        </div>
      ) : !detection.loading ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/40 p-5 text-center">
          <p className="text-xs text-muted-foreground/70 leading-relaxed max-w-xs mx-auto">
            {p.acpNoInstalled}
          </p>
        </div>
      ) : null}

      {/* ── Available (Not Installed) — collapsed by default, shown only after detection completes ── */}
      {!detection.loading && notInstalledAgents.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAvailable(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {showAvailable ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span className="font-medium">{p.acpAvailableTitle}</span>
            <span className="text-2xs">({p.acpAvailableDesc(notInstalledAgents.length)})</span>
          </button>

          {showAvailable && (
            <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
              {notInstalledAgents.map(({ agent, installCmd, packageName }) => (
                <AcpAgentCompactRow
                  key={agent.id}
                  agent={agent}
                  installCmd={installCmd}
                  packageName={packageName}
                  detectionDone={!detection.loading}
                  onInstalled={detection.refresh}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────── ACP Agent Card (Installed — prominent) ────────── */

const TRANSPORT_STYLES: Record<string, string> = {
  npx: 'bg-[var(--amber)]/15 text-[var(--amber)]',
  binary: 'bg-muted text-muted-foreground',
  uvx: 'bg-[var(--success)]/15 text-[var(--success)]',
  stdio: 'bg-muted text-muted-foreground',
};

function AcpAgentCard({ agent, installed, detectionDone, acpConfig }: {
  agent: AcpRegistryEntry;
  installed: { id: string; name: string; binaryPath: string; resolvedCommand?: { cmd: string; args: string[]; source: string } } | null;
  detectionDone: boolean;
  acpConfig: ReturnType<typeof useAcpConfig>;
}) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [configOpen, setConfigOpen] = useState(false);
  const [editCmd, setEditCmd] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const transportLabels: Record<string, string> = {
    npx: p.acpTransportNpx,
    binary: p.acpTransportBinary,
    uvx: p.acpTransportUvx,
    stdio: p.acpTransportStdio,
  };

  const isReady = !!installed;
  const resolved = installed?.resolvedCommand;
  const sourceLabel = resolved?.source === 'user-override' ? p.acpConfigSourceUser
    : resolved?.source === 'descriptor' ? p.acpConfigSourceBuiltin
    : p.acpConfigSourceRegistry;

  const handleToggleConfig = useCallback(() => {
    if (!configOpen && resolved) {
      // Pre-fill with current resolved values
      setEditCmd(resolved.cmd);
      setEditArgs(resolved.args.join(' '));
    }
    setConfigOpen(v => !v);
    setSaveState('idle');
  }, [configOpen, resolved]);

  const handleSave = useCallback(async () => {
    const args = editArgs.trim() ? editArgs.trim().split(/\s+/) : [];
    const ok = await acpConfig.save(agent.id, {
      command: editCmd.trim() || undefined,
      args: args.length > 0 ? args : undefined,
    });
    if (ok) {
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    }
  }, [acpConfig, agent.id, editCmd, editArgs]);

  const handleReset = useCallback(async () => {
    await acpConfig.reset(agent.id);
    setSaveState('idle');
    setConfigOpen(false);
  }, [acpConfig, agent.id]);

  const handleUse = () => {
    openAskModal('', 'user', { id: agent.id, name: agent.name });
  };

  const handleQuickAction = (action: QuickAction) => {
    openAskModal(action.promptSuffix, 'user', { id: agent.id, name: agent.name });
  };

  return (
    <div className="rounded-xl border border-[var(--amber)]/20 bg-card p-3 hover:border-[var(--amber)]/40 transition-all duration-150">
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-[var(--amber)]/10 flex items-center justify-center shrink-0">
          <Network size={14} className="text-[var(--amber)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
            {agent.version && (
              <span className="text-2xs text-muted-foreground/60 shrink-0">v{agent.version}</span>
            )}
          </div>
          {agent.description && (
            <p className="text-2xs text-muted-foreground truncate">{agent.description}</p>
          )}
        </div>
        <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${TRANSPORT_STYLES[agent.transport] ?? TRANSPORT_STYLES.stdio}`}>
          {transportLabels[agent.transport] ?? agent.transport}
        </span>
        {detectionDone && (
          <span className="text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 bg-[var(--success)]/15 text-[var(--success)]">
            {p.acpReady}
          </span>
        )}
        <button
          type="button"
          onClick={handleToggleConfig}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={p.acpConfigToggle}
          aria-expanded={configOpen}
        >
          <Settings2 size={13} />
        </button>
        <button
          type="button"
          onClick={handleUse}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <Zap size={10} />
          {p.acpUseAgent}
        </button>
      </div>

      {/* Collapsible config section */}
      {configOpen && resolved && (
        <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-2">
          {/* Command */}
          <div className="flex items-center gap-2">
            <label className="text-2xs text-muted-foreground w-12 shrink-0">{p.acpConfigCommand}</label>
            <input
              type="text"
              value={editCmd}
              onChange={e => { setEditCmd(e.target.value); setSaveState('idle'); }}
              className="flex-1 rounded-md border border-border bg-background text-foreground text-xs font-mono px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={resolved.cmd}
            />
          </div>
          {/* Args */}
          <div className="flex items-center gap-2">
            <label className="text-2xs text-muted-foreground w-12 shrink-0">{p.acpConfigArgs}</label>
            <input
              type="text"
              value={editArgs}
              onChange={e => { setEditArgs(e.target.value); setSaveState('idle'); }}
              className="flex-1 rounded-md border border-border bg-background text-foreground text-xs font-mono px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={resolved.args.join(' ')}
            />
          </div>
          {/* Status row */}
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span>{p.acpConfigSource}:</span>
            <span className={`px-1.5 py-0.5 rounded font-medium ${
              resolved.source === 'user-override' ? 'bg-[var(--amber)]/15 text-[var(--amber)]'
              : 'bg-muted text-muted-foreground'
            }`}>{sourceLabel}</span>
            <span className="text-muted-foreground/50">|</span>
            <span>{p.acpConfigPath}: <span className="font-mono">{installed?.binaryPath}</span></span>
          </div>
          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {acpConfig.configs[agent.id] && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw size={10} />
                {p.acpConfigReset}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={acpConfig.saving}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {saveState === 'saved' ? <><Check size={10} /> {p.acpConfigSaved}</> : <><Save size={10} /> {p.acpConfigSave}</>}
            </button>
          </div>
        </div>
      )}

      {/* Quick action chips */}
      {isReady && !configOpen && (
        <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center gap-1.5 flex-wrap">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.labelKey}
                type="button"
                onClick={() => handleQuickAction(action)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-md bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon size={10} />
                {p[action.labelKey]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ────────── ACP Agent Compact Row (Not Installed — subtle) ────────── */

function AcpAgentCompactRow({ agent, installCmd }: {
  agent: AcpRegistryEntry;
  installCmd: string | null;
  packageName: string | null;
  detectionDone: boolean;
  onInstalled: () => void;
}) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [copied, setCopied] = useState(false);

  const effectiveCmd = installCmd || (agent.packageName ? `npm install -g ${agent.packageName}` : null);

  const handleCopy = useCallback(() => {
    if (!effectiveCmd) return;
    navigator.clipboard.writeText(effectiveCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [effectiveCmd]);

  return (
    <div className="group rounded-lg border border-border/60 bg-card/60 px-3 py-2 hover:border-border transition-all duration-150">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-muted/40 flex items-center justify-center shrink-0">
          <Network size={11} className="text-muted-foreground/60" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{agent.name}</p>
          {agent.description && (
            <p className="text-2xs text-muted-foreground/50 truncate">{agent.description}</p>
          )}
        </div>
        {effectiveCmd && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
            title={effectiveCmd}
          >
            {copied ? (
              <><Check size={10} /> {p.acpCopied}</>
            ) : (
              <><Code2 size={10} /> {p.acpCopyCmd}</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ────────── Delegation History Section ────────── */

function DelegationHistorySection({ delegations }: { delegations: DelegationRecord[] }) {
  const { t } = useLocale();
  const p = t.panels.agents;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {p.a2aDelegations}
      </h3>
      {delegations.length === 0 ? (
        <p className="text-xs text-muted-foreground/70 py-3">{p.a2aDelegationsEmpty}</p>
      ) : (
        <div className="space-y-1.5">
          {delegations.map((d) => (
            <DelegationRow key={d.id} record={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────── Delegation Row ────────── */

const STATUS_STYLES: Record<DelegationRecord['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  completed: 'bg-[var(--success)]/15 text-[var(--success)]',
  failed: 'bg-[var(--error)]/15 text-[var(--error)]',
};

function DelegationRow({ record }: { record: DelegationRecord }) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const statusLabels: Record<DelegationRecord['status'], string> = {
    pending: p.a2aDelegationPending,
    completed: p.a2aDelegationCompleted,
    failed: p.a2aDelegationFailed,
  };

  const duration = record.completedAt
    ? formatDuration(new Date(record.startedAt), new Date(record.completedAt))
    : null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/80 px-3 py-2.5 flex items-center gap-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{record.agentName}</p>
        <p className="text-2xs text-muted-foreground truncate" title={record.message}>
          {record.message.length > 60 ? record.message.slice(0, 60) + '...' : record.message}
        </p>
      </div>
      <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_STYLES[record.status]}`}>
        {statusLabels[record.status]}
      </span>
      {duration && (
        <span className="text-2xs text-muted-foreground/60 shrink-0 flex items-center gap-0.5">
          <Clock size={10} aria-hidden="true" />
          {duration}
        </span>
      )}
    </div>
  );
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

/* ────────── Remote Agent Row ────────── */

function RemoteAgentRow({
  agent,
  onRemove,
  removeCopy,
  skillsCopy,
}: {
  agent: RemoteAgent;
  onRemove: (id: string) => void;
  removeCopy: string;
  skillsCopy: string;
}) {
  const StatusIcon = agent.reachable ? Wifi : WifiOff;
  const statusColor = agent.reachable
    ? 'text-[var(--success)]'
    : 'text-muted-foreground/50';

  return (
    <div className="group rounded-xl border border-border bg-card p-3.5 hover:border-[var(--amber)]/30 transition-all duration-150">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
          <Globe size={14} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{agent.card.name}</p>
          <p className="text-2xs text-muted-foreground truncate">{agent.card.description}</p>
        </div>
        <StatusIcon size={13} className={statusColor} aria-hidden="true" />
        <button
          type="button"
          onClick={() => onRemove(agent.id)}
          className="p-1.5 rounded-md text-muted-foreground/50 hover:text-error hover:bg-error/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
          aria-label={removeCopy}
          title={removeCopy}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {agent.card.skills.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center gap-1.5">
          <Zap size={11} className="text-muted-foreground/60 shrink-0" aria-hidden="true" />
          <span className="text-2xs text-muted-foreground">{skillsCopy}: {agent.card.skills.length}</span>
          <div className="flex flex-wrap gap-1 ml-1">
            {agent.card.skills.slice(0, 3).map((s) => (
              <span
                key={s.id}
                className="text-2xs px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50"
                title={s.description}
              >
                {s.name}
              </span>
            ))}
            {agent.card.skills.length > 3 && (
              <span className="text-2xs text-muted-foreground/60">+{agent.card.skills.length - 3}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
