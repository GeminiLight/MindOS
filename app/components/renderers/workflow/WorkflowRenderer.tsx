'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { Play, SkipForward, RotateCcw, CheckCircle2, Circle, Loader2, AlertCircle, ChevronDown, Sparkles } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

interface WorkflowStep {
  index: number;
  heading: string;    // full heading text e.g. "Step 1: Gather requirements"
  body: string;       // body text below heading
  status: StepStatus;
  output: string;     // AI output for this step
}

interface WorkflowMeta {
  title: string;
  description: string;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseWorkflow(content: string): { meta: WorkflowMeta; steps: WorkflowStep[] } {
  const lines = content.split('\n');
  let title = '';
  let description = '';
  const steps: WorkflowStep[] = [];
  let currentStep: { heading: string; bodyLines: string[] } | null = null;
  let inMeta = true;
  const metaLines: string[] = [];

  const flushStep = () => {
    if (!currentStep) return;
    steps.push({
      index: steps.length,
      heading: currentStep.heading,
      body: currentStep.bodyLines.join('\n').trim(),
      status: 'pending',
      output: '',
    });
    currentStep = null;
  };

  for (const line of lines) {
    if (/^# /.test(line)) {
      title = line.slice(2).trim();
      inMeta = true;
      continue;
    }
    // H2 = step
    if (/^## /.test(line)) {
      flushStep();
      inMeta = false;
      currentStep = { heading: line.slice(3).trim(), bodyLines: [] };
      continue;
    }
    if (currentStep) {
      currentStep.bodyLines.push(line);
    } else if (inMeta) {
      metaLines.push(line);
    }
  }
  flushStep();

  description = metaLines.filter(l => l.trim() && !/^#/.test(l)).join(' ').trim().slice(0, 200);

  return { meta: { title, description }, steps };
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, `<code class="font-display" style="font-size:.82em;padding:1px 5px;border-radius:4px;background:var(--muted)">$1</code>`)
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function renderBody(body: string): string {
  return body.split('\n').map(line => {
    if (!line.trim()) return '';
    if (/^- /.test(line)) return `<li style="margin:.2em 0;font-size:.82rem;color:var(--muted-foreground)">${renderInline(line.slice(2))}</li>`;
    return `<p style="margin:.3em 0;font-size:.82rem;line-height:1.6;color:var(--muted-foreground)">${renderInline(line)}</p>`;
  }).join('');
}

// ─── Status icon ─────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'pending')  return <Circle size={15} style={{ color: 'var(--border)' }} />;
  if (status === 'running')  return <Loader2 size={15} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />;
  if (status === 'done')     return <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />;
  if (status === 'skipped')  return <SkipForward size={15} style={{ color: 'var(--muted-foreground)', opacity: .5 }} />;
  return <AlertCircle size={15} style={{ color: 'var(--error)' }} />;
}

const STATUS_BORDER: Record<StepStatus, string> = {
  pending: 'var(--border)',
  running: 'rgba(200,135,58,0.5)',
  done:    'rgba(122,173,128,0.4)',
  skipped: 'var(--border)',
  error:   'rgba(200,80,80,0.4)',
};

// ─── AI execution ─────────────────────────────────────────────────────────────

async function runStepWithAI(
  step: WorkflowStep,
  filePath: string,
  allStepsSummary: string,
  onChunk: (chunk: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const prompt = `You are executing step ${step.index + 1} of a SOP/Workflow: "${step.heading}".

Context of the full workflow:
${allStepsSummary}

Current step instructions:
${step.body || '(No specific instructions — use common sense for this step.)'}

Execute this step concisely. Provide:
1. What you did / what the output is
2. Any decisions made
3. What the next step should watch out for

Be specific and actionable. Format in Markdown.`;

  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      currentFile: filePath,
    }),
    signal,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    for (const line of raw.split('\n')) {
      const m = line.match(/^0:"((?:[^"\\]|\\.)*)"$/);
      if (m) {
        acc += m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        onChunk(acc);
      }
    }
  }
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({
  step, isActive, onRun, onSkip, canRun,
}: {
  step: WorkflowStep;
  isActive: boolean;
  onRun: () => void;
  onSkip: () => void;
  canRun: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = step.body.trim().length > 0;
  const hasOutput = step.output.length > 0;

  return (
    <div style={{
      border: `1px solid ${STATUS_BORDER[step.status]}`,
      borderRadius: 10,
      overflow: 'hidden',
      background: 'var(--card)',
      opacity: step.status === 'skipped' ? 0.6 : 1,
      transition: 'border-color .2s, opacity .2s',
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>
        <StatusIcon status={step.status} />
        <span
          style={{ flex: 1, fontWeight: 600, fontSize: '.88rem', color: 'var(--foreground)', cursor: hasBody || hasOutput ? 'pointer' : 'default' }}
          onClick={() => (hasBody || hasOutput) && setExpanded(v => !v)}
        >
          {step.heading}
        </span>

        {/* action buttons */}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {step.status === 'pending' && (
            <>
              <button
                onClick={onRun}
                disabled={!canRun}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 6, fontSize: '0.72rem',
                  cursor: canRun ? 'pointer' : 'not-allowed',
                  border: 'none', background: canRun ? 'var(--amber)' : 'var(--muted)',
                  color: canRun ? '#131210' : 'var(--muted-foreground)',
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
            <span className="font-display" style={{ fontSize: '0.7rem', color: 'var(--amber)' }}>executing…</span>
          )}
          {(step.status === 'done' || step.status === 'error') && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }}
            >
              <ChevronDown size={11} style={{ display: 'inline', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
          )}
        </div>
      </div>

      {/* body / output */}
      {(expanded || step.status === 'running') && (hasBody || hasOutput) && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {hasBody && (
            <div style={{ padding: '10px 14px', borderBottom: hasOutput ? '1px solid var(--border)' : 'none' }}>
              <div dangerouslySetInnerHTML={{ __html: renderBody(step.body) }} />
            </div>
          )}
          {hasOutput && (
            <div style={{ padding: '10px 14px', background: 'var(--background)', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <Sparkles size={11} style={{ color: 'var(--amber)' }} />
                <span className="font-display" style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.06em' }}>AI Output</span>
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

// ─── Main renderer ────────────────────────────────────────────────────────────

export function WorkflowRenderer({ filePath, content }: RendererContext) {
  const parsed = useMemo(() => parseWorkflow(content), [content]);
  const [steps, setSteps] = useState<WorkflowStep[]>(() => parsed.steps);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset when content changes externally
  useMemo(() => { setSteps(parsed.steps.map(s => ({ ...s, status: 'pending' as StepStatus, output: '' }))); }, [parsed]);

  const allStepsSummary = useMemo(() =>
    parsed.steps.map((s, i) => `${i + 1}. ${s.heading}`).join('\n'),
    [parsed]);

  const runStep = useCallback(async (idx: number) => {
    if (running) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);

    setSteps(prev => prev.map((s, i) =>
      i === idx ? { ...s, status: 'running', output: '' } : s));

    try {
      await runStepWithAI(
        steps[idx], filePath, allStepsSummary,
        (chunk) => setSteps(prev => prev.map((s, i) =>
          i === idx ? { ...s, output: chunk } : s)),
        ctrl.signal,
      );
      setSteps(prev => prev.map((s, i) =>
        i === idx ? { ...s, status: 'done' } : s));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setSteps(prev => prev.map((s, i) =>
        i === idx ? { ...s, status: 'error', output: (err instanceof Error ? err.message : String(err)) } : s));
    } finally {
      setRunning(false);
    }
  }, [running, steps, filePath, allStepsSummary]);

  const skipStep = useCallback((idx: number) => {
    setSteps(prev => prev.map((s, i) =>
      i === idx ? { ...s, status: 'skipped' } : s));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setSteps(parsed.steps.map(s => ({ ...s, status: 'pending' as StepStatus, output: '' })));
  }, [parsed]);

  // Next runnable step = first pending step
  const nextPendingIdx = steps.findIndex(s => s.status === 'pending');
  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;

  if (steps.length === 0) {
    return (
      <div className="font-display" style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>
        No steps found. Add <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>## Step N: …</code> headings to define workflow steps.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* header */}
      <div style={{ marginBottom: '1.2rem' }}>
        {parsed.meta.description && (
          <p style={{ fontSize: '.82rem', color: 'var(--muted-foreground)', lineHeight: 1.6, marginBottom: 12 }}>
            {parsed.meta.description}
          </p>
        )}

        {/* progress + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* progress bar */}
          <div style={{ flex: 1, minWidth: 120, height: 4, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--amber)', borderRadius: 999, transition: 'width .3s' }} />
          </div>
          <span className="font-display" style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', flexShrink: 0 }}>
            {doneCount}/{steps.length} done
          </span>

          {/* run next */}
          {nextPendingIdx >= 0 && (
            <button
              onClick={() => runStep(nextPendingIdx)}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 12px', borderRadius: 7, fontSize: '0.75rem',
                cursor: running ? 'not-allowed' : 'pointer',
                border: 'none', background: running ? 'var(--muted)' : 'var(--amber)',
                color: running ? 'var(--muted-foreground)' : '#131210',
                opacity: running ? 0.7 : 1,
              }}
            >
              {running ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />}
              Run next
            </button>
          )}

          {/* reset */}
          <button
            onClick={reset}
            style={{ padding: '4px 10px', borderRadius: 7, fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </div>

      {/* step list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => (
          <StepCard
            key={i}
            step={step}
            isActive={i === nextPendingIdx}
            canRun={!running}
            onRun={() => runStep(i)}
            onSkip={() => skipStep(i)}
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
