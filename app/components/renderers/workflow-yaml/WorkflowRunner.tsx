'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, SkipForward, RotateCcw, CheckCircle2, Circle, Loader2, AlertCircle, ChevronDown, Sparkles, XCircle, Clock, ArrowRight } from 'lucide-react';
import { runStepWithAI, clearSkillCache } from './execution';
import type { WorkflowYaml, WorkflowStepRuntime, StepStatus } from './types';

function initSteps(workflow: WorkflowYaml): WorkflowStepRuntime[] {
  return workflow.steps.map((s, idx) => ({
    ...s, index: idx, status: 'pending' as const, output: '', error: undefined,
  }));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Timeline node — the colored circle on the left */
function TimelineNode({ status, index }: { status: StepStatus; index: number }) {
  const base = 'w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 transition-all';
  if (status === 'running') return (
    <div className={`${base} bg-[var(--amber)]/15 ring-2 ring-[var(--amber)]/30`}>
      <Loader2 size={12} className="text-[var(--amber)] animate-spin" />
    </div>
  );
  if (status === 'done') return (
    <div className={`${base} bg-[var(--success)]/15`}>
      <CheckCircle2 size={13} className="text-[var(--success)]" />
    </div>
  );
  if (status === 'error') return (
    <div className={`${base} bg-[var(--error)]/15`}>
      <AlertCircle size={13} className="text-[var(--error)]" />
    </div>
  );
  if (status === 'skipped') return (
    <div className={`${base} bg-muted/50`}>
      <SkipForward size={11} className="text-muted-foreground/40" />
    </div>
  );
  // pending
  return (
    <div className={`${base} border-2 border-border bg-background`}>
      <span className="text-[9px] font-bold text-muted-foreground/40">{index + 1}</span>
    </div>
  );
}

function RunStepCard({ step, canRun, onRun, onSkip, onCancel }: {
  step: WorkflowStepRuntime; canRun: boolean;
  onRun: () => void; onSkip: () => void; onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = !!(step.output || step.error);
  const allSkills = step.skills?.length ? step.skills : (step.skill ? [step.skill] : []);
  const isActive = step.status === 'running' || step.status === 'pending';

  return (
    <div className={`transition-opacity ${step.status === 'skipped' ? 'opacity-50' : ''}`}>
      {/* Main row */}
      <div className="flex items-start gap-3">
        <TimelineNode status={step.status} index={step.index} />
        <div className="flex-1 min-w-0 pt-0.5">
          {/* Name + meta */}
          <div className="flex items-center gap-2 justify-between">
            <span className={`text-sm font-medium truncate ${
              step.status === 'done' ? 'text-foreground' :
              step.status === 'running' ? 'text-[var(--amber)]' :
              step.status === 'error' ? 'text-[var(--error)]' :
              'text-foreground/70'
            }`}>
              {step.name}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {step.durationMs != null && (step.status === 'done' || step.status === 'error') && (
                <span className="text-2xs text-muted-foreground/40 font-mono">{formatDuration(step.durationMs)}</span>
              )}
              {step.status === 'pending' && (
                <>
                  <button onClick={onRun} disabled={!canRun}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-medium transition-all disabled:opacity-30 bg-[var(--amber)] text-[var(--amber-foreground)]"
                  ><Play size={9} /> Run</button>
                  <button onClick={onSkip}
                    className="px-1.5 py-0.5 rounded-md text-2xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors">
                    Skip
                  </button>
                </>
              )}
              {step.status === 'running' && (
                <button onClick={onCancel}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs text-[var(--error)]/70 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors">
                  <XCircle size={9} /> Stop
                </button>
              )}
              {hasOutput && step.status !== 'running' && (
                <button onClick={() => setExpanded(v => !v)}
                  className="p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                  <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
          </div>

          {/* Agent/skill badges */}
          {(step.agent || allSkills.length > 0) && (
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {step.agent && <span className="text-2xs text-muted-foreground/50">{step.agent}</span>}
              {step.agent && allSkills.length > 0 && <span className="text-2xs text-muted-foreground/20">/</span>}
              {allSkills.map(s => <span key={s} className="text-2xs text-[var(--amber)]/60">{s}</span>)}
            </div>
          )}

          {/* Output area — auto-show when running */}
          {(expanded || step.status === 'running') && hasOutput && (
            <div className="mt-2 rounded-lg overflow-hidden border border-border/50">
              {step.error && (
                <div className="px-3 py-2.5 bg-[var(--error)]/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertCircle size={10} className="text-[var(--error)]" />
                    <span className="text-2xs font-medium text-[var(--error)]">Error</span>
                  </div>
                  <div className="text-xs text-[var(--error)]/80 whitespace-pre-wrap break-words leading-relaxed">{step.error}</div>
                </div>
              )}
              {step.output && (
                <div className="px-3 py-2.5 bg-muted/20">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles size={10} className="text-[var(--amber)]" />
                    <span className="text-2xs text-muted-foreground/50 uppercase tracking-wider font-medium">Output</span>
                    {step.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse" />}
                  </div>
                  <div className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">{step.output}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Runner ──────────────────────────────────────────────────────────

export default function WorkflowRunner({ workflow, filePath }: { workflow: WorkflowYaml; filePath: string }) {
  const [steps, setSteps] = useState<WorkflowStepRuntime[]>(() => initSteps(workflow));
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSteps(initSteps(workflow));
    setRunning(false);
  }, [workflow]);

  const cancelExecution = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error', error: 'Cancelled' } : s));
  }, []);

  const runStep = useCallback(async (idx: number) => {
    if (running) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    const startTime = Date.now();
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running', output: '', error: undefined, startedAt: new Date() } : s));
    try {
      const step = workflow.steps[idx];
      const runtimeStep: WorkflowStepRuntime = { ...step, index: idx, status: 'running', output: '' };
      await runStepWithAI(runtimeStep, workflow, filePath,
        (acc) => setSteps(prev => prev.map((s, i) => i === idx ? { ...s, output: acc } : s)),
        ctrl.signal);
      const duration = Date.now() - startTime;
      setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'done', completedAt: new Date(), durationMs: duration } : s));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const duration = Date.now() - startTime;
      setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: duration } : s));
    } finally { setRunning(false); }
  }, [running, workflow, filePath]);

  const skipStep = useCallback((idx: number) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'skipped' } : s));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    clearSkillCache();
    setSteps(initSteps(workflow));
  }, [workflow]);

  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  const allDone = doneCount === steps.length && steps.length > 0;
  const nextPendingIdx = steps.findIndex(s => s.status === 'pending');
  const hasErrors = steps.some(s => s.status === 'error');

  return (
    <div>
      {/* Progress bar — full width, thin, elegant */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {allDone ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
                <CheckCircle2 size={13} />
                Complete
              </span>
            ) : hasErrors ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--error)]">
                <AlertCircle size={13} />
                {doneCount}/{steps.length} done
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {doneCount}/{steps.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {nextPendingIdx >= 0 && (
              <button onClick={() => runStep(nextPendingIdx)} disabled={running}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-40 bg-[var(--amber)] text-[var(--amber-foreground)]">
                {running ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                {running ? 'Running...' : 'Run next'}
              </button>
            )}
            <button onClick={reset}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-2xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors">
              <RotateCcw size={10} />
              Reset
            </button>
          </div>
        </div>
        <div className="h-1 rounded-full bg-border/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              allDone ? 'bg-[var(--success)]' : hasErrors ? 'bg-[var(--error)]' : 'bg-[var(--amber)]'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Timeline step list */}
      <div className="relative">
        {/* Vertical line */}
        {steps.length > 1 && (
          <div className="absolute left-[12px] top-5 bottom-5 w-px bg-border/50" />
        )}

        <div className="flex flex-col gap-4">
          {steps.map((step, i) => (
            <RunStepCard key={step.id} step={step} canRun={!running}
              onRun={() => runStep(i)} onSkip={() => skipStep(i)} onCancel={cancelExecution} />
          ))}
        </div>
      </div>
    </div>
  );
}
