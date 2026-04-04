'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Zap, AlertTriangle, Loader2 } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath, relativeTime } from '@/lib/utils';

interface WorkflowItem {
  path: string;
  fileName: string;
  title: string;
  description?: string;
  stepCount: number;
  mtime: number;
  error?: string;
}

interface WorkflowsPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function WorkflowsPanel({ active, maximized, onMaximize }: WorkflowsPanelProps) {
  const { t } = useLocale();
  const wt = t.panels.workflows as {
    title: string;
    empty: string;
    emptyDesc: string;
    newWorkflow: string;
    nSteps: (n: number) => string;
    parseError: string;
    name: string;
    namePlaceholder: string;
    template: string;
    templateBlank: string;
    create: string;
    cancel: string;
    creating: string;
    exists: string;
  };

  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows');
      if (!res.ok) return;
      const data = await res.json();
      setWorkflows(data.workflows ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) fetchWorkflows();
  }, [active, fetchWorkflows]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError('');

    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(res.status === 409 ? wt.exists : (data.error || 'Error'));
        return;
      }
      // Refresh list and navigate to new file
      setShowCreate(false);
      setNewName('');
      await fetchWorkflows();
      window.location.href = `/view/${encodePath(data.path)}`;
    } catch {
      setCreateError('Network error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={wt.title} maximized={maximized} onMaximize={onMaximize}>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={wt.newWorkflow}
          title={wt.newWorkflow}
        >
          <Plus size={13} />
        </button>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Create form */}
        {showCreate && (
          <div className="px-3 py-3 border-b border-border">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{wt.name}</label>
            <input
              type="text"
              value={newName}
              onChange={e => { setNewName(e.target.value); setCreateError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder={wt.namePlaceholder}
              autoFocus
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {createError && (
              <p className="text-xs text-[var(--error)] mt-1">{createError}</p>
            )}
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => { setShowCreate(false); setNewName(''); setCreateError(''); }}
                className="flex-1 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                {wt.cancel}
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="flex-1 px-3 py-1.5 text-xs rounded-md font-medium transition-colors disabled:opacity-50 bg-[var(--amber)] text-[var(--amber-foreground)]"
              >
                {creating ? wt.creating : wt.create}
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && workflows.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <Zap size={24} className="text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground mb-1">{wt.empty}</p>
            <p className="text-xs text-muted-foreground/70 mb-4 max-w-[200px]">{wt.emptyDesc}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium bg-[var(--amber)] text-[var(--amber-foreground)] transition-colors"
            >
              <Plus size={12} />
              {wt.newWorkflow}
            </button>
          </div>
        )}

        {/* Workflow list */}
        {!loading && workflows.length > 0 && (
          <div className="flex flex-col gap-0.5 py-1.5">
            {workflows.map(w => (
              <Link
                key={w.path}
                href={`/view/${encodePath(w.path)}`}
                className={`flex items-start gap-2.5 px-3 py-2 mx-1 rounded-lg transition-colors hover:bg-muted ${
                  w.error ? 'opacity-70' : ''
                }`}
              >
                <Zap size={14} className="shrink-0 mt-0.5 text-[var(--amber)]" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground block truncate">{w.title}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {w.error ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-[var(--error)]">
                        <AlertTriangle size={10} />
                        {wt.parseError}
                      </span>
                    ) : (
                      <span className="text-2xs text-muted-foreground">
                        {wt.nSteps(w.stepCount)}
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground/60" suppressHydrationWarning>
                      {relativeTime(w.mtime, t.home?.relativeTime)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
