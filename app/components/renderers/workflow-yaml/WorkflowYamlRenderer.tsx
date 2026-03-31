'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Play, SkipForward, RotateCcw, CheckCircle2, Circle, Loader2, AlertCircle, ChevronDown, Sparkles, XCircle } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';
import { parseWorkflowYaml } from './parser';
import { runStepWithAI, clearSkillCache } from './execution';
import type { WorkflowYaml, WorkflowStepRuntime, StepStatus } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function initSteps(workflow: WorkflowYaml): WorkflowStepRuntime[] {
  return workflow.steps.map((s, idx) => ({
    ...s,
    index: idx,
    status: 'pending' as const,
    output: '',
    error: undefined,
  }));
}

// ─── Status Icon ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'pending') return <Circle size={15} style={{ color: 'var(--border)' }} />;
  if (status === 'running') return <Loader2 size={15} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />;
  if (status === 'done') return <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />;
  if (status === 'skipped') return <SkipForward size={15} style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} />;
  return <AlertCircle size={15} style={{ color: 'var(--error)' }} />;
}

const STATUS_BORDER: Record<StepStatus, string> = {
  pending: 'var(--border)',
  running: 'rgba(200,135,58,0.5)',
  done: 'rgba(122,173,128,0.4)',
  skipped: 'var(--border)',
  error: 'rgba(200,80,80,0.4)',
};

// ─── Badge ────────────────────────────────────────────────────────────────

function Badge({ emoji, label }: { emoji: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: '0.7rem',
      padding: '2px 8px',
      borderRadius: 4,
      background: 'var(--muted)',
      color: 'var(--muted-foreground)',
      whiteSpace: 'nowrap',
    }}>
      {emoji} {label}
    </span>
  );
}

// ─── Step Card ────────────────────────────────────────────────────────────

function StepCard({
  step,
  canRun,
  onRun,
  onSkip,
  onCancel,
}: {
  step: WorkflowStepRuntime;
  canRun: boolean;
  onRun: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(step.description || step.output || step.error);

  return (
    <div style={{
      border: `1px solid ${STATUS_BORDER[step.status]}`,
      borderRadius: 10,
      overflow: 'hidden',
      background: 'var(--card)',
      opacity: step.status === 'skipped' ? 0.6 : 1,
      transition: 'border-color .2s, opacity .2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <StatusIcon status={step.status} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: '.88rem',
                color: 'var(--foreground)',
                cursor: hasContent ? 'pointer' : 'default',
              }}
              onClick={() => hasContent && setExpanded(v => !v)}
            >
              {step.name}
            </div>
            {(step.agent || step.skill) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {step.skill && <Badge emoji="🎓" label={step.skill} />}
                {step.agent && <Badge emoji="🤖" label={step.agent} />}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {step.status === 'pending' && (
            <>
              <button
                onClick={onRun}
                disabled={!canRun}
                title={!canRun ? 'Another step is running' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 6, fontSize: '0.72rem',
                  cursor: canRun ? 'pointer' : 'not-allowed',
                  border: 'none',
                  background: canRun ? 'var(--amber)' : 'var(--muted)',
                  color: canRun ? 'var(--amber-foreground)' : 'var(--muted-foreground)',
                  opacity: canRun ? 1 : 0.5,
                }}
              >
                <Play size={10} /> Run
              </button>
              <button
                onClick={onSkip}
                style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem',
                  cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--muted-foreground)',
                }}
              >
                Skip
              </button>
            </>
          )}
          {step.status === 'running' && (
            <button
              onClick={onCancel}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 6, fontSize: '0.72rem',
                cursor: 'pointer',
                border: '1px solid var(--error)', background: 'transparent',
                color: 'var(--error)',
              }}
            >
              <XCircle size={10} /> Cancel
            </button>
          )}
          {(step.status === 'done' || step.status === 'error') && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem',
                cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--muted-foreground)',
              }}
            >
              <ChevronDown size={11} style={{ display: 'inline', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
          )}
        </div>
      </div>

      {/* Body / Output */}
      {(expanded || step.status === 'running') && hasContent && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {step.description && (
            <div style={{ padding: '10px 14px', borderBottom: (step.output || step.error) ? '1px solid var(--border)' : 'none' }}>
              <p style={{ fontSize: '0.82rem', lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>
                {step.description}
              </p>
            </div>
          )}
          {step.error && (
            <div style={{ padding: '10px 14px', background: 'rgba(200,80,80,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <AlertCircle size={11} style={{ color: 'var(--error)' }} />
                <span style={{ fontSize: '0.68rem', color: 'var(--error)', textTransform: 'uppercase' }}>Error</span>
              </div>
              <div style={{ fontSize: '.82rem', color: 'var(--error)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {step.error}
              </div>
            </div>
          )}
          {step.output && (
            <div style={{ padding: '10px 14px', background: 'var(--background)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <Sparkles size={11} style={{ color: 'var(--amber)' }} />
                <span style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.06em' }}>AI Output</span>
                {step.status === 'running' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse 1.2s ease-in-out infinite', marginLeft: 4 }} />}
              </div>
              <div style={{ fontSize: '.82rem', lineHeight: 1.7, color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {step.output}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Renderer ────────────────────────────────────────────────────────

export function WorkflowYamlRenderer({ filePath, content }: RendererContext) {
  const parsed = useMemo(() => parseWorkflowYaml(content), [content]);
  const [steps, setSteps] = useState<WorkflowStepRuntime[]>(() =>
    parsed.workflow ? initSteps(parsed.workflow) : []
  );
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset when content changes externally
  useEffect(() => {
    if (parsed.workflow) {
      setSteps(initSteps(parsed.workflow));
      setRunning(false);
    }
  }, [parsed.workflow]);

  const cancelExecution = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setSteps(prev => prev.map(s =>
      s.status === 'running' ? { ...s, status: 'error', error: 'Cancelled by user' } : s
    ));
  }, []);

  const runStep = useCallback(async (idx: number) => {
    if (running || !parsed.workflow) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);

    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running', output: '', error: undefined } : s));

    try {
      const step = parsed.workflow.steps[idx];
      const runtimeStep: WorkflowStepRuntime = { ...step, index: idx, status: 'running', output: '' };

      await runStepWithAI(
        runtimeStep,
        parsed.workflow,
        filePath,
        (accumulated) => setSteps(prev => prev.map((s, i) => i === idx ? { ...s, output: accumulated } : s)),
        ctrl.signal,
      );
      setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'done' } : s));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setSteps(prev => prev.map((s, i) =>
        i === idx ? { ...s, status: 'error', error: err instanceof Error ? err.message : String(err) } : s
      ));
    } finally {
      setRunning(false);
    }
  }, [running, parsed.workflow, filePath]);

  const skipStep = useCallback((idx: number) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'skipped' } : s));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    clearSkillCache();
    if (parsed.workflow) setSteps(initSteps(parsed.workflow));
  }, [parsed.workflow]);

  // Parse errors
  if (parsed.errors.length > 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
        <div style={{ background: 'rgba(200,80,80,0.1)', border: '1px solid var(--error)', borderRadius: 8, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertCircle size={18} style={{ color: 'var(--error)' }} />
            <span style={{ fontWeight: 600, color: 'var(--error)' }}>Invalid workflow file</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--foreground)' }}>
            {parsed.errors.map((err, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{err}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (!parsed.workflow || steps.length === 0) {
    return (
      <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.82rem' }}>
        <p style={{ marginBottom: 8 }}>No workflow steps defined.</p>
        <p style={{ fontSize: '0.75rem' }}>
          Add <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>steps:</code> with at least one step containing <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>id</code>, <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>name</code>, and <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>prompt</code>.
        </p>
      </div>
    );
  }

  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  const nextPendingIdx = steps.findIndex(s => s.status === 'pending');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.2rem' }}>
        {parsed.workflow.description && (
          <p style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.6, margin: '0 0 12px 0' }}>
            {parsed.workflow.description}
          </p>
        )}

        {/* Progress + Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120, height: 4, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--amber)', borderRadius: 999, transition: 'width .3s' }} />
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', flexShrink: 0 }}>
            {doneCount}/{steps.length} done
          </span>

          {nextPendingIdx >= 0 && (
            <button
              onClick={() => runStep(nextPendingIdx)}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 12px', borderRadius: 7, fontSize: '0.75rem',
                cursor: running ? 'not-allowed' : 'pointer',
                border: 'none',
                background: running ? 'var(--muted)' : 'var(--amber)',
                color: running ? 'var(--muted-foreground)' : 'var(--amber-foreground)',
                opacity: running ? 0.7 : 1,
              }}
            >
              {running ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />}
              Run next
            </button>
          )}

          <button
            onClick={reset}
            style={{
              padding: '4px 10px', borderRadius: 7, fontSize: '0.75rem',
              cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--muted-foreground)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            canRun={!running}
            onRun={() => runStep(i)}
            onSkip={() => skipStep(i)}
            onCancel={cancelExecution}
          />
        ))}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
      `}</style>
    </div>
  );
}
