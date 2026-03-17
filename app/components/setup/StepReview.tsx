'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react';
import type { SetupState, SetupMessages, AgentInstallStatus } from './types';

// ─── Restart Block ────────────────────────────────────────────────────────────
function RestartBlock({ s, newPort }: { s: SetupMessages; newPort: number }) {
  const [restarting, setRestarting] = useState(false);
  const [done, setDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Cleanup polling interval on unmount
  useEffect(() => () => { clearInterval(pollRef.current); }, []);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await fetch('/api/restart', { method: 'POST' });
      setDone(true);
      const redirect = () => { window.location.href = `http://localhost:${newPort}/?welcome=1`; };
      // Poll the new port until ready, then redirect
      let attempts = 0;
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`http://localhost:${newPort}/api/health`);
          if (r.status < 500) { clearInterval(pollRef.current); redirect(); return; }
        } catch { /* not ready yet */ }
        if (attempts >= 10) { clearInterval(pollRef.current); redirect(); }
      }, 800);
    } catch (e) {
      console.warn('[SetupWizard] restart request failed:', e);
      setRestarting(false);
    }
  };

  if (done) {
    return (
      <div className="p-3 rounded-lg text-sm flex items-center gap-2"
        style={{ background: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)' }}>
        <CheckCircle2 size={14} /> {s.restartDone}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg text-sm flex items-center gap-2"
        style={{ background: 'color-mix(in srgb, var(--amber) 10%, transparent)', color: 'var(--amber)' }}>
        <AlertTriangle size={14} /> {s.restartRequired}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRestart}
          disabled={restarting}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
          style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
          {restarting ? <Loader2 size={13} className="animate-spin" /> : null}
          {restarting ? s.restarting : s.restartNow}
        </button>
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {s.restartManual} <code className="font-mono">mindos start</code>
        </span>
      </div>
    </div>
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
  skillInstallResult: { ok?: boolean; skill?: string; error?: string } | null;
  setupPhase: 'review' | 'saving' | 'agents' | 'skill' | 'done';
}

export default function StepReview({
  state, selectedAgents, agentStatuses, onRetryAgent, error, needsRestart, s,
  skillInstallResult, setupPhase,
}: StepReviewProps) {
  const failedAgents = Object.entries(agentStatuses).filter(([, v]) => v.state === 'error');

  // Compact config summary (only key info)
  const summaryRows: [string, string][] = [
    [s.kbPath, state.mindRoot],
    [s.webPort, `${state.webPort} / ${state.mcpPort}`],
    [s.agentToolsTitle, selectedAgents.size > 0 ? s.agentCountSummary(selectedAgents.size) : '—'],
  ];

  // Progress stepper phases
  type Phase = typeof setupPhase;
  const phases: { key: Phase; label: string }[] = [
    { key: 'saving', label: s.phaseSaving },
    { key: 'agents', label: s.phaseAgents },
    { key: 'skill', label: s.phaseSkill },
    { key: 'done', label: s.phaseDone },
  ];
  const phaseOrder: Phase[] = ['saving', 'agents', 'skill', 'done'];
  const currentIdx = phaseOrder.indexOf(setupPhase);

  return (
    <div className="space-y-5">
      {/* Compact config summary */}
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

      {/* Before submit: review hint */}
      {setupPhase === 'review' && (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{s.reviewHint}</p>
      )}

      {/* Progress stepper — visible during/after setup */}
      {setupPhase !== 'review' && (
        <div className="space-y-2 py-2">
          {phases.map(({ key, label }, i) => {
            const idx = phaseOrder.indexOf(key);
            const isDone = currentIdx > idx || (key === 'done' && setupPhase === 'done');
            const isActive = setupPhase === key && key !== 'done';
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

      {/* Skill result — compact */}
      {skillInstallResult && setupPhase === 'done' && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{
          background: skillInstallResult.ok ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--error) 6%, transparent)',
        }}>
          {skillInstallResult.ok ? (
            <><CheckCircle2 size={11} className="text-success shrink-0" />
            <span style={{ color: 'var(--foreground)' }}>{s.skillInstalled} — {skillInstallResult.skill}</span></>
          ) : (
            <><XCircle size={11} className="text-error shrink-0" />
            <span style={{ color: 'var(--error)' }}>{s.skillFailed}{skillInstallResult.error ? `: ${skillInstallResult.error}` : ''}</span></>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-sm text-error" style={{ background: 'color-mix(in srgb, var(--error) 10%, transparent)' }}>
          {s.completeFailed}: {error}
        </div>
      )}
      {needsRestart && setupPhase === 'done' && <RestartBlock s={s} newPort={state.webPort} />}
    </div>
  );
}
