'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check, X, Loader2, Sparkles, AlertCircle, Undo2,
  ChevronDown, FilePlus, FileEdit, ExternalLink,
} from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { useAiOrganize } from '@/hooks/useAiOrganize';
import type { OrganizeStageHint } from '@/hooks/useAiOrganize';
import { encodePath } from '@/lib/utils';
import {
  appendEntry, updateEntry, generateEntryId,
  type OrganizeHistoryEntry,
} from '@/lib/organize-history';

const AUTO_DISMISS_MS = 3 * 60 * 1000; // 3 minutes
const THINKING_TIMEOUT_MS = 5000;

type AiOrganize = ReturnType<typeof useAiOrganize>;

function stageText(
  t: ReturnType<typeof useLocale>['t'],
  hint: { stage: OrganizeStageHint; detail?: string } | null,
): string {
  const fi = t.fileImport as Record<string, unknown>;
  if (!hint) return fi.organizeProcessing as string;
  switch (hint.stage) {
    case 'connecting': return fi.organizeConnecting as string;
    case 'analyzing': return fi.organizeAnalyzing as string;
    case 'reading': return (fi.organizeReading as (d?: string) => string)(hint.detail);
    case 'thinking': return fi.organizeThinking as string;
    case 'writing': return (fi.organizeWriting as (d?: string) => string)(hint.detail);
    default: return fi.organizeProcessing as string;
  }
}

/** Self-contained timer for organizing phase */
function useOrganizeTimer(isOrganizing: boolean, stageHint: AiOrganize['stageHint']) {
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

  return {
    elapsed,
    displayHint: thinkingOverride ? { stage: 'thinking' as const } : stageHint,
  };
}

interface OrganizeToastProps {
  aiOrganize: AiOrganize;
  onDismiss: () => void;
  /** Called when AI organize flow should be cancelled entirely */
  onCancel: () => void;
  /** Callback to notify history panel of updates */
  onHistoryUpdate?: () => void;
}

export default function OrganizeToast({
  aiOrganize, onDismiss, onCancel, onHistoryUpdate,
}: OrganizeToastProps) {
  const { t } = useLocale();
  const router = useRouter();
  const fi = t.fileImport as Record<string, unknown>;

  const isOrganizing = aiOrganize.phase === 'organizing';
  const { elapsed, displayHint } = useOrganizeTimer(isOrganizing, aiOrganize.stageHint);

  const [expanded, setExpanded] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyIdRef = useRef<string | null>(null);

  const isDone = aiOrganize.phase === 'done';
  const isError = aiOrganize.phase === 'error';
  const isActive = isOrganizing || isDone || isError;

  const okCount = aiOrganize.changes.filter(c => c.ok && !c.undone).length;

  // Reset historyId when a new organize session starts
  useEffect(() => {
    if (isOrganizing) {
      historyIdRef.current = null;
    }
  }, [isOrganizing]);

  // Write to history when organize completes
  useEffect(() => {
    if (isDone && !historyIdRef.current) {
      const id = generateEntryId();
      historyIdRef.current = id;
      appendEntry({
        id,
        timestamp: Date.now(),
        sourceFiles: aiOrganize.sourceFileNames,
        files: aiOrganize.changes.map(c => ({
          action: c.action,
          path: c.path,
          ok: c.ok,
          undone: c.undone,
        })),
        status: 'completed',
      });
      onHistoryUpdate?.();
    }
  }, [isDone, aiOrganize.changes, aiOrganize.sourceFileNames, onHistoryUpdate]);

  // Auto-dismiss timer (3 min after done, reset on user interaction)
  const resetTimer = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (isDone || isError) {
      dismissTimerRef.current = setTimeout(() => {
        onDismiss();
      }, AUTO_DISMISS_MS);
    }
  }, [isDone, isError, onDismiss]);

  useEffect(() => {
    resetTimer();
    return () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current); };
  }, [resetTimer]);

  const handleUserAction = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  const handleUndoOne = useCallback(async (path: string) => {
    handleUserAction();
    setUndoing(true);
    const ok = await aiOrganize.undoOne(path);
    setUndoing(false);
    if (ok) {
      window.dispatchEvent(new Event('mindos:files-changed'));
      // History sync deferred to next render when aiOrganize.changes is updated
      setTimeout(() => {
        if (historyIdRef.current) {
          const updated = aiOrganize.changes.map(c => ({
            action: c.action, path: c.path, ok: c.ok,
            undone: c.path === path ? true : c.undone,
          }));
          const allUndone = updated.every(c => !c.ok || c.undone);
          updateEntry(historyIdRef.current, {
            files: updated,
            status: allUndone ? 'undone' : 'partial',
          });
          onHistoryUpdate?.();
        }
      }, 0);
    }
  }, [aiOrganize, handleUserAction, onHistoryUpdate]);

  const handleUndoAll = useCallback(async () => {
    handleUserAction();
    setUndoing(true);
    const reverted = await aiOrganize.undoAll();
    setUndoing(false);
    if (reverted > 0) {
      window.dispatchEvent(new Event('mindos:files-changed'));
      if (historyIdRef.current) {
        updateEntry(historyIdRef.current, {
          files: aiOrganize.changes.map(c => ({
            action: c.action, path: c.path, ok: c.ok,
            undone: c.ok ? true : c.undone,
          })),
          status: 'undone',
        });
        onHistoryUpdate?.();
      }
    }
  }, [aiOrganize, handleUserAction, onHistoryUpdate]);

  const handleViewFile = useCallback((path: string) => {
    handleUserAction();
    router.push(`/view/${encodePath(path)}`);
  }, [router, handleUserAction]);

  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  if (!isActive) return null;

  // Expanded panel (file list with per-file undo)
  if (expanded && (isDone || isError)) {
    return (
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[420px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
        onClick={handleUserAction}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {isDone ? <Check size={14} className="text-success" /> : <AlertCircle size={14} className="text-error" />}
            <span className="text-xs font-medium text-foreground">
              {isDone ? fi.organizeReviewTitle as string : fi.organizeErrorTitle as string}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        {/* File list */}
        {isDone && (
          <div className="max-h-[240px] overflow-y-auto p-2 space-y-0.5">
            {aiOrganize.changes.map((c, idx) => {
              const wasUndone = c.undone;
              const undoable = aiOrganize.canUndo(c.path);
              const fileName = c.path.split('/').pop() ?? c.path;

              return (
                <div
                  key={`${c.path}-${idx}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${wasUndone ? 'bg-muted/30 opacity-50' : 'bg-muted/50'}`}
                >
                  {wasUndone ? (
                    <Undo2 size={14} className="text-muted-foreground shrink-0" />
                  ) : c.action === 'create' ? (
                    <FilePlus size={14} className="text-success shrink-0" />
                  ) : (
                    <FileEdit size={14} className="text-[var(--amber)] shrink-0" />
                  )}
                  <span className={`truncate flex-1 ${wasUndone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {fileName}
                  </span>
                  {wasUndone ? (
                    <span className="text-xs text-muted-foreground shrink-0">{fi.organizeUndone as string}</span>
                  ) : (
                    <span className={`text-xs shrink-0 ${c.ok ? 'text-muted-foreground' : 'text-error'}`}>
                      {!c.ok ? fi.organizeFailed as string
                        : c.action === 'create' ? fi.organizeCreated as string
                        : fi.organizeUpdated as string}
                    </span>
                  )}
                  {undoable && (
                    <button
                      type="button"
                      onClick={() => handleUndoOne(c.path)}
                      disabled={undoing}
                      className="text-2xs text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 px-1 disabled:opacity-40"
                      title={fi.organizeUndoOne as string}
                    >
                      <Undo2 size={12} />
                    </button>
                  )}
                  {c.ok && !c.undone && (
                    <button
                      type="button"
                      onClick={() => handleViewFile(c.path)}
                      className="text-2xs text-muted-foreground/60 hover:text-[var(--amber)] transition-colors shrink-0 px-1"
                      title={fi.organizeViewFile as string}
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isError && (
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{aiOrganize.error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border">
          {isDone && aiOrganize.hasAnyUndoable && (
            <button
              onClick={handleUndoAll}
              disabled={undoing}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 disabled:opacity-50"
            >
              {undoing ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
              {fi.organizeUndoAll as string}
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all"
          >
            <Check size={12} />
            {fi.organizeDone as string}
          </button>
        </div>
      </div>
    );
  }

  // Compact toast bar
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border rounded-xl shadow-lg px-4 py-3 max-w-md animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      onClick={handleUserAction}
    >
      {isDone ? (
        <>
          <Check size={16} className="text-success shrink-0" />
          <span className="text-xs text-foreground truncate">
            {(fi.organizeReviewDesc as (n: number) => string)(okCount)}
          </span>
          {aiOrganize.changes.length > 0 && (
            <button
              type="button"
              onClick={() => { setExpanded(true); handleUserAction(); }}
              className="flex items-center gap-1 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-colors shrink-0"
            >
              <ChevronDown size={12} className="rotate-180" />
              {fi.organizeExpand as string}
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="flex items-center gap-1 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-colors shrink-0"
          >
            <Check size={12} />
            {fi.organizeDone as string}
          </button>
        </>
      ) : isError ? (
        <>
          <AlertCircle size={16} className="text-error shrink-0" />
          <span className="text-xs text-foreground truncate">{fi.organizeError as string}</span>
          <button
            type="button"
            onClick={() => { setExpanded(true); handleUserAction(); }}
            className="text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-colors shrink-0"
          >
            {fi.organizeExpand as string}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          <div className="relative shrink-0">
            <Sparkles size={16} className="text-[var(--amber)]" />
            <Loader2 size={10} className="absolute -bottom-0.5 -right-0.5 text-[var(--amber)] animate-spin" />
          </div>
          <span className="text-xs text-foreground truncate">
            {stageText(t, displayHint)}
          </span>
          <span className="text-xs text-muted-foreground/60 tabular-nums shrink-0">
            {(fi.organizeElapsed as (s: number) => string)(elapsed)}
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}
