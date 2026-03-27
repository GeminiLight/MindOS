'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, FolderInput, FolderOpen, Sparkles, FileText, AlertCircle,
  AlertTriangle, Loader2, Check, FilePlus, FileEdit, Undo2, ChevronDown,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocale } from '@/lib/LocaleContext';
import { useFileImport, type ImportIntent, type ConflictMode } from '@/hooks/useFileImport';
import { useAiOrganize, stripThinkingTags } from '@/hooks/useAiOrganize';
import type { OrganizeStageHint } from '@/hooks/useAiOrganize';
import { ALLOWED_IMPORT_EXTENSIONS } from '@/lib/core/file-convert';
import type { LocalAttachment } from '@/lib/types';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  defaultSpace?: string;
  initialFiles?: File[];
}

const ACCEPT = Array.from(ALLOWED_IMPORT_EXTENSIONS).join(',');

const THINKING_TIMEOUT_MS = 5000;

function stageHintText(
  t: { fileImport: Record<string, unknown> },
  hint: { stage: OrganizeStageHint; detail?: string } | null,
): string {
  const fi = t.fileImport as {
    organizeConnecting: string;
    organizeAnalyzing: string;
    organizeReading: (d?: string) => string;
    organizeThinking: string;
    organizeWriting: (d?: string) => string;
    organizeProcessing: string;
  };
  if (!hint) return fi.organizeProcessing;
  switch (hint.stage) {
    case 'connecting': return fi.organizeConnecting;
    case 'analyzing': return fi.organizeAnalyzing;
    case 'reading': return fi.organizeReading(hint.detail);
    case 'thinking': return fi.organizeThinking;
    case 'writing': return fi.organizeWriting(hint.detail);
    default: return fi.organizeProcessing;
  }
}

/**
 * Hook: elapsed timer + thinking-override for the organizing phase.
 * Lifted to ImportModal level so both full modal and minimized bar share the same state.
 */
function useOrganizeTimer(isOrganizing: boolean, stageHint: ReturnType<typeof useAiOrganize>['stageHint']) {
  const [elapsed, setElapsed] = useState(0);
  const [thinkingOverride, setThinkingOverride] = useState(false);
  const lastEventRef = useRef(Date.now());

  useEffect(() => {
    lastEventRef.current = Date.now();
    setThinkingOverride(false);
  }, [stageHint]);

  useEffect(() => {
    if (!isOrganizing) { setElapsed(0); setThinkingOverride(false); return; }
    const timer = setInterval(() => {
      setElapsed(e => e + 1);
      if (Date.now() - lastEventRef.current >= THINKING_TIMEOUT_MS) {
        setThinkingOverride(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isOrganizing]);

  const displayHint = thinkingOverride
    ? { stage: 'thinking' as const }
    : stageHint;

  return { elapsed, displayHint };
}

/**
 * Full-size organizing progress view (shown inside the modal).
 */
function OrganizingProgress({
  aiOrganize,
  t,
  elapsed,
  displayHint,
  onMinimize,
  onCancel,
}: {
  aiOrganize: ReturnType<typeof useAiOrganize>;
  t: ReturnType<typeof useLocale>['t'];
  elapsed: number;
  displayHint: { stage: OrganizeStageHint; detail?: string } | null;
  onMinimize: () => void;
  onCancel: () => void;
}) {
  const fi = t.fileImport as { organizeElapsed: (s: number) => string };
  const summaryPreview = aiOrganize.summary ? stripThinkingTags(aiOrganize.summary).trim().slice(0, 200) : '';

  return (
    <div className="mt-4 space-y-3">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Sparkles size={20} className="text-[var(--amber)]" />
          <Loader2 size={12} className="absolute -bottom-0.5 -right-0.5 text-[var(--amber)] animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground font-medium truncate">
            {stageHintText(t, displayHint)}
          </p>
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {fi.organizeElapsed(elapsed)}
          </span>
        </div>
      </div>

      {/* Live activity feed */}
      <div className="bg-muted/30 rounded-lg border border-border/50 overflow-hidden">
        <div className="max-h-[180px] overflow-y-auto p-3 space-y-2">
          {/* Streaming AI text */}
          {summaryPreview && (
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {summaryPreview}
              {summaryPreview.length >= 200 ? '...' : ''}
            </p>
          )}

          {/* Current tool being executed */}
          {aiOrganize.currentTool && (
            <div className="flex items-center gap-2 text-xs text-[var(--amber)] animate-pulse">
              <Loader2 size={11} className="animate-spin shrink-0" />
              <span className="truncate">
                {aiOrganize.currentTool.name.startsWith('create')
                  ? (t.fileImport as { organizeCreating: (p: string) => string }).organizeCreating(aiOrganize.currentTool.path)
                  : (t.fileImport as { organizeUpdating: (p: string) => string }).organizeUpdating(aiOrganize.currentTool.path)}
              </span>
            </div>
          )}

          {/* Completed file operations */}
          {aiOrganize.changes.map((c, idx) => (
            <div key={`${c.path}-${idx}`} className="flex items-center gap-2 text-xs">
              {c.action === 'create' ? (
                <FilePlus size={12} className="text-success shrink-0" />
              ) : (
                <FileEdit size={12} className="text-[var(--amber)] shrink-0" />
              )}
              <span className="truncate text-foreground/80">{c.path}</span>
              <Check size={11} className="text-success shrink-0 ml-auto" />
            </div>
          ))}

          {/* Empty state — show pulsing dots */}
          {!summaryPreview && !aiOrganize.currentTool && aiOrganize.changes.length === 0 && (
            <div className="flex items-center justify-center gap-1 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]/40 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]/40 animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]/40 animate-pulse [animation-delay:300ms]" />
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onMinimize}
          className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors px-3 py-1.5"
        >
          {(t.fileImport as { organizeMinimize: string }).organizeMinimize}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors px-3 py-1.5"
        >
          {(t.fileImport as { organizeCancel: string }).organizeCancel}
        </button>
      </div>
    </div>
  );
}

const SUMMARY_PROSE = [
  'prose prose-sm prose-panel dark:prose-invert max-w-none text-foreground',
  'prose-p:my-1 prose-p:leading-relaxed',
  'prose-headings:font-semibold prose-headings:my-2 prose-headings:text-[13px]',
  'prose-ul:my-1 prose-li:my-0.5 prose-ol:my-1',
  'prose-code:text-[0.8em] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs',
  'prose-blockquote:border-l-amber-400 prose-blockquote:text-muted-foreground',
  'prose-a:text-amber-500 prose-a:no-underline hover:prose-a:underline',
  'prose-strong:text-foreground prose-strong:font-semibold',
  'prose-table:text-xs prose-th:py-1 prose-td:py-1',
].join(' ');

/**
 * Clean raw AI markdown for plain-text preview (progress view):
 * strip heading markers, excess blank lines, truncate.
 */
function cleanSummaryForDisplay(raw: string): string {
  return stripThinkingTags(raw)
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500);
}

/**
 * Clean raw AI markdown for rendered display:
 * strip thinking tags & excess blank lines, keep markdown formatting.
 */
function cleanSummaryForMarkdown(raw: string): string {
  return stripThinkingTags(raw)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Organize result when no tracked file changes were detected.
 * Two sub-states:
 * 1. AI completed work + provided summary → show summary as primary content
 * 2. No summary → brief "up to date" message
 */
function OrganizeNoChangesView({
  summary,
  toolCallCount,
  t,
  onDone,
}: {
  summary: string;
  toolCallCount: number;
  t: ReturnType<typeof useLocale>['t'];
  onDone: () => void;
}) {
  const fi = t.fileImport as Record<string, unknown>;
  const mdSummary = summary ? cleanSummaryForMarkdown(summary) : '';
  const hasSubstance = !!mdSummary;

  return (
    <div className="flex flex-col gap-3 py-4">
      {hasSubstance ? (
        <>
          <div className="flex items-start gap-2.5">
            <Sparkles size={16} className="text-[var(--amber)] mt-0.5 shrink-0" />
            <div className={SUMMARY_PROSE}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{mdSummary}</ReactMarkdown>
            </div>
          </div>
          {toolCallCount > 0 && (
            <p className="text-xs text-muted-foreground/50 text-center">
              {(fi.organizeToolCallsInfo as ((n: number) => string) | undefined)?.(toolCallCount)}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Sparkles size={24} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {fi.organizeNoChanges as string}
          </p>
        </div>
      )}
      <div className="flex justify-center pt-1">
        <button
          onClick={onDone}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all duration-200"
        >
          {fi.organizeDone as string}
        </button>
      </div>
    </div>
  );
}

export default function ImportModal({ open, onClose, defaultSpace, initialFiles }: ImportModalProps) {
  const { t } = useLocale();
  const im = useFileImport();
  const aiOrganize = useAiOrganize();
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [spaces, setSpaces] = useState<Array<{ name: string; path: string }>>([]);
  const [closing, setClosing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [showConflictOptions, setShowConflictOptions] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    im.reset();
    aiOrganize.reset();
    setUndoing(false);
    setConflictFiles([]);
    setShowConflictOptions(false);
    setMinimized(false);
    if (defaultSpace) im.setTargetSpace(defaultSpace);
    if (initialFiles && initialFiles.length > 0) {
      im.addFiles(initialFiles);
    }
    fetch('/api/file?op=list_spaces')
      .then(r => r.json())
      .then(d => { if (d.spaces) setSpaces(d.spaces); })
      .catch(() => {});
  }, [open, defaultSpace, initialFiles, im]);

  const handleClose = useCallback(() => {
    if (im.step === 'organizing') {
      setMinimized(true);
      return;
    }
    if (im.files.length > 0 && im.step !== 'done' && im.step !== 'organize_review') {
      if (!confirm(t.fileImport.discardMessage(im.files.length))) return;
    }
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); im.reset(); aiOrganize.reset(); setUndoing(false); setConflictFiles([]); setShowConflictOptions(false); setMinimized(false); }, 150);
  }, [im, onClose, t, aiOrganize]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); handleClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, handleClose]);

  const checkConflicts = useCallback(async (fileNames: string[], space: string) => {
    try {
      const names = fileNames.map(encodeURIComponent).join(',');
      const spaceParam = space ? `&space=${encodeURIComponent(space)}` : '';
      const res = await fetch(`/api/file?op=check_conflicts&names=${names}${spaceParam}`);
      if (res.ok) {
        const data = await res.json();
        setConflictFiles(data.conflicts ?? []);
        setShowConflictOptions((data.conflicts ?? []).length > 0);
      }
    } catch { /* best-effort */ }
  }, []);

  const handleIntentSelect = useCallback((intent: ImportIntent) => {
    im.setIntent(intent);
    if (intent === 'archive') {
      im.setStep('archive_config');
      const names = im.validFiles.map(f => f.name);
      checkConflicts(names, im.targetSpace);
    } else {
      const attachments: LocalAttachment[] = im.validFiles.map(f => ({
        name: f.name,
        content: f.content!,
      }));
      const space = im.targetSpace || undefined;
      const prompt = attachments.length === 1
        ? (t.fileImport.digestPromptSingle as (name: string, space?: string) => string)(attachments[0].name, space)
        : (t.fileImport.digestPromptMulti as (n: number, space?: string) => string)(attachments.length, space);
      im.setStep('organizing');
      aiOrganize.start(attachments, prompt);
    }
  }, [im, t, aiOrganize]);

  const handleArchiveSubmit = useCallback(async () => {
    await im.doArchive();
    if (im.result && im.result.created.length > 0) {
      setShowSuccess(true);
      setTimeout(() => {
        setClosing(true);
        setTimeout(() => {
          setClosing(false);
          onClose();
          im.reset();
          setShowSuccess(false);
          window.dispatchEvent(new Event('mindos:files-changed'));
        }, 150);
      }, 600);
    }
  }, [im, onClose]);

  useEffect(() => {
    if (im.step === 'archive_config') {
      const names = im.validFiles.map(f => f.name);
      checkConflicts(names, im.targetSpace);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [im.targetSpace]);

  useEffect(() => {
    if (im.step === 'organizing' && (aiOrganize.phase === 'done' || aiOrganize.phase === 'error')) {
      im.setStep('organize_review');
    }
  }, [im.step, aiOrganize.phase, im]);

  const handleOrganizeDone = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
      im.reset();
      aiOrganize.reset();
      setUndoing(false);
      window.dispatchEvent(new Event('mindos:files-changed'));
    }, 150);
  }, [onClose, im, aiOrganize]);

  const handleOrganizeUndo = useCallback(async () => {
    setUndoing(true);
    const reverted = await aiOrganize.undoAll();
    setUndoing(false);
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
      im.reset();
      aiOrganize.reset();
      if (reverted > 0) {
        window.dispatchEvent(new Event('mindos:files-changed'));
      }
    }, 150);
  }, [onClose, im, aiOrganize]);

  const handleOrganizeRetry = useCallback(() => {
    const attachments: LocalAttachment[] = im.validFiles.map(f => ({
      name: f.name,
      content: f.content!,
    }));
    const space = im.targetSpace || undefined;
    const prompt = attachments.length === 1
      ? (t.fileImport.digestPromptSingle as (name: string, space?: string) => string)(attachments[0].name, space)
      : (t.fileImport.digestPromptMulti as (n: number, space?: string) => string)(attachments.length, space);
    aiOrganize.reset();
    im.setStep('organizing');
    aiOrganize.start(attachments, prompt);
  }, [im, t, aiOrganize]);

  useEffect(() => {
    if (im.step === 'done' && im.result) {
      if (im.result.created.length > 0) {
        setShowSuccess(true);
        const timer = setTimeout(() => {
          setClosing(true);
          setTimeout(() => {
            setClosing(false);
            onClose();
            im.reset();
            setShowSuccess(false);
            window.dispatchEvent(new Event('mindos:files-changed'));
          }, 150);
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [im.step, im.result, onClose, im]);

  const hasFiles = im.files.length > 0;
  const isSelectStep = im.step === 'select';
  const isArchiveConfig = im.step === 'archive_config';
  const isImporting = im.step === 'importing';
  const isOrganizing = im.step === 'organizing';
  const isOrganizeReview = im.step === 'organize_review';

  const { elapsed, displayHint } = useOrganizeTimer(isOrganizing, aiOrganize.stageHint);

  useEffect(() => {
    if (minimized && im.step === 'organize_review') {
      setMinimized(false);
    }
  }, [minimized, im.step]);

  if (!open && !closing) return null;

  const fi = t.fileImport as {
    organizeElapsed: (s: number) => string;
    organizeCancel: string;
    organizeExpand: string;
  };

  if (minimized && isOrganizing) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border rounded-xl shadow-lg px-4 py-3 max-w-sm">
        <div className="relative shrink-0">
          <Sparkles size={16} className="text-[var(--amber)]" />
          <Loader2 size={10} className="absolute -bottom-0.5 -right-0.5 text-[var(--amber)] animate-spin" />
        </div>
        <span className="text-xs text-foreground truncate">
          {stageHintText(t, displayHint)}
        </span>
        <span className="text-xs text-muted-foreground/60 tabular-nums shrink-0">
          {fi.organizeElapsed(elapsed)}
        </span>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-colors shrink-0"
        >
          {fi.organizeExpand}
        </button>
        <button
          type="button"
          onClick={() => { aiOrganize.abort(); aiOrganize.reset(); im.setStep('select'); setMinimized(false); }}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={overlayRef}
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${closing ? 'opacity-0' : 'opacity-100'}`}
        onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
      >
        <div
          className={`w-full max-w-lg max-h-[80vh] flex flex-col bg-card rounded-xl shadow-xl border border-border transition-all duration-200 ${closing ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'}`}
          role="dialog"
          aria-modal="true"
          aria-label={t.fileImport.title}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-2 shrink-0">
            <div>
              {isArchiveConfig && (
                <button
                  onClick={() => im.setStep('select')}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                >
                  {t.fileImport.back}
                </button>
              )}
              <h2 className="text-base font-semibold text-foreground">
                {isOrganizing ? t.fileImport.organizeTitle
                  : isOrganizeReview
                    ? (aiOrganize.phase === 'error' ? t.fileImport.organizeErrorTitle : t.fileImport.organizeReviewTitle)
                  : isArchiveConfig ? t.fileImport.archiveConfigTitle
                  : t.fileImport.title}
              </h2>
              {isSelectStep && (
                <p className="text-xs text-muted-foreground mt-0.5">{t.fileImport.subtitle}</p>
              )}
              {isOrganizeReview && aiOrganize.phase === 'done' && aiOrganize.changes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.fileImport.organizeReviewDesc(aiOrganize.changes.filter(c => c.ok).length)}
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-5 overflow-y-auto min-h-0">
            {/* DropZone */}
            {isSelectStep && (
              <div
                className={`border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer ${
                  hasFiles
                    ? 'border-border py-3 px-4'
                    : 'border-[var(--amber)]/30 hover:border-[var(--amber)]/60 py-8 px-4'
                }`}
                role="button"
                tabIndex={0}
                aria-label={t.fileImport.dropzoneButton}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files.length > 0) im.addFiles(e.dataTransfer.files);
                }}
              >
                {hasFiles ? (
                  <p className="text-xs text-muted-foreground text-center">
                    {t.fileImport.dropzoneCompact}{' '}
                    <span className="text-[var(--amber)] hover:underline">{t.fileImport.dropzoneCompactButton}</span>
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <FolderInput size={28} className="text-[var(--amber)]/40" />
                    <p className="text-sm text-muted-foreground">
                      <span className="hidden md:inline">{t.fileImport.dropzoneText}{' '}</span>
                      <span className="md:hidden">{t.fileImport.dropzoneMobile}</span>
                      <span className="hidden md:inline text-[var(--amber)] hover:underline">{t.fileImport.dropzoneButton}</span>
                    </p>
                    <p className="text-2xs text-muted-foreground/60">{t.fileImport.dropOverlayFormats}</p>
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={ACCEPT}
              onChange={(e) => {
                if (e.target.files) im.addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            {/* File list */}
            {hasFiles && !isOrganizing && !isOrganizeReview && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{t.fileImport.fileCount(im.files.length)}</span>
                  {isSelectStep && (
                    <button
                      onClick={im.clearFiles}
                      className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t.fileImport.clearAll}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                  {im.files.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                        f.error ? 'bg-error/5' : 'bg-muted/50'
                      }`}
                    >
                      {f.loading ? (
                        <Loader2 size={14} className="text-muted-foreground animate-spin shrink-0" />
                      ) : f.error ? (
                        <AlertCircle size={14} className="text-error shrink-0" />
                      ) : (
                        <FileText size={14} className="text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate flex-1 text-foreground">{f.name}</span>
                      {f.error ? (
                        <span className="text-xs text-error shrink-0">
                          {f.error === 'unsupported' ? t.fileImport.unsupported
                            : f.error === 'tooLarge' ? t.fileImport.tooLarge('5MB')
                            : f.error}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {im.formatSize(f.size)}
                        </span>
                      )}
                      {isSelectStep && !isArchiveConfig && (
                        <button
                          onClick={(e) => { e.stopPropagation(); im.removeFile(idx); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label={`${t.fileImport.remove} ${f.name}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Archive config: target path preview */}
                {isArchiveConfig && (
                  <div className="flex flex-col gap-1 mt-2 max-h-[120px] overflow-y-auto">
                    {im.validFiles.map((f, idx) => {
                      const ext = f.name.split('.').pop()?.toLowerCase();
                      const targetExt = (ext === 'txt' || ext === 'html' || ext === 'htm' || ext === 'yaml' || ext === 'yml' || ext === 'xml')
                        ? 'md' : ext;
                      const stem = f.name.replace(/\.[^.]+$/, '');
                      const targetName = `${stem}.${targetExt}`;
                      const targetPath = im.targetSpace ? `${im.targetSpace}/${targetName}` : targetName;
                      const hasConflict = conflictFiles.includes(f.name);
                      return (
                        <div key={`preview-${idx}`} className="flex items-center gap-1.5 text-xs text-muted-foreground px-3">
                          <span className="truncate">{f.name}</span>
                          <span className="text-muted-foreground/50 shrink-0">{t.fileImport.arrowTo}</span>
                          <FolderOpen size={12} className="text-muted-foreground/60 shrink-0" />
                          <span className={`truncate ${hasConflict ? 'text-[var(--amber)]' : ''}`}>{targetPath}</span>
                          {hasConflict && <AlertTriangle size={11} className="text-[var(--amber)] shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Intent cards (Step 1) */}
            {isSelectStep && hasFiles && im.allReady && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => handleIntentSelect('archive')}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg cursor-pointer transition-all duration-150 border-[var(--amber)]/30 bg-card hover:border-[var(--amber)]/60 hover:shadow-sm active:scale-[0.98] text-left"
                  disabled={im.validFiles.length === 0}
                >
                  <FolderInput size={24} className="text-[var(--amber)]" />
                  <span className="text-sm font-medium text-foreground">{t.fileImport.archiveTitle}</span>
                  <span className="text-xs text-muted-foreground text-center">{t.fileImport.archiveDesc}</span>
                </button>
                <button
                  onClick={() => handleIntentSelect('digest')}
                  className="flex flex-col items-center gap-2 p-4 border border-border rounded-lg cursor-pointer transition-all duration-150 bg-card hover:border-[var(--amber)]/50 hover:shadow-sm active:scale-[0.98] text-left"
                  disabled={im.validFiles.length === 0}
                >
                  <Sparkles size={24} className="text-[var(--amber)]" />
                  <span className="text-sm font-medium text-foreground">{t.fileImport.digestTitle}</span>
                  <span className="text-xs text-muted-foreground text-center">{t.fileImport.digestDesc}</span>
                </button>
              </div>
            )}

            {/* Archive config (Step 2a) */}
            {isArchiveConfig && (
              <div className="mt-4 space-y-4">
                {/* Space selector */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">{t.fileImport.targetSpace}</label>
                  <select
                    value={im.targetSpace}
                    onChange={(e) => im.setTargetSpace(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">{t.fileImport.rootDir}</option>
                    {spaces.map(s => (
                      <option key={s.path} value={s.path}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Conflict strategy — progressive disclosure */}
                {conflictFiles.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowConflictOptions(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-colors"
                    >
                      <AlertTriangle size={12} className="shrink-0" />
                      {t.fileImport.conflictsFound(conflictFiles.length)}
                      <ChevronDown size={12} className={`shrink-0 transition-transform duration-200 ${showConflictOptions ? 'rotate-180' : ''}`} />
                    </button>
                    {showConflictOptions && (
                      <div className="flex flex-col gap-1.5 mt-2 pl-0.5">
                        {([
                          { value: 'rename' as ConflictMode, label: t.fileImport.conflictRename },
                          { value: 'skip' as ConflictMode, label: t.fileImport.conflictSkip },
                          { value: 'overwrite' as ConflictMode, label: t.fileImport.conflictOverwrite },
                        ]).map(opt => (
                          <label
                            key={opt.value}
                            className={`flex items-center gap-2 py-0.5 text-xs cursor-pointer ${
                              opt.value === 'overwrite' ? 'text-error' : 'text-foreground'
                            }`}
                          >
                            <input
                              type="radio"
                              name="conflict"
                              value={opt.value}
                              checked={im.conflict === opt.value}
                              onChange={() => im.setConflict(opt.value)}
                              className="accent-[var(--amber)]"
                            />
                            {opt.label}
                            {opt.value === 'overwrite' && (
                              <AlertTriangle size={11} className="text-error shrink-0" />
                            )}
                          </label>
                        ))}
                        {im.conflict === 'overwrite' && (
                          <p className="text-2xs text-error/80 pl-5">{t.fileImport.overwriteWarn}</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={handleClose}
                    className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-1.5"
                  >
                    {t.fileImport.cancel}
                  </button>
                  <button
                    onClick={handleArchiveSubmit}
                    disabled={isImporting || im.validFiles.length === 0}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      showSuccess
                        ? 'bg-success text-success-foreground'
                        : 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90'
                    } disabled:opacity-50`}
                  >
                    {showSuccess ? (
                      <><Check size={14} /> {t.fileImport.importButton(im.validFiles.length)}</>
                    ) : isImporting ? (
                      <><Loader2 size={14} className="animate-spin" /> {t.fileImport.importing}</>
                    ) : !im.allReady ? (
                      t.fileImport.preparing
                    ) : (
                      t.fileImport.importButton(im.validFiles.length)
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* AI Organizing (progress) */}
            {isOrganizing && (
              <OrganizingProgress
                aiOrganize={aiOrganize}
                t={t}
                elapsed={elapsed}
                displayHint={displayHint}
                onMinimize={() => setMinimized(true)}
                onCancel={() => { aiOrganize.abort(); aiOrganize.reset(); im.setStep('select'); }}
              />
            )}

            {/* AI Organize review */}
            {isOrganizeReview && (
              <div className="mt-4 space-y-4">
                {aiOrganize.phase === 'error' ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <AlertCircle size={28} className="text-error" />
                    <p className="text-xs text-muted-foreground text-center max-w-[300px]">{aiOrganize.error}</p>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={handleClose}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
                      >
                        {t.fileImport.cancel}
                      </button>
                      <button
                        onClick={handleOrganizeRetry}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all duration-200"
                      >
                        {t.fileImport.organizeRetry}
                      </button>
                    </div>
                  </div>
                ) : aiOrganize.changes.length === 0 ? (
                  <OrganizeNoChangesView
                    summary={aiOrganize.summary}
                    toolCallCount={aiOrganize.toolCallCount}
                    t={t}
                    onDone={handleOrganizeDone}
                  />
                ) : (
                  <>
                    <div className="max-h-[200px] overflow-y-auto space-y-1">
                      {aiOrganize.changes.map((c, idx) => (
                        <div key={`${c.path}-${idx}`} className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md text-sm">
                          {c.action === 'create' ? (
                            <FilePlus size={14} className="text-success shrink-0" />
                          ) : (
                            <FileEdit size={14} className="text-[var(--amber)] shrink-0" />
                          )}
                          <span className="truncate flex-1 text-foreground">{c.path}</span>
                          <span className={`text-xs shrink-0 ${c.ok ? 'text-muted-foreground' : 'text-error'}`}>
                            {!c.ok ? t.fileImport.organizeFailed
                              : c.action === 'create' ? t.fileImport.organizeCreated
                              : t.fileImport.organizeUpdated}
                          </span>
                        </div>
                      ))}
                    </div>
                    {aiOrganize.summary?.trim() && (
                      <div className={SUMMARY_PROSE}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {cleanSummaryForMarkdown(aiOrganize.summary)}
                        </ReactMarkdown>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      {aiOrganize.changes.some(c => c.action === 'create' && c.ok) && (
                        <button
                          onClick={handleOrganizeUndo}
                          disabled={undoing}
                          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 disabled:opacity-50"
                        >
                          {undoing ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Undo2 size={14} />
                          )}
                          {t.fileImport.organizeUndoAll}
                        </button>
                      )}
                      <button
                        onClick={handleOrganizeDone}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all duration-200"
                      >
                        <Check size={14} />
                        {t.fileImport.organizeDone}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
