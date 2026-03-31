'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { AgentSelector, ModelSelector, SkillsSelector, ContextSelector } from './selectors';
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
  // Auto-expand if step has no prompt (newly created)
  const [expanded, setExpanded] = useState(!step.prompt);

  const update = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });

  // Merge legacy single skill into skills array for display
  const allSkills = step.skills?.length ? step.skills : (step.skill ? [step.skill] : []);

  // Collapsed view: summary line
  if (!expanded) {
    return (
      <div className="group flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card hover:border-[var(--amber)]/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(true)}>
        <span className="text-2xs text-muted-foreground/60 font-mono w-5 text-center shrink-0">{index + 1}</span>
        <span className={`text-sm font-medium truncate flex-1 ${step.name ? 'text-foreground' : 'text-muted-foreground italic'}`}>
          {step.name || 'Untitled step'}
        </span>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {allSkills.slice(0, 2).map(s => (
            <span key={s} className="text-2xs px-1.5 py-0.5 rounded bg-[var(--amber)]/10 text-[var(--amber)] border border-[var(--amber)]/20">{s}</span>
          ))}
          {allSkills.length > 2 && (
            <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground">+{allSkills.length - 2}</span>
          )}
          {step.agent && <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">🤖 {step.agent}</span>}
          {step.agent && step.model && <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">🧠 {step.model}</span>}
          {step.context?.length ? <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">📎 {step.context.length}</span> : null}
        </div>
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
        <span className={`text-xs font-medium flex-1 truncate ${step.name ? 'text-foreground' : 'text-muted-foreground italic'}`}>
          {step.name || 'Untitled step'}
        </span>
        <div className="flex items-center gap-0.5">
          {onMoveUp && (
            <button onClick={onMoveUp} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Move up">
              <ChevronUp size={13} />
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Move down">
              <ChevronDown size={13} />
            </button>
          )}
          <button onClick={onDelete} className="p-1 rounded hover:bg-[var(--error)]/10 text-muted-foreground hover:text-[var(--error)] transition-colors" title="Delete step">
            <Trash2 size={12} />
          </button>
          <button onClick={() => setExpanded(false)} className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors" title="Collapse">
            <ChevronUp size={13} />
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
            autoFocus={!step.name}
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

        {/* Agent + Model */}
        <div className={`grid ${step.agent ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">Agent</label>
            <AgentSelector value={step.agent} onChange={agent => update({ agent, model: agent ? step.model : undefined })} />
          </div>
          {step.agent && (
            <div>
              <label className="block text-2xs font-medium text-muted-foreground mb-1">Model</label>
              <ModelSelector value={step.model} onChange={model => update({ model })} />
            </div>
          )}
        </div>

        {/* Skills (multi-select) */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Skills</label>
          <SkillsSelector
            value={allSkills}
            onChange={skills => update({ skills, skill: undefined })}
          />
        </div>

        {/* Context files */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground mb-1">Context files</label>
          <ContextSelector
            value={step.context ?? []}
            onChange={context => update({ context: context.length ? context : undefined })}
          />
        </div>

        {/* Description + Timeout in one row */}
        <div className="grid grid-cols-[1fr,auto] gap-3">
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">Description <span className="text-muted-foreground/50">(optional)</span></label>
            <input type="text" value={step.description || ''} onChange={e => update({ description: e.target.value || undefined })}
              placeholder="Brief description of this step"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground mb-1">Timeout</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} value={step.timeout || ''} onChange={e => update({ timeout: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="120"
                className="w-20 px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-2xs text-muted-foreground/50">sec</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
