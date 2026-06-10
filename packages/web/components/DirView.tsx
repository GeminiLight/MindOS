'use client';

import { useSyncExternalStore, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Table, Folder, FolderOpen, LayoutGrid, List, FilePlus, ScrollText, BookOpen, Copy, AlertTriangle, Sparkles, Loader2, Check, Play, Pencil } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { encodePath, relativeTime } from '@/lib/utils';
import { FileNode, SYSTEM_FILES } from '@/lib/types';
import type { SpacePreview } from '@/lib/core/types';
import { useLocale } from '@/lib/stores/locale-store';
import { openMindSystemAssistantRun } from '@/lib/mind-system-assistant-actions';
import type { BuiltInMindSystemSpaceRecord } from '@/lib/space-records';
import { getMindSystemAssistantAvatar, resolveMindSystemAssistantCopies, type MindSystemAssistantAvatar, type MindSystemAssistantCopy } from '@/lib/mind-system-assistant-copy';
import { getAssistantProfilePath, getAssistantPromptPath } from '@/lib/mind-system-assistant-paths';
import type { AssistantScheduleMode, MindSystemSpaceAssistant } from '@/lib/mind-system-assistants';
import { apiFetch } from '@/lib/api';

async function copyPathToClipboard(path: string) {
  try { await navigator.clipboard.writeText(path); } catch { /* noop */ }
}

interface DirViewProps {
  dirPath: string;
  entries: FileNode[];
  spacePreview?: SpacePreview | null;
  mindSystemSpace?: BuiltInMindSystemSpaceRecord | null;
}

function FileIcon({ node }: { node: FileNode }) {
  if (node.type === 'directory') return <Folder size={16} className="text-yellow-400 shrink-0" />;
  if (node.extension === '.csv') return <Table size={16} className="text-success shrink-0" />;
  return <FileText size={16} className="text-muted-foreground shrink-0" />;
}

function FileIconLarge({ node }: { node: FileNode }) {
  if (node.type === 'directory') return <FolderOpen size={28} className="text-yellow-400" />;
  if (node.extension === '.csv') return <Table size={28} className="text-success" />;
  return <FileText size={28} className="text-muted-foreground" />;
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((acc, c) => acc + countFiles(c), 0);
}

const DIR_VIEW_KEY = 'mindos-dir-view';
const HIDDEN_FILES_KEY = 'show-hidden-files';

function subscribeHiddenFiles(cb: () => void) {
  const handler = (e: StorageEvent) => { if (e.key === HIDDEN_FILES_KEY) cb(); };
  const custom = () => cb();
  window.addEventListener('storage', handler);
  window.addEventListener('mindos:hidden-files-changed', custom);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('mindos:hidden-files-changed', custom);
  };
}

function getShowHiddenFiles() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(HIDDEN_FILES_KEY) === 'true';
}

function useShowHiddenFiles() {
  return useSyncExternalStore(subscribeHiddenFiles, getShowHiddenFiles, () => false);
}

function useDirViewPref() {
  const view = useSyncExternalStore(
    (onStoreChange) => {
      const listener = () => onStoreChange();
      window.addEventListener('mindos-dir-view-change', listener);
      return () => window.removeEventListener('mindos-dir-view-change', listener);
    },
    () => {
      const saved = localStorage.getItem(DIR_VIEW_KEY);
      return (saved === 'list' || saved === 'grid') ? saved : 'grid';
    },
    () => 'grid' as const,
  );

  const setView = (v: 'grid' | 'list') => {
    localStorage.setItem(DIR_VIEW_KEY, v);
    window.dispatchEvent(new Event('mindos-dir-view-change'));
  };

  return [view, setView] as const;
}

// ─── Space Preview Cards ──────────────────────────────────────────────────────

function SpacePreviewCard({ icon, title, lines, viewAllHref, viewAllLabel, trailing, footer }: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  viewAllHref: string;
  viewAllLabel: string;
  trailing?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-sm font-medium text-muted-foreground flex-1">{title}</span>
        {trailing}
      </div>
      <div className="space-y-1">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-muted-foreground/80 leading-relaxed" suppressHydrationWarning>
            · {line}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        {footer || <span />}
        <Link
          href={viewAllHref}
          className="text-xs hover:underline transition-colors text-[var(--amber)]"
        >
          {viewAllLabel}
        </Link>
      </div>
    </div>
  );
}

// ─── AI Overview Generation ───────────────────────────────────────────────────

type OverviewState = 'idle' | 'loading' | 'error' | 'unchanged';

function useSpaceFileCount(dirPath: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/api/space-overview?space=${encodeURIComponent(dirPath)}`)
      .then(r => r.json())
      .then(d => setCount(d.fileCount ?? 0))
      .catch(() => setCount(null));
  }, [dirPath]);
  return count;
}

function OverviewCtaCard({ dirPath }: { dirPath: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [state, setState] = useState<OverviewState>('idle');
  const [error, setError] = useState('');
  const fileCount = useSpaceFileCount(dirPath);

  const handleGenerate = async () => {
    setState('loading');
    setError('');
    try {
      const res = await fetch('/api/space-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space: dirPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unknown error');
        setState('error');
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  };

  return (
    <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-4">
      <div className="flex items-center gap-1.5 mb-3">
        <BookOpen size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-muted-foreground">{t.fileTree.about}</span>
      </div>

      {state === 'loading' ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <Loader2 size={20} className="text-[var(--amber)] animate-spin" />
          <p className="text-sm text-muted-foreground">{t.dirView.overviewGenerating}</p>
          {fileCount != null && fileCount > 0 && (
            <p className="text-xs text-muted-foreground/60">{t.dirView.overviewScanningFiles(fileCount)}</p>
          )}
        </div>
      ) : state === 'error' ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <AlertTriangle size={18} className="text-error" />
          <p className="text-sm text-muted-foreground">{t.dirView.overviewError}</p>
          <p className="text-xs text-muted-foreground/60 text-center max-w-[280px]">{error}</p>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={handleGenerate}
              className="text-xs text-[var(--amber)] hover:underline"
            >
              {t.dirView.overviewRetry}
            </button>
            <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">
              {t.dirView.uninitSettings}
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 py-2">
          {fileCount != null && fileCount > 0 ? (
            <>
              <p className="text-sm text-muted-foreground text-center">
                {t.dirView.overviewCtaHint(fileCount)}
              </p>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90"
              >
                <Sparkles size={14} />
                {t.dirView.overviewCta}
              </button>
            </>
          ) : fileCount === 0 ? (
            <p className="text-sm text-muted-foreground">{t.dirView.overviewNoFiles}</p>
          ) : null}
          <Link
            href={`/view/${encodePath(`${dirPath}/README.md`)}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t.dirView.overviewOrEdit}
          </Link>
        </div>
      )}
    </div>
  );
}

function AboutCardWithRegenerate({ dirPath, preview }: {
  dirPath: string;
  preview: SpacePreview;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [state, setState] = useState<OverviewState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const confirmRef = useRef<HTMLDivElement>(null);

  // Close confirm popover on click outside
  useEffect(() => {
    if (!showConfirm) return;
    const handler = (e: MouseEvent) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) {
        setShowConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showConfirm]);

  const handleRegenerate = async () => {
    setShowConfirm(false);
    setState('loading');
    setErrorMsg('');
    setToastMsg('');
    try {
      const res = await fetch('/api/space-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space: dirPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Unknown error');
        setState('error');
        return;
      }
      if (data.unchanged) {
        setState('unchanged');
        setTimeout(() => setState('idle'), 3000);
      } else {
        // Show incremental info if available
        if (data.stats?.mode === 'incremental') {
          setToastMsg(t.dirView.overviewIncremental(data.stats.scannedFiles));
          setTimeout(() => setToastMsg(''), 4000);
        }
        router.refresh();
        setState('idle');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  };

  if (state === 'loading') {
    return (
      <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <BookOpen size={14} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-muted-foreground flex-1">{t.fileTree.about}</span>
        </div>
        <div className="flex items-center gap-2 py-2">
          <Loader2 size={14} className="text-[var(--amber)] animate-spin" />
          <span className="text-sm text-muted-foreground">{t.dirView.overviewGenerating}</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <BookOpen size={14} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-muted-foreground flex-1">{t.fileTree.about}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 py-2">
          <p className="text-xs text-error">{t.dirView.overviewError}</p>
          {errorMsg && <p className="text-xs text-muted-foreground/60 text-center">{errorMsg}</p>}
          <button onClick={handleRegenerate} className="text-xs text-[var(--amber)] hover:underline mt-1">
            {t.dirView.overviewRetry}
          </button>
        </div>
      </div>
    );
  }

  const regenerateBtn = (
    <div className="relative" ref={confirmRef}>
      <button
        onClick={() => setShowConfirm(true)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground/60 hover:text-[var(--amber)] hover:bg-[var(--amber)]/10 transition-colors"
        title={t.dirView.overviewRegenerate}
      >
        <Sparkles size={13} />
        <span className="hidden sm:inline">{t.dirView.overviewRegenerateLabel}</span>
      </button>
      {showConfirm && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-[260px] bg-card border border-border rounded-lg shadow-lg p-3">
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            {t.dirView.overviewRegenerateConfirm}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              {t.dirView.overviewRegenerateCancel}
            </button>
            <button
              onClick={handleRegenerate}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-colors"
            >
              <Sparkles size={11} />
              {t.dirView.overviewRegenerateStart}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Build footer with lastCompiled time and status messages
  const footerContent = (
    <span className="text-2xs text-muted-foreground/50" suppressHydrationWarning>
      {state === 'unchanged' ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check size={10} />
          {t.dirView.overviewUnchanged}
        </span>
      ) : toastMsg ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check size={10} />
          {toastMsg}
        </span>
      ) : preview.lastCompiled ? (
        t.dirView.overviewLastCompiled(
          relativeTime(new Date(preview.lastCompiled).getTime(), t.home.relativeTime)
        )
      ) : null}
    </span>
  );

  return (
    <SpacePreviewCard
      icon={<BookOpen size={14} className="text-muted-foreground shrink-0" />}
      title={t.fileTree.about}
      lines={preview.readmeLines}
      viewAllHref={`/view/${encodePath(`${dirPath}/README.md`)}`}
      viewAllLabel={t.fileTree.viewAll}
      trailing={regenerateBtn}
      footer={footerContent}
    />
  );
}

function SpacePreviewSection({ preview, dirPath }: {
  preview: SpacePreview;
  dirPath: string;
}) {
  const { t } = useLocale();
  const hasRules = preview.instructionLines.length > 0;
  const hasAbout = preview.readmeLines.length > 0;
  const isReadmeTemplate = !hasAbout || preview.readmeIsTemplate || preview.isTemplate;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      {hasRules && (
        <SpacePreviewCard
          icon={<ScrollText size={14} className="text-muted-foreground shrink-0" />}
          title={t.fileTree.rules}
          lines={preview.instructionLines}
          viewAllHref={`/view/${encodePath(`${dirPath}/INSTRUCTION.md`)}`}
          viewAllLabel={t.fileTree.viewAll}
        />
      )}
      {isReadmeTemplate ? (
        <OverviewCtaCard dirPath={dirPath} />
      ) : (
        <AboutCardWithRegenerate dirPath={dirPath} preview={preview} />
      )}
    </div>
  );
}

const ASSISTANT_PREVIEW_LIMIT = 3;
type SpaceDocumentKind = 'rules' | 'about';

type MindSystemAssistantViewModel = MindSystemSpaceAssistant & MindSystemAssistantCopy & {
  promptPath: string;
  profilePath: string;
  avatar: MindSystemAssistantAvatar;
};

type EditableAssistantProfile = {
  name: string;
  desc: string;
  scheduleMode: AssistantScheduleMode;
};

const ASSISTANT_SCHEDULE_MODE_OPTIONS: AssistantScheduleMode[] = ['manual', 'daily', 'weekly'];

function MindSystemSpacePanel({ space, spacePreview }: { space: BuiltInMindSystemSpaceRecord; spacePreview?: SpacePreview | null }) {
  const { t } = useLocale();
  const [showAllAssistants, setShowAllAssistants] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<MindSystemAssistantViewModel | null>(null);
  const [spaceDocument, setSpaceDocument] = useState<SpaceDocumentKind | null>(null);
  const pillar = t.home.mindPillars[space.slot.key];
  const assistantCopies = resolveMindSystemAssistantCopies(
    space.assistantSummary.assistants,
    t.home.mindAssistants[space.slot.key],
  );
  const assistants: MindSystemAssistantViewModel[] = space.assistantSummary.assistants.map((assistant, index) => {
    const copy = assistantCopies[index] ?? { id: assistant.id, name: assistant.id, desc: assistant.id };
    const promptPath = assistant.promptPath ?? getAssistantPromptPath(assistant.id);
    const profilePath = assistant.profilePath ?? getAssistantProfilePath(assistant.id);
    const avatar = getMindSystemAssistantAvatar(copy.name, assistant.id);
    return {
      ...assistant,
      ...copy,
      promptPath,
      profilePath,
      avatar,
    };
  });
  const visibleAssistants = showAllAssistants ? assistants : assistants.slice(0, ASSISTANT_PREVIEW_LIMIT);
  const hiddenAssistantCount = Math.max(0, assistants.length - ASSISTANT_PREVIEW_LIMIT);
  const spaceTitle = pillar?.title ?? space.slot.label;
  const spaceDescription = pillar?.desc ?? space.description ?? space.slot.role;

  return (
    <section
      data-mind-system-space-panel={space.slot.key}
      data-mind-system-dir-assistant={space.slot.key}
      className="mb-5 overflow-hidden rounded-lg border border-border/70 bg-card/55"
      aria-label={spaceTitle}
    >
      <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-base font-semibold text-[var(--amber)]"
            aria-hidden="true"
          >
            {space.slot.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-5 text-foreground">{spaceTitle}</div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{spaceDescription}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            data-mind-system-space-doc-button="rules"
            onClick={() => setSpaceDocument('rules')}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ScrollText size={12} className="mr-1.5" aria-hidden="true" />
            {t.fileTree.rules}
          </button>
          <button
            type="button"
            data-mind-system-space-doc-button="about"
            onClick={() => setSpaceDocument('about')}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookOpen size={12} className="mr-1.5" aria-hidden="true" />
            {t.fileTree.about}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 p-3 lg:grid-cols-3">
        {visibleAssistants.map((assistant) => (
          <article
            key={assistant.id}
            data-mind-system-dir-assistant-item={assistant.id}
            className="group min-w-0 rounded-lg border border-border/65 bg-background/55 p-3.5 transition-colors hover:border-[var(--amber)]/35 hover:bg-background/75"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                data-mind-system-dir-assistant-icon={assistant.id}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-xs font-semibold ${assistant.avatar.className}`}
                aria-hidden="true"
              >
                {assistant.avatar.text}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold leading-5 text-foreground">{assistant.name}</div>
                <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
                  {assistant.desc}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="inline-flex rounded-md bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    {t.home.mindAssistant.scheduleMode[assistant.schedule.mode]}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/45 pt-2.5">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditingAssistant(assistant)}
                  data-mind-system-dir-edit-assistant={assistant.id}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil size={10} aria-hidden="true" />
                  {t.home.mindAssistant.editAssistant}
                </button>
              </div>
              <button
                type="button"
                data-mind-system-dir-run-once={assistant.id}
                onClick={() => openMindSystemAssistantRun({
                  spaceTitle,
                  assistantName: assistant.name,
                  assistantDesc: assistant.desc,
                  spacePath: space.slot.path,
                  promptPath: assistant.promptPath,
                  runPrompt: t.home.mindAssistant.runPrompt,
                })}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--amber)]/10 px-2.5 text-[10px] font-medium text-[var(--amber)] transition-colors hover:bg-[var(--amber)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
                aria-label={`${t.home.mindAssistant.runOnce}: ${assistant.name}`}
              >
                <Play size={11} aria-hidden="true" />
                {t.home.mindAssistant.runOnce}
              </button>
            </div>
          </article>
        ))}
      </div>
      {hiddenAssistantCount > 0 && (
        <button
          type="button"
          data-mind-system-dir-view-all-assistants={space.slot.key}
          onClick={() => setShowAllAssistants(value => !value)}
          className="mt-3 inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-medium text-[var(--amber)] transition-colors hover:bg-[var(--amber)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={showAllAssistants}
        >
          {showAllAssistants
            ? t.home.mindAssistant.showLessAssistants
            : t.home.mindAssistant.viewAllAssistants(assistants.length)}
        </button>
      )}
      <MindSystemAssistantEditDialog
        assistant={editingAssistant}
        spaceTitle={spaceTitle}
        spacePath={space.slot.path}
        onClose={() => setEditingAssistant(null)}
      />
      <SpaceDocumentDialog
        kind={spaceDocument}
        dirPath={space.slot.path}
        preview={spacePreview}
        onClose={() => setSpaceDocument(null)}
      />
    </section>
  );
}

function SpaceDocumentDialog({
  kind,
  dirPath,
  preview,
  onClose,
}: {
  kind: SpaceDocumentKind | null;
  dirPath: string;
  preview?: SpacePreview | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const open = Boolean(kind);
  const isRules = kind === 'rules';
  const title = isRules ? t.fileTree.rules : t.fileTree.about;
  const Icon = isRules ? ScrollText : BookOpen;
  const lines = isRules ? (preview?.instructionLines ?? []) : (preview?.readmeLines ?? []);
  const targetPath = `${dirPath}/${isRules ? 'INSTRUCTION.md' : 'README.md'}`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        {kind && (
          <div data-mind-system-space-doc-dialog={kind}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Icon size={15} className="text-[var(--amber)]/80" aria-hidden="true" />
                {title}
              </DialogTitle>
              <DialogDescription className="sr-only">{title}</DialogDescription>
            </DialogHeader>
            <div className="mt-4 max-h-[52vh] overflow-y-auto rounded-lg border border-border/65 bg-muted/20 p-3">
              {lines.length > 0 ? (
                <div className="space-y-2">
                  {lines.map((line, index) => (
                    <p key={`${kind}-${index}`} className="text-sm leading-relaxed text-muted-foreground" suppressHydrationWarning>
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {isRules ? t.home.mindAssistant.instructionMissing : t.dirView.overviewNoFiles}
                </p>
              )}
            </div>
            <DialogFooter className="mt-4">
              <button
                type="button"
                data-mind-system-space-doc-close={kind}
                onClick={onClose}
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.home.mindAssistant.close}
              </button>
              <Link
                href={`/view/${encodePath(targetPath)}`}
                data-mind-system-space-doc-open={kind}
                onClick={onClose}
                className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--amber)] px-3 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.fileTree.viewAll}
              </Link>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MindSystemAssistantEditDialog({
  assistant,
  spaceTitle,
  spacePath,
  onClose,
}: {
  assistant: MindSystemAssistantViewModel | null;
  spaceTitle: string;
  spacePath: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [promptContent, setPromptContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [profile, setProfile] = useState<EditableAssistantProfile>({ name: '', desc: '', scheduleMode: 'manual' });
  const [originalProfile, setOriginalProfile] = useState<EditableAssistantProfile>({ name: '', desc: '', scheduleMode: 'manual' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'missing' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!assistant) return;
    let canceled = false;

    setPromptContent('');
    setOriginalContent('');
    setLoading(true);
    setSaving(false);
    setStatus('idle');
    setMessage('');
    const nextProfile = {
      name: assistant.name,
      desc: assistant.desc,
      scheduleMode: assistant.schedule.mode,
    };
    setProfile(nextProfile);
    setOriginalProfile(nextProfile);

    async function loadPrompt() {
      if (!assistant) return;
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(assistant.promptPath)}&op=read_file`);
        if (!res.ok) {
          if (res.status === 404) {
            const fallback = buildDefaultPromptDraft(assistant, spaceTitle, spacePath);
            if (canceled) return;
            setPromptContent(fallback);
            setOriginalContent('');
            setStatus('missing');
            setMessage(t.home.mindAssistant.promptMissingHint);
            return;
          }
          let errorMessage = t.home.mindAssistant.loadPromptFailed;
          try {
            const body = await res.json();
            if (body?.error) errorMessage = typeof body.error === 'string' ? body.error : body.error.message ?? errorMessage;
          } catch { /* ignore non-JSON error */ }
          throw new Error(errorMessage);
        }
        const body = await res.json() as { content?: unknown };
        const content = typeof body.content === 'string' ? body.content : '';
        if (canceled) return;
        setPromptContent(content);
        setOriginalContent(content);
        setStatus('idle');
      } catch (error) {
        if (canceled) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : t.home.mindAssistant.loadPromptFailed);
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void loadPrompt();
    return () => { canceled = true; };
  }, [assistant, spacePath, spaceTitle, t.home.mindAssistant.loadPromptFailed, t.home.mindAssistant.promptMissingHint]);

  const promptHasChanges = promptContent !== originalContent;
  const profileHasChanges = profile.name !== originalProfile.name
    || profile.desc !== originalProfile.desc
    || profile.scheduleMode !== originalProfile.scheduleMode;
  const hasChanges = promptHasChanges || profileHasChanges;
  const canSave = Boolean(assistant)
    && !loading
    && !saving
    && profile.name.trim().length > 0
    && promptContent.trim().length > 0
    && hasChanges;
  const statusLabel = loading
    ? t.home.mindAssistant.loadingPrompt
    : saving
      ? t.home.mindAssistant.savingChanges
      : status === 'saved'
        ? t.home.mindAssistant.savedChanges
        : status === 'missing'
          ? t.home.mindAssistant.promptMissing
          : hasChanges
            ? t.home.mindAssistant.unsavedChanges
            : t.home.mindAssistant.promptReady;
  const statusClassName = status === 'error' || (!loading && promptContent.trim().length === 0)
    ? 'bg-[var(--error)]/10 text-[var(--error)]'
    : status === 'saved'
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : hasChanges
        ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
        : 'bg-muted text-muted-foreground';
  const promptCharacterCount = t.home.mindAssistant.promptCharacters(promptContent.length);
  const displayName = profile.name.trim() || assistant?.name || '';
  const displayDesc = profile.desc.trim();
  const displayAvatar = assistant ? getMindSystemAssistantAvatar(displayName, assistant.id) : null;

  const saveAssistant = async () => {
    if (!assistant || !canSave) return;
    setSaving(true);
    setStatus('idle');
    setMessage('');
    try {
      let savedPath: string | undefined;
      if (profileHasChanges) {
        const result = await apiFetch<{ ok?: boolean; path?: string; mtime?: number }>('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'save_file',
            path: assistant.profilePath,
            content: JSON.stringify({
              name: profile.name.trim(),
              desc: profile.desc.trim(),
              schedule: { mode: profile.scheduleMode },
            }, null, 2) + '\n',
            source: 'user',
          }),
        });
        savedPath = result?.path;
      }
      if (promptHasChanges) {
        const result = await apiFetch<{ ok?: boolean; path?: string; mtime?: number }>('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'save_file',
            path: assistant.promptPath,
            content: promptContent,
            source: 'user',
          }),
        });
        savedPath = result?.path ?? savedPath;
      }
      setOriginalContent(promptContent);
      setOriginalProfile({
        name: profile.name.trim(),
        desc: profile.desc.trim(),
        scheduleMode: profile.scheduleMode,
      });
      setProfile(value => ({
        ...value,
        name: value.name.trim(),
        desc: value.desc.trim(),
      }));
      setStatus('saved');
      setMessage(t.home.mindAssistant.savedChanges);
      if (savedPath) router.refresh();
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : t.home.mindAssistant.saveChangesFailed);
    } finally {
      setSaving(false);
    }
  };

  const resetAssistantEdits = () => {
    setPromptContent(originalContent);
    setProfile(originalProfile);
    setStatus('idle');
    setMessage('');
  };

  return (
    <Dialog open={Boolean(assistant)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-[980px]">
        {assistant && (
          <div data-mind-system-assistant-dialog={assistant.id} className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b border-border/70 bg-card/75 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3 pr-10 sm:items-center">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-base font-semibold ${displayAvatar?.className ?? assistant.avatar.className}`}
                  aria-hidden="true"
                >
                  {displayAvatar?.text ?? assistant.avatar.text}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <DialogTitle className="truncate text-lg leading-6">{displayName}</DialogTitle>
                    <span className={`inline-flex rounded-md px-1.5 py-px text-[10px] font-medium ${statusClassName}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <DialogDescription className="mt-1 line-clamp-2 max-w-[68ch]">{displayDesc}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[320px_minmax(0,1fr)] md:overflow-hidden">
              <aside className="border-b border-border/70 bg-muted/10 p-4 md:border-b-0 md:border-r md:overflow-y-auto">
                <div className="rounded-lg border border-border/65 bg-background/55 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-foreground">{t.home.mindAssistant.profileFile}</div>
                    <span className={`inline-flex rounded-md px-1.5 py-px text-[10px] font-medium ${profileHasChanges ? 'bg-[var(--amber)]/10 text-[var(--amber)]' : 'bg-muted text-muted-foreground'}`}>
                      {profileHasChanges ? t.home.mindAssistant.unsavedChanges : t.home.mindAssistant.savedState}
                    </span>
                  </div>

                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">{t.home.mindAssistant.assistantName}</span>
                    <input
                      data-mind-system-assistant-name-editor={assistant.id}
                      value={profile.name}
                      onChange={(event) => {
                        setProfile(value => ({ ...value, name: event.target.value }));
                        if (status === 'saved' || status === 'error') {
                          setStatus('idle');
                          setMessage('');
                        }
                      }}
                      disabled={loading || saving}
                      className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  <div className="mt-3 grid gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">{t.home.mindAssistant.schedule}</span>
                    <div
                      data-mind-system-assistant-schedule-editor={assistant.id}
                      className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-1"
                    >
                      {ASSISTANT_SCHEDULE_MODE_OPTIONS.map(mode => (
                        <button
                          key={mode}
                          type="button"
                          data-mind-system-assistant-schedule-option={`${assistant.id}-${mode}`}
                          aria-pressed={profile.scheduleMode === mode}
                          disabled={loading || saving}
                          onClick={() => {
                            setProfile(value => ({ ...value, scheduleMode: mode }));
                            if (status === 'saved' || status === 'error') {
                              setStatus('idle');
                              setMessage('');
                            }
                          }}
                          className={`h-8 rounded text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${profile.scheduleMode === mode ? 'bg-[var(--amber)] text-[var(--amber-foreground)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                        >
                          {t.home.mindAssistant.scheduleMode[mode]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="mt-3 grid gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">{t.home.mindAssistant.assistantDescription}</span>
                    <textarea
                      data-mind-system-assistant-desc-editor={assistant.id}
                      value={profile.desc}
                      onChange={(event) => {
                        setProfile(value => ({ ...value, desc: event.target.value }));
                        if (status === 'saved' || status === 'error') {
                          setStatus('idle');
                          setMessage('');
                        }
                      }}
                      disabled={loading || saving}
                      className="min-h-24 resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                </div>
              </aside>

              <div className="flex min-h-0 flex-col bg-background/35">
                <div className="flex flex-col gap-2 border-b border-border/70 bg-background/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <ScrollText size={13} className="text-[var(--amber)]/75" aria-hidden="true" />
                      {t.home.mindAssistant.promptEditor}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-md bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                      {promptCharacterCount}
                    </span>
                    <span className={`rounded-md px-1.5 py-px text-[10px] font-medium ${statusClassName}`}>
                      {statusLabel}
                    </span>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:overflow-y-auto">
                  <label className="grid min-h-0 flex-1 gap-2">
                    <span className="sr-only">{t.home.mindAssistant.promptEditor}</span>
                    <textarea
                      data-mind-system-assistant-prompt-editor={assistant.id}
                      value={promptContent}
                      onChange={(event) => {
                        setPromptContent(event.target.value);
                        if (status === 'saved' || status === 'error') {
                          setStatus('idle');
                          setMessage('');
                        }
                      }}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSave) {
                          event.preventDefault();
                          void saveAssistant();
                        }
                      }}
                      disabled={loading || saving}
                      className="h-[320px] w-full resize-y rounded-lg border border-border bg-background/90 px-3.5 py-3 font-mono text-xs leading-5 text-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 md:h-[min(48vh,560px)] md:min-h-[380px]"
                      placeholder={loading ? t.home.mindAssistant.loadingPrompt : t.home.mindAssistant.promptEditor}
                    />
                  </label>

                  {(message || (!loading && promptContent.trim().length === 0)) && (
                    <div
                      data-mind-system-assistant-prompt-status={status}
                      className={`rounded-md px-3 py-2 text-[11px] leading-4 ${statusClassName}`}
                    >
                      {!loading && promptContent.trim().length === 0 ? t.home.mindAssistant.promptEmpty : message}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="z-10 mx-0 mb-0 shrink-0 flex-row justify-end rounded-none border-t border-border/70 bg-card/95 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.home.mindAssistant.close}
              </button>
              <button
                type="button"
                data-mind-system-assistant-reset={assistant.id}
                data-mind-system-assistant-reset-prompt={assistant.id}
                onClick={resetAssistantEdits}
                disabled={!hasChanges || loading || saving}
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
              >
                {t.home.mindAssistant.resetChanges}
              </button>
              <button
                type="button"
                data-mind-system-assistant-save={assistant.id}
                data-mind-system-assistant-save-prompt={assistant.id}
                onClick={saveAssistant}
                disabled={!canSave}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--amber)] px-4 text-xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
              >
                {saving && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                {saving ? t.home.mindAssistant.savingChanges : t.home.mindAssistant.saveChanges}
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildDefaultPromptDraft(assistant: Pick<MindSystemAssistantViewModel, 'name' | 'desc'>, spaceTitle: string, spacePath: string): string {
  return `# ${assistant.name}

## Role

${assistant.desc}

## Inputs

- Notes and context from ${spacePath}
- The space instruction for ${spaceTitle}

## Output

Write one focused Markdown draft for user review.

## Boundaries

- Do not overwrite canonical notes unless explicitly asked.
- Keep uncertainty and source assumptions visible.
`;
}

// ─── Context Menu for DirView entries ─────────────────────────────────────────

function DirContextMenu({ x, y, path, label, onClose }: {
  x: number; y: number; path: string; label: string; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  // Keep within viewport
  const adjX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 200) : x;
  const adjY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 60) : y;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjY, left: adjX }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
        onClick={() => { copyPathToClipboard(path); onClose(); }}
      >
        <Copy size={14} className="shrink-0" /> {t.fileTree.copyPath}
      </button>
    </div>
  );
}

// ─── DirView ──────────────────────────────────────────────────────────────────

export default function DirView({ dirPath, entries, spacePreview, mindSystemSpace }: DirViewProps) {
  const [view, setView] = useDirViewPref();
  const showHidden = useShowHiddenFiles();
  const { t } = useLocale();
  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const handleCtx = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const visibleEntries = useMemo(() => {
    return showHidden ? entries : entries.filter(e => e.type !== 'file' || !SYSTEM_FILES.has(e.name));
  }, [entries, showHidden]);

  const fileCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of visibleEntries) map.set(e.path, countFiles(e));
    return map;
  }, [visibleEntries]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Topbar */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 h-[46px] flex items-center bg-background">
        <div className="w-full flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Breadcrumb filePath={dirPath} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/view/${encodePath(dirPath ? `${dirPath}/Untitled.md` : 'Untitled.md')}`}
              className="hit-target-box flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors text-muted-foreground hover:text-foreground [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-lg)]"
            >
              <FilePlus size={13} />
              <span className="hidden sm:inline">{t.dirView.newFile}</span>
            </Link>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setView('grid')}
                data-hit-active={view === 'grid' ? 'true' : undefined}
                className={`hit-target-box inline-flex h-8 w-8 items-center justify-center transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-active-bg:var(--card)] [--hit-target-hover-bg:var(--card)] [--hit-target-radius:var(--radius-sm)] [--hit-target-active-shadow:0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)] ${view === 'grid' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title={t.dirView.gridView}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setView('list')}
                data-hit-active={view === 'list' ? 'true' : undefined}
                className={`hit-target-box inline-flex h-8 w-8 items-center justify-center transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-active-bg:var(--card)] [--hit-target-hover-bg:var(--card)] [--hit-target-radius:var(--radius-sm)] [--hit-target-active-shadow:0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)] ${view === 'list' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title={t.dirView.listView}
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 md:px-6 py-6">
        <div className="max-w-[860px] mx-auto">
          {mindSystemSpace && (
            <MindSystemSpacePanel space={mindSystemSpace} spacePreview={spacePreview} />
          )}

          {/* Space preview cards for ordinary spaces. Built-in Mind System spaces expose these from the header. */}
          {spacePreview && !mindSystemSpace && (
            <SpacePreviewSection preview={spacePreview} dirPath={dirPath} />
          )}

          {visibleEntries.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.dirView.emptyFolder}</p>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {visibleEntries.map(entry => (
                <Link
                  key={entry.path}
                  href={`/view/${encodePath(entry.path)}`}
                  onContextMenu={(e) => handleCtx(e, entry.path)}
                  className={
                    entry.type === 'directory'
                      ? 'flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
                      : 'flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
                  }
                >
                  {entry.type === 'directory'
                    ? <FolderOpen size={22} className="text-yellow-400" />
                    : <FileIconLarge node={entry} />}
                  <span className="text-xs text-foreground leading-snug line-clamp-2 w-full" title={entry.name} suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' && (
                    <span className="text-2xs text-muted-foreground">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  )}
                  {entry.type === 'file' && entry.mtime && (
                    <span className="text-2xs text-muted-foreground" suppressHydrationWarning>
                      {formatTime(entry.mtime)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
              {visibleEntries.map(entry => (
                <Link
                  key={entry.path}
                  href={`/view/${encodePath(entry.path)}`}
                  onContextMenu={(e) => handleCtx(e, entry.path)}
                  className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent transition-colors duration-100"
                >
                  <FileIcon node={entry} />
                  <span className="flex-1 text-sm text-foreground truncate" title={entry.name} suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' ? (
                    <span className="text-xs text-muted-foreground shrink-0">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  ) : entry.mtime ? (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums" suppressHydrationWarning>
                      {formatTime(entry.mtime)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <DirContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          path={ctxMenu.path}
          label={t.fileTree.copyPath}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
