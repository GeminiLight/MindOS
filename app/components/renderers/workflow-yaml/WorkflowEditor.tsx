'use client';

import { useState, useCallback } from 'react';
import { Plus, Save, Loader2, FolderOpen } from 'lucide-react';
import StepEditor from './StepEditor';
import { serializeWorkflowYaml, generateStepId } from './serializer';
import type { WorkflowYaml, WorkflowStep } from './types';
import { ContextSelector } from './selectors';

interface WorkflowEditorProps {
  workflow: WorkflowYaml;
  filePath: string;
  onChange: (workflow: WorkflowYaml) => void;
}

export default function WorkflowEditor({ workflow, filePath, onChange }: WorkflowEditorProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const updateMeta = (patch: Partial<WorkflowYaml>) => {
    onChange({ ...workflow, ...patch });
  };

  const updateStep = useCallback((index: number, step: WorkflowStep) => {
    const steps = [...workflow.steps];
    steps[index] = step;
    onChange({ ...workflow, steps });
  }, [workflow, onChange]);

  const deleteStep = useCallback((index: number) => {
    onChange({ ...workflow, steps: workflow.steps.filter((_, i) => i !== index) });
  }, [workflow, onChange]);

  const addStep = useCallback(() => {
    const existingIds = workflow.steps.map(s => s.id);
    const id = generateStepId('new-step', existingIds);
    const step: WorkflowStep = { id, name: '', prompt: '' };
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
      setLastSaved(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

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
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Description <span className="text-muted-foreground/50">(optional)</span></label>
          <input type="text" value={workflow.description || ''} onChange={e => updateMeta({ description: e.target.value || undefined })}
            placeholder="What does this workflow do?"
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">
            <FolderOpen size={11} className="inline mr-1 -mt-0.5" />
            Working directory <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <input type="text" value={workflow.workDir || ''} onChange={e => updateMeta({ workDir: e.target.value || undefined })}
            placeholder="e.g. ~/projects/my-app"
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-2xs text-muted-foreground/50 mt-1">All steps run relative to this directory</p>
        </div>
      </div>

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

      {/* Save bar */}
      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
        <button onClick={handleSave} disabled={saving || !workflow.title.trim() || workflow.steps.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-[var(--amber)] text-[var(--amber-foreground)]">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saveError && <span className="text-xs text-[var(--error)]">{saveError}</span>}
        {lastSaved && !saveError && (
          <span className="text-2xs text-muted-foreground/60">Saved</span>
        )}
        {!workflow.title.trim() && (
          <span className="text-2xs text-muted-foreground/60">Title is required</span>
        )}
      </div>
    </div>
  );
}
