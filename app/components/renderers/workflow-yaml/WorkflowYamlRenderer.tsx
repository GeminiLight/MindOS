'use client';

import { useMemo, useState, useCallback } from 'react';
import { Pencil, Play, AlertCircle } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';
import { parseWorkflowYaml } from './parser';
import WorkflowEditor from './WorkflowEditor';
import WorkflowRunner from './WorkflowRunner';
import type { WorkflowYaml } from './types';

type Mode = 'edit' | 'run';

export function WorkflowYamlRenderer({ filePath, content }: RendererContext) {
  const parsed = useMemo(() => parseWorkflowYaml(content), [content]);
  const [mode, setMode] = useState<Mode>('edit');

  // Editor state: start from parsed workflow or a blank template
  const [editWorkflow, setEditWorkflow] = useState<WorkflowYaml>(() => {
    if (parsed.workflow) return structuredClone(parsed.workflow);
    return { title: '', description: '', steps: [] };
  });

  // When content changes externally (e.g. file reload), re-parse
  const latestParsed = useMemo(() => {
    if (parsed.workflow) return parsed.workflow;
    return null;
  }, [parsed.workflow]);

  const handleEditorChange = useCallback((wf: WorkflowYaml) => {
    setEditWorkflow(wf);
  }, []);

  // The runner uses the latest parsed workflow (from file), not editor state
  const runWorkflow = latestParsed ?? editWorkflow;
  const canRun = runWorkflow.steps.length > 0 && !!runWorkflow.title;

  // Parse errors: show inline warning but still allow editing
  const hasParseErrors = parsed.errors.length > 0;

  return (
    <div className="max-w-[720px] mx-auto py-6 px-1">
      {/* Mode switcher + title */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              mode === 'edit'
                ? 'bg-[var(--amber)] text-[var(--amber-foreground)] font-medium'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            onClick={() => canRun && setMode('run')}
            disabled={!canRun}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors disabled:opacity-40 ${
              mode === 'run'
                ? 'bg-[var(--amber)] text-[var(--amber-foreground)] font-medium'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Play size={12} />
            Run
          </button>
        </div>

        <h1 className="text-base font-semibold text-foreground truncate flex-1">
          {editWorkflow.title || 'New Workflow'}
        </h1>
      </div>

      {/* Parse error banner (non-blocking) */}
      {hasParseErrors && mode === 'edit' && (
        <div className="mb-4 px-3 py-2.5 rounded-lg bg-[var(--error)]/10 border border-[var(--error)]/30">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={13} className="text-[var(--error)] shrink-0" />
            <span className="text-xs font-medium text-[var(--error)]">File has parse issues</span>
          </div>
          <ul className="text-2xs text-[var(--error)]/80 pl-5 list-disc">
            {parsed.errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Content */}
      {mode === 'edit' ? (
        <WorkflowEditor
          workflow={editWorkflow}
          filePath={filePath}
          onChange={handleEditorChange}
        />
      ) : (
        <WorkflowRunner
          workflow={runWorkflow}
          filePath={filePath}
        />
      )}
    </div>
  );
}
