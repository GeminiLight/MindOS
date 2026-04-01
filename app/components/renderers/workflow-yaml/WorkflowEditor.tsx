'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Save, Loader2, FolderOpen, Zap, CheckCircle2, GripVertical } from 'lucide-react';
import StepEditor from './StepEditor';
import { serializeWorkflowYaml, generateStepId } from './serializer';
import type { WorkflowYaml, WorkflowStep } from './types';
import { DirPicker } from './selectors';

interface WorkflowEditorProps {
  workflow: WorkflowYaml;
  filePath: string;
  onChange: (workflow: WorkflowYaml) => void;
  onSaved?: () => void;
}

export default function WorkflowEditor({ workflow, filePath, onChange, onSaved }: WorkflowEditorProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!saveSuccess) return;
    const t = setTimeout(() => setSaveSuccess(false), 3000);
    return () => clearTimeout(t);
  }, [saveSuccess]);

  const updateMeta = (patch: Partial<WorkflowYaml>) => onChange({ ...workflow, ...patch });

  const updateStep = useCallback((index: number, step: WorkflowStep) => {
    const steps = [...workflow.steps];
    steps[index] = step;
    onChange({ ...workflow, steps });
  }, [workflow, onChange]);

  const deleteStep = useCallback((index: number) => {
    const step = workflow.steps[index];
    const hasContent = step.name || step.prompt;
    if (hasContent && !window.confirm(`Delete step "${step.name || 'Untitled'}"?`)) return;
    onChange({ ...workflow, steps: workflow.steps.filter((_, i) => i !== index) });
  }, [workflow, onChange]);

  const addStep = useCallback(() => {
    const existingIds = workflow.steps.map(s => s.id);
    const num = workflow.steps.length + 1;
    const id = generateStepId(`step-${num}`, existingIds);
    const step: WorkflowStep = { id, name: `Step ${num}`, prompt: '' };
    onChange({ ...workflow, steps: [...workflow.steps, step] });
  }, [workflow, onChange]);

  const moveStep = useCallback((from: number, to: number) => {
    if (to < 0 || to >= workflow.steps.length) return;
    const steps = [...workflow.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    onChange({ ...workflow, steps });
  }, [workflow, onChange]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const yaml = serializeWorkflowYaml(workflow);
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, op: 'save_file', content: yaml }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (HTTP ${res.status})`);
      }
      setSaveSuccess(true);
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!saving && workflow.title.trim() && workflow.steps.length > 0) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const canSave = !saving && !!workflow.title.trim() && workflow.steps.length > 0;

  return (
    <div>
      {/* ── Metadata Section ── */}
      <div className="space-y-3 mb-8">
        {/* Title — large, inline feel */}
        <input type="text" value={workflow.title} onChange={e => updateMeta({ title: e.target.value })}
          placeholder="Flow title..."
          className="w-full text-lg font-semibold bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none border-none p-0 leading-tight"
        />
        {/* Description — subtle underline */}
        <input type="text" value={workflow.description || ''} onChange={e => updateMeta({ description: e.target.value || undefined })}
          placeholder="Add a description..."
          className="w-full text-sm bg-transparent text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none border-none p-0"
        />

        {/* Working directory — always visible */}
        <div className="flex items-center gap-2">
          <FolderOpen size={12} className="text-muted-foreground/40 shrink-0" />
          <DirPicker value={workflow.workDir || ''} onChange={v => updateMeta({ workDir: v || undefined })} />
        </div>
      </div>

      {/* ── Steps Section — Timeline style ── */}
      {workflow.steps.length > 0 ? (
        <div className="relative">
          {/* Vertical timeline line */}
          {workflow.steps.length > 1 && (
            <div className="absolute left-[19px] top-6 bottom-16 w-px bg-border" />
          )}

          {/* Step list */}
          <div className="flex flex-col gap-3 mb-5 relative">
            {workflow.steps.map((step, i) => (
              <div key={step.id} className="relative pl-11">
                {/* Timeline node */}
                <div className="absolute left-[7px] top-3 w-[22px] h-[22px] rounded-full border-2 border-border bg-background z-10 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-muted-foreground/60">{i + 1}</span>
                </div>
                <StepEditor
                  step={step}
                  index={i}
                  onChange={s => updateStep(i, s)}
                  onDelete={() => deleteStep(i)}
                  onMoveUp={i > 0 ? () => moveStep(i, i - 1) : undefined}
                  onMoveDown={i < workflow.steps.length - 1 ? () => moveStep(i, i + 1) : undefined}
                />
              </div>
            ))}
          </div>

          {/* Add step — at the end of timeline */}
          <div className="relative pl-11">
            <div className="absolute left-[7px] top-2.5 w-[22px] h-[22px] rounded-full border-2 border-dashed border-border bg-background z-10 flex items-center justify-center">
              <Plus size={9} className="text-muted-foreground/40" />
            </div>
            <button onClick={addStep}
              className="w-full text-left px-3 py-2 rounded-lg text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40 transition-colors">
              Add step...
            </button>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[var(--amber)]/8 flex items-center justify-center mb-4">
            <Zap size={22} className="text-[var(--amber)]/60" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">Build your flow</p>
          <p className="text-xs text-muted-foreground/60 mb-5 max-w-[240px]">
            Each step is a task for an AI agent. Chain them together to automate complex workflows.
          </p>
          <button onClick={addStep}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity">
            <Plus size={12} />
            Add first step
          </button>
        </div>
      )}

      {/* ── Save bar — sticky bottom feel ── */}
      <div className="flex items-center gap-3 mt-8 pt-4 border-t border-border/50">
        <button onClick={handleSave} disabled={!canSave}
          title={!workflow.title.trim() ? 'Title is required' : workflow.steps.length === 0 ? 'Add at least one step' : undefined}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            canSave
              ? 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90'
              : 'bg-muted text-muted-foreground'
          }`}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saving ? 'Saving...' : 'Save'}
        </button>

        {saveError && <span className="text-xs text-[var(--error)]">{saveError}</span>}

        {saveSuccess && !saveError && (
          <span className="flex items-center gap-1 text-2xs text-[var(--success)]">
            <CheckCircle2 size={11} />
            Saved
          </span>
        )}

        <kbd className="text-2xs text-muted-foreground/30 ml-auto font-mono">Ctrl+S</kbd>
      </div>
    </div>
  );
}
