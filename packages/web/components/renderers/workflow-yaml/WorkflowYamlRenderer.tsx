'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { Pencil, Play, AlertCircle, Zap } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';
import { parseWorkflowYaml } from './parser';
import WorkflowEditor from './WorkflowEditor';
import WorkflowRunner from './WorkflowRunner';
import type { WorkflowYaml } from './types';

type Mode = 'edit' | 'run';

export function WorkflowYamlRenderer({ filePath, content }: RendererContext) {
  const parsed = useMemo(() => parseWorkflowYaml(content), [content]);
  const [mode, setMode] = useState<Mode>('edit');
  const [dirty, setDirty] = useState(false);

  const [editWorkflow, setEditWorkflow] = useState<WorkflowYaml>(() => {
    if (parsed.workflow) return structuredClone(parsed.workflow);
    return { title: '', description: '', steps: [] };
  });

  const savedContentRef = useRef(content);
  const latestParsed = useMemo(() => parsed.workflow ?? null, [parsed.workflow]);

  const handleEditorChange = useCallback((wf: WorkflowYaml) => {
    setEditWorkflow(wf);
    setDirty(true);
  }, []);

  const handleSaved = useCallback(() => setDirty(false), []);

  const runWorkflow = latestParsed ?? editWorkflow;
  const canRun = runWorkflow.steps.length > 0 && !!runWorkflow.title;
  const hasParseErrors = parsed.errors.length > 0;

  const runDisabledReason = !runWorkflow.title
    ? 'Add a title first'
    : runWorkflow.steps.length === 0
      ? 'Add at least one step'
      : dirty ? 'Save changes first' : undefined;

  const handleModeSwitch = (target: Mode) => {
    if (target === 'run' && !canRun) return;
    setMode(target);
  };

  return (
    <div className="max-w-[720px] mx-auto py-8 px-2">
      {/* Hero header — gives the page identity */}
      <div className="mb-8">
        {/* Mode tabs + step count */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/50">
            <button
              onClick={() => handleModeSwitch('edit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === 'edit'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Pencil size={11} />
              Edit
            </button>
            <button
              onClick={() => handleModeSwitch('run')}
              disabled={!canRun}
              title={runDisabledReason}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                mode === 'run'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Play size={11} />
              Run
            </button>
          </div>

          {editWorkflow.steps.length > 0 && (
            <span className="text-2xs text-muted-foreground/60 font-mono">
              {editWorkflow.steps.length} step{editWorkflow.steps.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="flex items-start gap-3">
          <div className="mt-1 w-8 h-8 rounded-lg bg-[var(--amber)]/10 flex items-center justify-center shrink-0">
            <Zap size={16} className="text-[var(--amber)]" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
              {editWorkflow.title || 'Untitled Flow'}
              {dirty && <span className="text-[var(--amber)] ml-1.5 text-sm" title="Unsaved changes">*</span>}
            </h1>
            {editWorkflow.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{editWorkflow.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Parse error banner */}
      {hasParseErrors && mode === 'edit' && (
        <div className="mb-5 px-3.5 py-3 rounded-lg bg-[var(--error)]/8 border border-[var(--error)]/20">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertCircle size={13} className="text-[var(--error)] shrink-0" />
            <span className="text-xs font-medium text-[var(--error)]">Parse issues found</span>
          </div>
          <ul className="text-2xs text-[var(--error)]/70 pl-5 list-disc space-y-0.5">
            {parsed.errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Content */}
      {mode === 'edit' ? (
        <WorkflowEditor workflow={editWorkflow} filePath={filePath} onChange={handleEditorChange} onSaved={handleSaved} />
      ) : (
        <WorkflowRunner workflow={runWorkflow} filePath={filePath} />
      )}
    </div>
  );
}
