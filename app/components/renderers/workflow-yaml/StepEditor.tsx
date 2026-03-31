'use client';

import { useState } from 'react';
import { ChevronDown, Trash2, GripVertical } from 'lucide-react';
import { AgentSelector, SkillSelector } from './selectors';
import type { WorkflowStep } from './types';

interface StepEditorProps {
  step: WorkflowStep;
  index: number;
  onChange: (step: WorkflowStep) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export default function StepEditor({ step, index, onChange, onDelete, onMoveUp, onMoveDown }: StepEditorProps) {
  const [expanded, setExpanded] = useState(false);

  const update = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });

  // Collapsed view: summary line
  if (!expanded) {
    return (
      <div className="group flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card hover:border-[var(--amber)]/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(true)}>
        <span className="text-2xs text-muted-foreground/60 font-mono w-5 text-center shrink-0">{index + 1}</span>
        <span className="text-sm font-medium text-foreground truncate flex-1">{step.name || 'Untitled step'}</span>
        {step.skill && <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">🎓 {step.skill}</span>}
        {step.agent && <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">🤖 {step.agent}</span>}
        <ChevronDown size={12} className="text-muted-foreground/50 shrink-0" />
      </div>
    );
  }

  // Expanded edit form
  return (
    <div className="rounded-xl border border-[var(--amber)]/30 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/30">
        <span className="text-2xs text-muted-foreground/60 font-mono w-5 text-center shrink-0">{index + 1}</span>
        <span className="text-xs font-medium text-foreground flex-1 truncate">{step.name || 'Untitled step'}</span>
        <div className="flex items-center gap-1">
          {onMoveUp && (
            <button onClick={onMoveUp} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground text-2xs" title="Move up">↑</button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground text-2xs" title="Move down">↓</button>
          )}
          <button onClick={onDelete} className="p-1 rounded hover:bg-[var(--error)]/10 text-muted-foreground hover:text-[var(--error)] transition-colors" title="Delete step">
            <Trash2 size={12} />
          </button>
          <button onClick={() => setExpanded(false)} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <ChevronDown size={12} className="rotate-180" />
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className="px-3.5 py-3 space-y-3">
        {/* Step name */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Step name</label>
          <input type="text" value={step.name} onChange={e => update({ name: e.target.value })}
            placeholder="e.g. Run Tests"
            className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Prompt</label>
          <textarea value={step.prompt} onChange={e => update({ prompt: e.target.value })}
            placeholder="Describe what the AI should do in this step..."
            rows={4}
            className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y leading-relaxed"
          />
        </div>

        {/* Agent + Skill row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">Agent <span className="text-muted-foreground/50">(optional)</span></label>
            <AgentSelector value={step.agent} onChange={agent => update({ agent })} />
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">Skill <span className="text-muted-foreground/50">(optional)</span></label>
            <SkillSelector value={step.skill} onChange={skill => update({ skill })} />
          </div>
        </div>

        {/* Description (optional, collapsible) */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Description <span className="text-muted-foreground/50">(optional)</span></label>
          <input type="text" value={step.description || ''} onChange={e => update({ description: e.target.value || undefined })}
            placeholder="Brief description of this step"
            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Timeout */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Timeout <span className="text-muted-foreground/50">(seconds, optional)</span></label>
          <input type="number" min={0} value={step.timeout || ''} onChange={e => update({ timeout: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="120"
            className="w-24 px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}
