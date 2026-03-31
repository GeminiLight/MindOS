'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Save, Loader2, FolderOpen, Zap, CheckCircle2 } from 'lucide-react';
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

  // Clear success indicator after 3s
  useEffect(() => {
    if (!saveSuccess) return;
    const t = setTimeout(() => setSaveSuccess(false), 3000);
    return () => clearTimeout(t);
  }, [saveSuccess]);

  const updateMeta = (patch: Partial<WorkflowYaml>) => {
    onChange({ ...workflow, ...patch });
  };

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
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', path: filePath, content: yaml }),
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

  // Keyboard shortcut: Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!saving && workflow.title.trim() && workflow.steps.length > 0) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const canSave = !saving && !!workflow.title.trim() && workflow.steps.length > 0;

  return (
    <div>
      {/* Metadata */}
      <div className="space-y-3 mb-6">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Title</label>
          <input type="text" value={workflow.title} onChange={e => updateMeta({ title: e.target.value })}
            placeholder="Workflow title"
            className="w-full px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="grid grid-cols-[1fr,auto] gap-3">
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">Description <span className="text-muted-foreground/50">(optional)</span></label>
            <input type="text" value={workflow.description || ''} onChange={e => updateMeta({ description: e.target.value || undefined })}
              placeholder="What does this workflow do?"
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">
              <FolderOpen size={10} className="inline mr-0.5 -mt-0.5" />
              Working dir
            </label>
            <DirPicker value={workflow.workDir || ''} onChange={v => updateMeta({ workDir: v || undefined })} />
          </div>
        </div>
      </div>

      {/* Steps section */}
      {workflow.steps.length > 0 ? (
        <>
          {/* Steps header */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Steps ({workflow.steps.length})
            </h3>
          </div>

          {/* Step list */}
          <div className="flex flex-col gap-2 mb-4">
            {workflow.steps.map((step, i) => (
              <StepEditor
                key={step.id}
                step={step}
                index={i}
                onChange={s => updateStep(i, s)}
                onDelete={() => deleteStep(i)}
                onMoveUp={i > 0 ? () => moveStep(i, i - 1) : undefined}
                onMoveDown={i < workflow.steps.length - 1 ? () => moveStep(i, i + 1) : undefined}
              />
            ))}
          </div>

          {/* Add step */}
          <button onClick={addStep}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-[var(--amber)]/30 hover:bg-muted/30 transition-colors">
            <Plus size={13} />
            Add step
          </button>
        </>
      ) : (
        /* Empty state: prominent CTA */
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-xl border border-dashed border-border bg-muted/10">
          <Zap size={28} className="text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-1">No steps yet</p>
          <p className="text-xs text-muted-foreground/60 mb-4 max-w-[260px]">
            Add your first step to define what the AI should do.
          </p>
          <button onClick={addStep}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[var(--amber)] text-[var(--amber-foreground)] transition-colors hover:opacity-90">
            <Plus size={13} />
            Add first step
          </button>
        </div>
      )}

      {/* Save bar */}
      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
        <button onClick={handleSave} disabled={!canSave}
          title={!workflow.title.trim() ? 'Title is required' : workflow.steps.length === 0 ? 'Add at least one step' : undefined}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--amber)] text-[var(--amber-foreground)]">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving...' : 'Save'}
        </button>

        {saveError && <span className="text-xs text-[var(--error)]">{saveError}</span>}

        {saveSuccess && !saveError && (
          <span className="flex items-center gap-1 text-2xs text-[var(--success)] animate-in fade-in">
            <CheckCircle2 size={11} />
            Saved
          </span>
        )}

        <span className="text-2xs text-muted-foreground/40 ml-auto">Ctrl+S</span>
      </div>
    </div>
  );
}
