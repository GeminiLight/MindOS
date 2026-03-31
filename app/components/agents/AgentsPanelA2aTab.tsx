'use client';

import { useState } from 'react';
import { Clock, Download, Globe, Loader2, Network, RefreshCw, Trash2, Wifi, WifiOff, Zap } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
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

/* ────────── ACP Registry Section ────────── */

function AcpRegistrySection() {
  const { t } = useLocale();
  const p = t.panels.agents;
  const acp = useAcpRegistry();
  const detection = useAcpDetection();

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

  return (
    <div className="space-y-2">
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
          <span className="text-2xs text-muted-foreground/60">
            {p.acpSectionDesc(acp.agents.length)}
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        {acp.agents.map((agent) => {
          const installed = detection.installedAgents.find((d) => d.id === agent.id);
          const notInstalled = detection.notInstalledAgents.find((d) => d.id === agent.id);
          return (
            <AcpAgentRow
              key={agent.id}
              agent={agent}
              installed={installed ?? null}
              installCmd={notInstalled?.installCmd ?? null}
              packageName={notInstalled?.packageName ?? agent.packageName ?? null}
              detectionDone={!detection.loading}
              onInstalled={detection.refresh}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ────────── ACP Agent Row ────────── */

const TRANSPORT_STYLES: Record<string, string> = {
  npx: 'bg-[var(--amber)]/15 text-[var(--amber)]',
  binary: 'bg-muted text-muted-foreground',
  uvx: 'bg-[var(--success)]/15 text-[var(--success)]',
  stdio: 'bg-muted text-muted-foreground',
};

function AcpAgentRow({ agent, installed, installCmd, packageName, detectionDone, onInstalled }: {
  agent: AcpRegistryEntry;
  installed: { id: string; name: string; binaryPath: string } | null;
  installCmd: string | null;
  packageName: string | null;
  detectionDone: boolean;
  onInstalled: () => void;
}) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const transportLabels: Record<string, string> = {
    npx: p.acpTransportNpx,
    binary: p.acpTransportBinary,
    uvx: p.acpTransportUvx,
    stdio: p.acpTransportStdio,
  };

  const isReady = !!installed;

  const handleUse = () => {
    openAskModal(`Use ${agent.name} to help me with `);
    window.dispatchEvent(
      new CustomEvent('mindos:ask-with-agent', {
        detail: { agentId: agent.id, agentName: agent.name },
      }),
    );
  };

  const handleInstall = async () => {
    if (!packageName || installState === 'installing') return;
    setInstallState('installing');
    try {
      const res = await fetch('/api/acp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, packageName }),
      });
      if (!res.ok) {
        setInstallState('error');
        return;
      }
      // Wait a bit for npm install to complete, then re-detect
      await new Promise((r) => setTimeout(r, 8000));
      onInstalled();
      setInstallState('done');
    } catch {
      setInstallState('error');
    }
  };

  return (
    <div className="group rounded-xl border border-border bg-card p-3 hover:border-border/80 transition-all duration-150">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
          <Network size={14} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
          {agent.description && (
            <p className="text-2xs text-muted-foreground truncate">{agent.description}</p>
          )}
        </div>
        <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${TRANSPORT_STYLES[agent.transport] ?? TRANSPORT_STYLES.stdio}`}>
          {transportLabels[agent.transport] ?? agent.transport}
        </span>
        {detectionDone && (
          <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
            isReady
              ? 'bg-[var(--success)]/15 text-[var(--success)]'
              : 'bg-muted text-muted-foreground/60'
          }`}>
            {isReady ? p.acpReady : p.acpNotInstalled}
          </span>
        )}
        {detectionDone && !isReady && packageName && (
          <button
            type="button"
            disabled={installState === 'installing'}
            onClick={handleInstall}
            className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            title={installCmd ? p.acpInstallHint(installCmd) : undefined}
          >
            {installState === 'installing' ? (
              <><Loader2 size={10} className="animate-spin" /> {p.acpInstalling}</>
            ) : (
              <><Download size={10} /> {p.acpInstall}</>
            )}
          </button>
        )}
        <button
          type="button"
          disabled={!isReady}
          onClick={handleUse}
          className={`inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isReady
              ? 'border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)]/10 cursor-pointer'
              : 'border-border text-muted-foreground/50 cursor-not-allowed'
          }`}
          title={
            isReady
              ? undefined
              : installCmd
                ? p.acpInstallHint(installCmd)
                : p.acpComingSoon
          }
        >
          {p.acpUseAgent}
        </button>
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
