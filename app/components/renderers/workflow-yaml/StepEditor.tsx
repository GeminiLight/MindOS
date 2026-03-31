'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, Settings2 } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(!step.prompt);
  const [showConfig, setShowConfig] = useState(false);

  const update = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });
  const allSkills = step.skills?.length ? step.skills : (step.skill ? [step.skill] : []);
  const hasConfig = !!(step.agent || step.model || allSkills.length || step.context?.length || step.description || step.timeout);

  // ── Collapsed ──
  if (!expanded) {
    return (
      <div className="group flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer -ml-1"
        onClick={() => setExpanded(true)}>
        <div className="min-w-0 flex-1">
          <span className={`text-sm leading-tight block ${step.name ? 'text-foreground font-medium' : 'text-muted-foreground/50 italic'}`}>
            {step.name || 'Untitled step'}
          </span>
          {/* Config summary pills */}
          {hasConfig && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {step.agent && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{step.agent}</span>}
              {allSkills.slice(0, 2).map(s => (
                <span key={s} className="text-2xs px-1.5 py-0.5 rounded-full bg-[var(--amber)]/8 text-[var(--amber)]">{s}</span>
              ))}
              {allSkills.length > 2 && <span className="text-2xs text-muted-foreground/50">+{allSkills.length - 2}</span>}
              {step.context?.length ? <span className="text-2xs text-muted-foreground/50">{step.context.length} files</span> : null}
            </div>
          )}
          {/* Prompt preview */}
          {step.prompt && (
            <p className="text-2xs text-muted-foreground/50 mt-1 line-clamp-1 leading-relaxed">{step.prompt}</p>
          )}
        </div>
        <ChevronDown size={12} className="text-muted-foreground/30 mt-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    );
  }

  // ── Expanded ──
  return (
    <div className="rounded-lg border border-[var(--amber)]/20 bg-card overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
        <span className={`text-xs font-medium flex-1 truncate ${step.name ? 'text-foreground' : 'text-muted-foreground/50 italic'}`}>
          {step.name || 'Untitled step'}
        </span>
        <div className="flex items-center gap-0.5">
          {onMoveUp && (
            <button onClick={onMoveUp} className="p-1 rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors" title="Move up">
              <ChevronUp size={12} />
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} className="p-1 rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors" title="Move down">
              <ChevronDown size={12} />
            </button>
          )}
          <button onClick={onDelete} className="p-1 rounded hover:bg-[var(--error)]/10 text-muted-foreground/50 hover:text-[var(--error)] transition-colors" title="Delete">
            <Trash2 size={11} />
          </button>
          <button onClick={() => setExpanded(false)} className="p-1 rounded hover:bg-muted text-muted-foreground/50 transition-colors" title="Collapse">
            <ChevronUp size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-3 space-y-3">
        {/* Name — inline style, not a labeled field */}
        <input type="text" value={step.name} onChange={e => update({ name: e.target.value })}
          placeholder="Step name..."
          autoFocus={!step.name}
          className="w-full text-sm font-medium bg-transparent text-foreground placeholder:text-muted-foreground/30 focus:outline-none border-none p-0"
        />

        {/* Prompt — the main content */}
        <textarea value={step.prompt} onChange={e => update({ prompt: e.target.value })}
          placeholder="What should the AI do?"
          rows={3}
          className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y leading-relaxed"
        />

        {/* Agent selector — always visible, it's important */}
        <div className={`grid ${step.agent ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
          <div>
            <label className="block text-2xs text-muted-foreground/60 mb-1">Agent</label>
            <AgentSelector value={step.agent} onChange={agent => update({ agent, model: agent ? step.model : undefined })} />
          </div>
          {step.agent && (
            <div>
              <label className="block text-2xs text-muted-foreground/60 mb-1">Model</label>
              <ModelSelector value={step.model} onChange={model => update({ model })} />
            </div>
          )}
        </div>

        {/* Config toggle — progressive disclosure for skills, context, timeout */}
        <button
          onClick={() => setShowConfig(v => !v)}
          className={`flex items-center gap-1.5 text-2xs transition-colors ${
            showConfig || hasConfig ? 'text-muted-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground'
          }`}
        >
          <Settings2 size={11} />
          {showConfig ? 'Less options' : 'More options'}
          {!showConfig && hasConfig && <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" />}
        </button>

        {showConfig && (
          <div className="space-y-3 pt-1">
            {/* Skills */}
            <div>
              <label className="block text-2xs text-muted-foreground/60 mb-1">Skills</label>
              <SkillsSelector value={allSkills} onChange={skills => update({ skills, skill: undefined })} />
            </div>

            {/* Context files */}
            <div>
              <label className="block text-2xs text-muted-foreground/60 mb-1">Context files</label>
              <ContextSelector value={step.context ?? []} onChange={context => update({ context: context.length ? context : undefined })} />
            </div>

            {/* Description + Timeout */}
            <div className="grid grid-cols-[1fr,auto] gap-3">
              <div>
                <label className="block text-2xs text-muted-foreground/60 mb-1">Description</label>
                <input type="text" value={step.description || ''} onChange={e => update({ description: e.target.value || undefined })}
                  placeholder="Optional note..."
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="block text-2xs text-muted-foreground/60 mb-1">Timeout</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} value={step.timeout || ''} onChange={e => update({ timeout: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="120"
                    className="w-16 px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <span className="text-2xs text-muted-foreground/40">s</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
