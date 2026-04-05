'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, Copy, Check,
  FolderOpen, Brain, Plug, Shield,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import type { SetupState, SetupMessages, AgentInstallStatus } from './types';
import { PROVIDER_PRESETS, isProviderId } from '@/lib/agent/providers';
import { useLocale } from '@/lib/stores/locale-store';

// ─── Restart Block ────────────────────────────────────────────────────────────

/** Restart warning banner — shown in the content area */
export function RestartBanner({ s }: { s: SetupMessages }) {
  return (
    <div className="space-y-2">
      <div className="p-3 rounded-lg text-sm flex items-center gap-2"
        style={{ background: 'color-mix(in srgb, var(--amber) 10%, transparent)', color: 'var(--amber)' }}>
        <AlertTriangle size={14} /> {s.restartRequired}
      </div>
      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {s.restartManual} <code className="font-mono">mindos start</code>
      </p>
    </div>
  );
}

/** Restart button — shown in the bottom navigation bar (same position as Complete/Saving button) */
export function RestartButton({ s, newPort, webPassword }: { s: SetupMessages; newPort: number; webPassword?: string }) {
  const [restarting, setRestarting] = useState(false);
  const [done, setDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const delayRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => { clearTimeout(delayRef.current); clearInterval(pollRef.current); }, []);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      const restartRes = await fetch('/api/restart', { method: 'POST' });
      if (!restartRes.ok) throw new Error(`restart failed (${restartRes.status})`);
      setDone(true);
      const rawHost = window.location.hostname || 'localhost';
      const host = rawHost.includes(':') ? `[${rawHost}]` : rawHost;
      const baseUrl = `http://${host}:${newPort}`;
      const redirect = () => { window.location.href = `${baseUrl}/?welcome=1`; };

      let attempts = 0;
      clearInterval(pollRef.current);
      // Delay first poll to ensure the old server has been killed by `mindos restart`
      const startPoll = () => { pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`${baseUrl}/api/health`);
          if (r.status < 500) {
            clearInterval(pollRef.current);
            // Auto-authenticate so the user doesn't have to re-enter their password
            if (webPassword) {
              try {
                await fetch(`${baseUrl}/api/auth`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: webPassword }),
                  credentials: 'include',
                });
              } catch { /* auth failed — user will see login page instead */ }
            }
            redirect();
            return;
          }
        } catch { /* not ready yet */ }
        if (attempts >= 30) { clearInterval(pollRef.current); redirect(); }
      }, 800); };
      delayRef.current = setTimeout(startPoll, 2000);
    } catch (e) {
      console.warn('[SetupWizard] restart request failed:', e);
      setRestarting(false);
    }
  };

  if (done) {
    return (
      <span className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg"
        style={{ background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)' }}>
        <CheckCircle2 size={14} /> {s.restartDone}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleRestart}
      disabled={restarting}
      className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
      {restarting ? <Loader2 size={13} className="animate-spin" /> : null}
      {restarting ? s.restarting : s.restartNow}
    </button>
  );
}

// ─── Step 6: Review ───────────────────────────────────────────────────────────
export interface StepReviewProps {
  state: SetupState;
  selectedAgents: Set<string>;
  agentStatuses: Record<string, AgentInstallStatus>;
  onRetryAgent: (key: string) => void;
  error: string;
  needsRestart: boolean;
  s: SetupMessages;
  setupPhase: 'review' | 'saving' | 'agents' | 'done';
  cliEnabled: boolean;
  mcpEnabled: boolean;
}

export default function StepReview({
  state, selectedAgents, agentStatuses, onRetryAgent, error, needsRestart, s,
  setupPhase, cliEnabled, mcpEnabled,
}: StepReviewProps) {
  const failedAgents = Object.entries(agentStatuses).filter(([, v]) => v.state === 'error');

  // Compact config summary (only key info)
  const modeLabel = cliEnabled && mcpEnabled ? 'CLI + MCP' : cliEnabled ? 'CLI' : mcpEnabled ? 'MCP' : '—';
  const summaryRows: [string, string][] = [
    [s.kbPath, state.mindRoot],
    [s.webPort, `${state.webPort} / ${state.mcpPort}`],
    [s.agentToolsTitle, mcpEnabled && selectedAgents.size > 0 ? `${modeLabel} · ${s.agentCountSummary(selectedAgents.size)}` : modeLabel],
  ];

  // Progress stepper phases — dynamically built based on selected modes
  type Phase = typeof setupPhase;
  const showAgentPhase = mcpEnabled && selectedAgents.size > 0;
  const phases: { key: Phase; label: string }[] = [
    { key: 'saving', label: s.phaseSaving },
    ...(showAgentPhase ? [{ key: 'agents' as Phase, label: s.phaseAgents }] : []),
    { key: 'done', label: s.phaseDone },
  ];
  const phaseOrder: Phase[] = phases.map(p => p.key);
  const currentIdx = phaseOrder.indexOf(setupPhase);

  return (
    <div className="space-y-5">
      {/* Compact config summary — hidden once done (health check replaces it) */}
      {setupPhase !== 'done' && (
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {summaryRows.map(([label, value], i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm"
            style={{
              background: i % 2 === 0 ? 'var(--card)' : 'transparent',
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
            }}>
            <span style={{ color: 'var(--muted-foreground)' }}>{label}</span>
            <span className="font-mono text-xs truncate ml-4" style={{ color: 'var(--foreground)' }}>{value}</span>
          </div>
        ))}
      </div>
      )}

      {/* Before submit: review hint */}
      {setupPhase === 'review' && (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{s.reviewHint}</p>
      )}

      {/* Progress stepper — visible during setup, hidden once done */}
      {setupPhase !== 'review' && setupPhase !== 'done' && (
        <div className="space-y-2 py-2">
          {phases.map(({ key, label }, i) => {
            const idx = phaseOrder.indexOf(key);
            const isDone = currentIdx > idx;
            const isActive = setupPhase === key;
            const isPending = currentIdx < idx;
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-2xs"
                  style={{
                    background: isDone ? 'color-mix(in srgb, var(--success) 15%, transparent)' : isActive ? 'color-mix(in srgb, var(--amber) 15%, transparent)' : 'var(--muted)',
                    color: isDone ? 'var(--success)' : isActive ? 'var(--amber)' : 'var(--muted-foreground)',
                  }}>
                  {isDone ? <CheckCircle2 size={12} /> : isActive ? <Loader2 size={12} className="animate-spin" /> : (i + 1)}
                </div>
                <span className="text-sm" style={{
                  color: isDone ? 'var(--success)' : isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontWeight: isActive ? 500 : 400,
                  opacity: isPending ? 0.5 : 1,
                }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Agent failures — expandable */}
      {failedAgents.length > 0 && setupPhase === 'done' && (
        <div className="p-3 rounded-lg space-y-2" style={{ background: 'color-mix(in srgb, var(--error) 8%, transparent)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--error)' }}>
            {s.agentFailedCount(failedAgents.length)}
          </p>
          {failedAgents.map(([key, st]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-xs flex items-center gap-1" style={{ color: 'var(--error)' }}>
                <XCircle size={11} /> {key}{st.message ? ` — ${st.message}` : ''}
              </span>
              {/* Retry button — no disabled guard needed: once clicked, state becomes
                 'installing' and this entry is filtered out of failedAgents */}
              <button
                type="button"
                onClick={() => onRetryAgent(key)}
                className="text-xs px-2 py-0.5 rounded border transition-colors"
                style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
                {s.retryAgent}
              </button>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{s.agentFailureNote}</p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-sm text-error" style={{ background: 'color-mix(in srgb, var(--error) 10%, transparent)' }}>
          {s.completeFailed}: {error}
        </div>
      )}

      {/* Health Check Summary — shown when setup is done */}
      {setupPhase === 'done' && (
        <HealthCheckView
          state={state}
          selectedAgents={selectedAgents}
          agentStatuses={agentStatuses}
          needsRestart={needsRestart}
          s={s}
        />
      )}
    </div>
  );
}

/* ── Health Check Summary ─────────────────────────────────────────────────── */

function HealthCheckView({ state, selectedAgents, agentStatuses, needsRestart, s }: {
  state: SetupState;
  selectedAgents: Set<string>;
  agentStatuses: Record<string, AgentInstallStatus>;
  needsRestart: boolean;
  s: SetupMessages;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopyToken = useCallback(async () => {
    if (!state.authToken) return;
    const ok = await copyToClipboard(state.authToken);
    if (ok) { setCopied(true); toast.copy(); }
  }, [state.authToken]);

  const { locale } = useLocale();

  // Derive health check statuses
  const kbOk = !!state.mindRoot;
  const aiOk = state.provider !== 'skip';
  const successAgents = Object.values(agentStatuses).filter(a => a.state === 'ok').length;
  const agentsOk = successAgents > 0;
  const hasToken = !!state.authToken;

  // Resolve provider display name and model from dynamic config
  let providerDisplayName = '';
  let providerModelName = '';
  if (aiOk && isProviderId(state.provider as string)) {
    const preset = PROVIDER_PRESETS[state.provider as keyof typeof PROVIDER_PRESETS];
    providerDisplayName = locale === 'zh' ? preset.nameZh : preset.name;
    const cfg = state.providerConfigs[state.provider as keyof typeof PROVIDER_PRESETS];
    providerModelName = cfg?.model || preset.defaultModel;
  }

  const checks: Array<{
    ok: boolean;
    icon: React.ReactNode;
    title: string;
    detail: string;
    action?: string;
  }> = [
    {
      ok: kbOk,
      icon: <FolderOpen size={14} />,
      title: s.healthKb ?? 'Knowledge Base',
      detail: kbOk ? state.mindRoot : (s.healthKbNone ?? 'Not configured'),
    },
    {
      ok: aiOk,
      icon: <Brain size={14} />,
      title: s.healthAi ?? 'AI Provider',
      detail: aiOk
        ? `${providerDisplayName} (${providerModelName || 'default'})`
        : (s.healthAiNone ?? 'Not configured — AI features disabled'),
      action: aiOk ? undefined : (s.healthAiAction ?? 'Add an API key in Settings → AI.'),
    },
    {
      ok: agentsOk,
      icon: <Plug size={14} />,
      title: s.healthAgents ?? 'Agent Connection',
      detail: agentsOk
        ? (s.healthAgentsOk?.(successAgents) ?? `${successAgents} agent(s) configured`)
        : selectedAgents.size > 0
          ? (s.healthAgentsPartial ?? 'Configuration in progress...')
          : (s.healthAgentsNone ?? 'No agents configured'),
      action: agentsOk ? undefined : (s.healthAgentsAction ?? 'You can add agents later in Settings → Connections.'),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Health check items */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {checks.map(({ ok, icon, title, detail, action }, i) => (
          <div key={i}
            className="flex items-start gap-3 px-4 py-3"
            style={{
              background: i % 2 === 0 ? 'var(--card)' : 'transparent',
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
            }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{
                background: ok
                  ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                  : 'color-mix(in srgb, var(--amber) 15%, transparent)',
                color: ok ? 'var(--success)' : 'var(--amber)',
              }}>
              {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={10} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {icon} {title}
              </div>
              <p className="text-xs mt-0.5 break-words" style={{ color: ok ? 'var(--muted-foreground)' : 'var(--amber-text)' }}>
                {detail}
              </p>
              {action && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{action}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Auth Token — always shown prominently */}
      {hasToken && (
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
            <Shield size={11} />
            {s.healthTokenTitle ?? 'Auth Token'}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center px-3 py-2 rounded-lg min-h-[38px]"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}>
              <code className="flex-1 text-xs font-mono break-all select-all leading-relaxed" style={{ color: 'var(--foreground)' }}>
                {state.authToken}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopyToken}
              className="shrink-0 p-2 rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              style={{
                borderColor: copied ? 'color-mix(in srgb, var(--success) 50%, transparent)' : 'var(--border)',
                background: copied ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'transparent',
                color: copied ? 'var(--success)' : 'var(--muted-foreground)',
              }}
              title={s.healthTokenCopy ?? 'Copy token'}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {s.healthTokenHint ?? 'Use this token when connecting AI agents. Also available in Settings → Connections.'}
          </p>
        </div>
      )}

      {/* Restart banner */}
      {needsRestart && <RestartBanner s={s} />}
    </div>
  );
}
