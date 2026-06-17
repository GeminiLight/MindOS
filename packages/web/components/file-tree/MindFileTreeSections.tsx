'use client';

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Activity, ChevronDown, Layers } from 'lucide-react';
import FileTree from '@/components/FileTree';
import type { MindSystemSlot } from '@/lib/mind-system';
import type { FileNode } from '@/lib/types';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { splitMindFileTreeSections } from './mind-file-tree-sections';

const MIND_SYSTEM_COLLAPSED_KEY = 'mindos.sidebar.mindSystemCollapsed';
const MIND_SYSTEM_TREE_ID_PREFIX = 'mind-system-sidebar-tree';

interface MindFileTreeSectionsProps {
  fileTree: FileNode[];
  mindSystemSlots: MindSystemSlot[];
  onNavigate?: () => void;
  maxOpenDepth?: number | null;
  onImport?: (space?: string) => void;
}

export default function MindFileTreeSections({
  fileTree,
  mindSystemSlots,
  onNavigate,
  maxOpenDepth,
  onImport,
}: MindFileTreeSectionsProps) {
  const { t } = useLocale();
  const sections = useMemo(
    () => splitMindFileTreeSections(fileTree, mindSystemSlots),
    [fileTree, mindSystemSlots],
  );

  return (
    <div className="space-y-3">
      <MindSystemTreeSection
        title={t.sidebar.builtInSpacesTitle}
        nodes={sections.mindSystemTree}
        onNavigate={onNavigate}
        maxOpenDepth={maxOpenDepth}
        onImport={onImport}
        defaultOpenDepth={-1}
      />
      <TreeSection
        title={t.sidebar.spacesTitle}
        icon={<Layers size={12} strokeWidth={2.1} aria-hidden="true" />}
        nodes={sections.spaceTree}
        onNavigate={onNavigate}
        maxOpenDepth={maxOpenDepth}
        onImport={onImport}
      />
      <TreeSection
        title={t.sidebar.otherFilesTitle}
        nodes={sections.otherFileTree}
        onNavigate={onNavigate}
        maxOpenDepth={maxOpenDepth}
        onImport={onImport}
      />
    </div>
  );
}

function TreeSection({
  title,
  icon,
  nodes,
  onNavigate,
  maxOpenDepth,
  onImport,
  defaultOpenDepth,
}: {
  title: string;
  icon?: ReactNode;
  nodes: FileNode[];
  onNavigate?: () => void;
  maxOpenDepth?: number | null;
  onImport?: (space?: string) => void;
  defaultOpenDepth?: number;
}) {
  if (nodes.length === 0) return null;

  return (
    <section aria-label={title} className="space-y-1">
      <div className="flex items-center gap-1.5 px-2 text-[11px] font-semibold leading-5 text-muted-foreground/70">
        {icon && <span className="shrink-0 text-[var(--amber)]/75">{icon}</span>}
        {title}
      </div>
      <FileTree
        nodes={nodes}
        onNavigate={onNavigate}
        maxOpenDepth={maxOpenDepth}
        onImport={onImport}
        defaultOpenDepth={defaultOpenDepth}
      />
    </section>
  );
}

function MindSystemTreeSection({
  title,
  nodes,
  onNavigate,
  maxOpenDepth,
  onImport,
  defaultOpenDepth,
}: {
  title: string;
  nodes: FileNode[];
  onNavigate?: () => void;
  maxOpenDepth?: number | null;
  onImport?: (space?: string) => void;
  defaultOpenDepth?: number;
}) {
  const pathname = usePathname();
  const generatedId = useId().replace(/:/g, '');
  const treeId = `${MIND_SYSTEM_TREE_ID_PREFIX}-${generatedId}`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      const stored = localStorage.getItem(MIND_SYSTEM_COLLAPSED_KEY);
      if (stored !== '1' && stored !== '0') return;

      const restoreCollapsedState = () => {
        if (alive) setCollapsed(stored === '1');
      };

      if (typeof queueMicrotask === 'function') queueMicrotask(restoreCollapsedState);
      else window.setTimeout(restoreCollapsedState, 0);
    } catch { /* localStorage unavailable */ }
    return () => { alive = false; };
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* localStorage unavailable */ }
      return next;
    });
  }, []);

  if (nodes.length === 0) return null;

  const activeSystemPath = nodes.some((node) => {
    const href = `/view/${encodePath(node.path)}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  });

  return (
    <section className="mb-2 space-y-1 border-b border-border/40 px-1 pb-2" aria-label={title}>
      <button
        type="button"
        onClick={toggleCollapsed}
        data-state={collapsed ? 'collapsed' : 'expanded'}
        data-hit-active={!collapsed || activeSystemPath ? 'true' : undefined}
        aria-expanded={!collapsed}
        aria-controls={treeId}
        className="hit-target-box relative flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-border-width:1px] [--hit-target-border:transparent] [--hit-target-hover-bg:var(--muted)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_65%,transparent)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_28%,transparent)]"
      >
        <span className={`flex h-6 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
          collapsed
            ? 'border-border bg-background/50 text-[var(--amber)]/75'
            : 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber)]'
        }`}>
          <Activity size={15} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 py-0.5">
          <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted-foreground/60 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && (
        <div id={treeId} className="space-y-0.5">
          <FileTree
            nodes={nodes}
            onNavigate={onNavigate}
            maxOpenDepth={maxOpenDepth}
            onImport={onImport}
            defaultOpenDepth={defaultOpenDepth}
          />
        </div>
      )}
    </section>
  );
}
