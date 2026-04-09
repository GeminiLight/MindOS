'use client';

import { useState, useCallback } from 'react';
import { Check, ChevronDown, ChevronUp, Clock, Code2, Globe, Loader2, MessageSquare, Network, RefreshCw, RotateCcw, Save, Settings2, Trash2, Wifi, WifiOff, Wrench, Zap } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { useAcpConfig } from '@/hooks/useAcpConfig';
import type { AcpRegistryEntry } from '@/lib/acp/types';
import { useAcpRegistry } from '@/hooks/useAcpRegistry';
import { useAcpDetection } from '@/hooks/useAcpDetection';
import { openAskModal } from '@/hooks/useAskModal';
import DiscoverAgentModal from './DiscoverAgentModal';

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

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border/30 bg-card/50 p-3 motion-safe:animate-pulse" aria-hidden="true">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-muted/60 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 bg-muted/60 rounded w-28" />
          <div className="h-2.5 bg-muted/40 rounded w-48" />
        </div>
        <div className="h-5 bg-muted/40 rounded w-10" />
      </div>
    </div>
  );
}

export default function AcpRegistrySection() {
  const { t } = useLocale();
  const p = t.panels.agents;
  const acp = useAcpRegistry();
  const detection = useAcpDetection();
  const acpConfig = useAcpConfig();
  const [showAvailable, setShowAvailable] = useState(false);

  /* [U-1][R-4] Skeleton loading state */
  if (acp.loading) {
    return (
      <div className="space-y-2" role="status" aria-label={p.acpLoading}>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]"><Network size={13} /></div>
          {p.acpSectionTitle}
        </h3>
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <p className="sr-only">{p.acpLoading}</p>
      </div>
    );
  }

  /* [U-3] Improved error state with context */
  if (acp.error) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]"><Network size={13} /></div>
          {p.acpSectionTitle}
        </h3>
        <div className="rounded-lg border border-border/60 bg-card/80 p-4 text-center" role="alert">
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
    <section className="space-y-3" aria-labelledby="acp-section-title">
      {/* ── Section header ── [V-1] clear hierarchy */}
      <div className="flex items-center justify-between">
        <h3 id="acp-section-title" className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]"><Network size={13} /></div>
          {p.acpSectionTitle}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => detection.refresh()}
            disabled={detection.loading}
            aria-label={p.acpScan}
            className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <RefreshCw size={10} className={detection.loading ? 'motion-safe:animate-spin' : ''} />
            {p.acpScan}
          </button>
          {installedAgents.length > 0 && (
            <span className="text-2xs text-muted-foreground/50">
              {p.acpSectionDesc(installedAgents.length)}
            </span>
          )}
        </div>
      </div>

      {/* ── Installed agents — [A-3] semantic list, [C-2] shadow for depth ── */}
      {detection.loading ? (
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : installedAgents.length > 0 ? (
        <ul role="list" className="space-y-2">
          {installedAgents.map(({ agent, info }) => (
            <li key={agent.id}>
              <AcpAgentCard
                agent={agent}
                installed={info}
                detectionDone={!detection.loading}
                acpConfig={acpConfig}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-border/40 bg-card/30 p-4 text-center">
          <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-xs mx-auto">
            {p.acpNoInstalled}
          </p>
        </div>
      )}

      {/* ── Available (Not Installed) — [A-2] aria-expanded ── */}
      {!detection.loading && notInstalledAgents.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAvailable(v => !v)}
            aria-expanded={showAvailable}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {showAvailable ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span className="font-medium">{p.acpAvailableTitle}</span>
            <span className="text-2xs">({p.acpAvailableDesc(notInstalledAgents.length)})</span>
          </button>

          {showAvailable && (
            <ul role="list" className="space-y-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 duration-150">
              {notInstalledAgents.map(({ agent, installCmd, packageName }) => (
                <li key={agent.id}>
                  <AcpAgentCompactRow
                    agent={agent}
                    installCmd={installCmd}
                    packageName={packageName}
                    detectionDone={!detection.loading}
                    onInstalled={detection.refresh}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ────────── ACP Agent Card (Installed — prominent) ────────── */

/* [C-3] Unified badge styles — low saturation for metadata, high for status */
const TRANSPORT_STYLES: Record<string, string> = {
  npx: 'bg-muted text-muted-foreground',
  binary: 'bg-muted text-muted-foreground',
  uvx: 'bg-muted text-muted-foreground',
  stdio: 'bg-muted text-muted-foreground',
};

export function AcpAgentCard({ agent, installed, detectionDone, acpConfig }: {
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
      setTimeout(() => setSaveState('idle'), 3000);
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
    /* [C-2] shadow-sm for installed cards; [S-1] p-4 (16px) */
    <div className="rounded-lg border border-[var(--amber)]/20 bg-card shadow-sm hover:border-[var(--amber)]/40 transition-colors duration-150 p-4">
      {/* Header row — [V-1] stronger agent name, [V-2] weaker metadata */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[var(--amber)]/10 flex items-center justify-center shrink-0">
          <Network size={14} className="text-[var(--amber)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {/* [V-1] agent name is 16px semibold — most prominent element */}
            <p className="text-base font-semibold text-foreground truncate leading-tight">{agent.name}</p>
            {agent.version && (
              <span className="text-2xs text-muted-foreground/40 shrink-0">v{agent.version}</span>
            )}
          </div>
          {/* [V-2] description is muted and smaller — weaker than name */}
          {agent.description && (
            <p className="text-2xs text-muted-foreground/50 truncate mt-0.5">{agent.description}</p>
          )}
        </div>
        {/* [V-2][C-3] transport badge — low saturation, metadata-level */}
        <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${TRANSPORT_STYLES[agent.transport] ?? TRANSPORT_STYLES.stdio}`}>
          {transportLabels[agent.transport] ?? agent.transport}
        </span>
        {/* [V-2] "Ready" badge — only high-saturation badge */}
        {detectionDone && (
          <span className="text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 bg-[var(--success)]/15 text-[var(--success)]">
            {p.acpReady}
          </span>
        )}
        {/* [A-1] aria-label for icon-only button; [P-2] aria-expanded */}
        <button
          type="button"
          onClick={handleToggleConfig}
          aria-label={p.acpConfigToggle}
          aria-expanded={configOpen}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          onClick={handleUse}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)]/10 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <Zap size={10} />
          {p.acpUseAgent}
        </button>
      </div>

      {/* Collapsible config section — [U-5] more breathing room, [S-3] larger inputs */}
      {configOpen && resolved && (
        <div className="mt-3 pt-3 border-t border-border/40 space-y-3 bg-muted/10 -mx-4 px-4 pb-4 rounded-b-lg">
          {/* Command */}
          <div className="flex items-center gap-2">
            <label className="text-2xs text-muted-foreground w-12 shrink-0">{p.acpConfigCommand}</label>
            <input
              type="text"
              value={editCmd}
              onChange={e => { setEditCmd(e.target.value); setSaveState('idle'); }}
              className="flex-1 rounded-md border border-border bg-background text-foreground text-xs font-mono px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="flex-1 rounded-md border border-border bg-background text-foreground text-xs font-mono px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={resolved.args.join(' ')}
            />
          </div>
          {/* Status row */}
          <div className="flex items-center gap-2 text-2xs text-muted-foreground/60">
            <span>{p.acpConfigSource}:</span>
            <span className={`px-1.5 py-0.5 rounded ${
              resolved.source === 'user-override' ? 'bg-[var(--amber)]/15 text-[var(--amber)]'
              : 'bg-muted text-muted-foreground'
            }`}>{sourceLabel}</span>
            <span className="text-muted-foreground/30">|</span>
            <span>{p.acpConfigPath}: <span className="font-mono">{installed?.binaryPath}</span></span>
          </div>
          {/* Action buttons — [S-1] pt-2 for separation */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {acpConfig.configs[agent.id] && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw size={10} />
                {p.acpConfigReset}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={acpConfig.saving}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {saveState === 'saved' ? <><Check size={10} /> {p.acpConfigSaved}</> : <><Save size={10} /> {p.acpConfigSave}</>}
            </button>
          </div>
        </div>
      )}

      {/* Quick action chips — [V-3] always visible, clear grouping */}
      {isReady && !configOpen && (
        <div className="mt-3 pt-2.5 border-t border-border/30 flex items-center gap-1.5 flex-wrap">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.labelKey}
                type="button"
                onClick={() => handleQuickAction(action)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-md bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border/50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

export function AcpAgentCompactRow({ agent, installCmd }: {
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

  /* [U-2] copy with longer feedback (3s) */
  const handleCopy = useCallback(() => {
    if (!effectiveCmd) return;
    navigator.clipboard.writeText(effectiveCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {});
  }, [effectiveCmd]);

  return (
    /* [P-3] list-row style for not-installed — clearly different from installed cards */
    <div className="group rounded-md border border-border/40 bg-card/40 px-3 py-2 hover:border-border/60 transition-colors duration-150">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-muted/30 flex items-center justify-center shrink-0">
          <Network size={11} className="text-muted-foreground/40" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{agent.name}</p>
          {agent.description && (
            <p className="text-2xs text-muted-foreground/40 truncate">{agent.description}</p>
          )}
        </div>
        {effectiveCmd && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={`${p.acpCopyCmd}: ${effectiveCmd}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
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

