'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, SkipForward, RotateCcw, CheckCircle2, Circle, Loader2, AlertCircle, ChevronDown, Sparkles, XCircle } from 'lucide-react';
import { runStepWithAI, clearSkillCache } from './execution';
import type { WorkflowYaml, WorkflowStepRuntime, StepStatus } from './types';

function initSteps(workflow: WorkflowYaml): WorkflowStepRuntime[] {
  return workflow.steps.map((s, idx) => ({
    ...s, index: idx, status: 'pending' as const, output: '', error: undefined,
  }));
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'pending') return <Circle size={15} className="text-border" />;
  if (status === 'running') return <Loader2 size={15} className="text-[var(--amber)] animate-spin" />;
  if (status === 'done') return <CheckCircle2 size={15} className="text-[var(--success)]" />;
  if (status === 'skipped') return <SkipForward size={15} className="text-muted-foreground opacity-50" />;
  return <AlertCircle size={15} className="text-[var(--error)]" />;
}

function Badge({ emoji, label }: { emoji: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">
      {emoji} {label}
    </span>
  );
}

function RunStepCard({ step, canRun, onRun, onSkip, onCancel }: {
  step: WorkflowStepRuntime; canRun: boolean;
  onRun: () => void; onSkip: () => void; onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(step.description || step.output || step.error);
  const borderColor = {
    pending: 'border-border', running: 'border-[var(--amber)]/50',
    done: 'border-[var(--success)]/40', skipped: 'border-border', error: 'border-[var(--error)]/40',
  }[step.status];

  return (
    <div className={`rounded-xl border overflow-hidden bg-card transition-all ${borderColor} ${step.status === 'skipped' ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 justify-between flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <StatusIcon status={step.status} />
          <div className="min-w-0">
            <div className="font-semibold text-sm text-foreground cursor-pointer" onClick={() => hasContent && setExpanded(v => !v)}>
              {step.name}
            </div>
            {(step.agent || step.skill) && (
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {step.skill && <Badge emoji="🎓" label={step.skill} />}
                {step.agent && <Badge emoji="🤖" label={step.agent} />}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {step.status === 'pending' && (
            <>
              <button onClick={onRun} disabled={!canRun}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-2xs font-medium border-none transition-colors disabled:opacity-50 bg-[var(--amber)] text-[var(--amber-foreground)] disabled:bg-muted disabled:text-muted-foreground"
              ><Play size={10} /> Run</button>
              <button onClick={onSkip} className="px-2 py-1 rounded-md text-2xs border border-border bg-transparent text-muted-foreground hover:bg-muted">Skip</button>
            </>
          )}
          {step.status === 'running' && (
            <button onClick={onCancel} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-2xs border border-[var(--error)] bg-transparent text-[var(--error)]">
              <XCircle size={10} /> Cancel
            </button>
          )}
          {(step.status === 'done' || step.status === 'error') && (
            <button onClick={() => setExpanded(v => !v)} className="px-2 py-1 rounded-md text-2xs border border-border bg-transparent text-muted-foreground">
              <ChevronDown size={11} className={`inline transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>
      {(expanded || step.status === 'running') && hasContent && (
        <div className="border-t border-border">
          {step.description && (
            <div className={`px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground ${(step.output || step.error) ? 'border-b border-border' : ''}`}>
              {step.description}
            </div>
          )}
          {step.error && (
            <div className="px-3.5 py-2.5 bg-[var(--error)]/10">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertCircle size={11} className="text-[var(--error)]" />
                <span className="text-2xs text-[var(--error)] uppercase">Error</span>
              </div>
              <div className="text-xs text-[var(--error)] whitespace-pre-wrap break-words">{step.error}</div>
            </div>
          )}
          {step.output && (
            <div className="px-3.5 py-2.5 bg-background">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={11} className="text-[var(--amber)]" />
                <span className="text-2xs text-muted-foreground uppercase tracking-wide">AI Output</span>
                {step.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse ml-1" />}
              </div>
              <div className="text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">{step.output}</div>
            </div>
          )}
        </div>
      )}
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
    setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error', error: 'Cancelled by user' } : s));
  }, []);

  const runStep = useCallback(async (idx: number) => {
    if (running) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running', output: '', error: undefined } : s));
    try {
      const step = workflow.steps[idx];
      const runtimeStep: WorkflowStepRuntime = { ...step, index: idx, status: 'running', output: '' };
      await runStepWithAI(runtimeStep, workflow, filePath,
        (acc) => setSteps(prev => prev.map((s, i) => i === idx ? { ...s, output: acc } : s)),
        ctrl.signal);
      setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'done' } : s));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'error', error: err instanceof Error ? err.message : String(err) } : s));
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
  const nextPendingIdx = steps.findIndex(s => s.status === 'pending');

  return (
    <div>
      {workflow.description && (
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{workflow.description}</p>
      )}
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        <div className="flex-1 min-w-[120px] h-1 rounded-full bg-border overflow-hidden">
          <div className="h-full bg-[var(--amber)] rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-2xs text-muted-foreground shrink-0">{doneCount}/{steps.length}</span>
        {nextPendingIdx >= 0 && (
          <button onClick={() => runStep(nextPendingIdx)} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border-none transition-colors disabled:opacity-60 bg-[var(--amber)] text-[var(--amber-foreground)] disabled:bg-muted disabled:text-muted-foreground"
          >{running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run next</button>
        )}
        <button onClick={reset} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-border bg-transparent text-muted-foreground hover:bg-muted">
          <RotateCcw size={11} /> Reset
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <RunStepCard key={step.id} step={step} canRun={!running}
            onRun={() => runStep(i)} onSkip={() => skipStep(i)} onCancel={cancelExecution} />
        ))}
      </div>
    </div>
  );
}
