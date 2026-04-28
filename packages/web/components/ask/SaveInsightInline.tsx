'use client';

import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import { FolderInput, Check, Loader2, ChevronRight, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { generateInsightPath, cleanInsightContent, formatInsightMarkdown } from './save-insight-utils';

type SaveMode = 'create' | 'append';
type SaveState = 'idle' | 'open' | 'saving' | 'saved' | 'error';

interface SaveInsightCtx {
  state: SaveState;
  open: () => void;
}

const SaveInsightContext = createContext<SaveInsightCtx | null>(null);

/**
 * Provider that wraps a single assistant message, managing save state.
 * Renders the trigger button via <SaveInsightTrigger> and the
 * expanded form via <SaveInsightForm>.
 */
export function SaveInsightProvider({ text, children }: { text: string; children: React.ReactNode }) {
  const [state, setState] = useState<SaveState>('idle');
  const cleaned = cleanInsightContent(text);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    setState('open');
  }, []);

  const reset = useCallback(() => {
    setState('idle');
  }, []);

  const setStateWrapped = useCallback((s: SaveState) => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setState(s);
    if (s === 'saved') {
      resetTimerRef.current = setTimeout(() => setState('idle'), 4000);
    }
  }, []);

  useEffect(() => {
    return () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current); };
  }, []);

  if (!cleaned) return <>{children}</>;

  return (
    <SaveInsightContext.Provider value={{ state, open }}>
      {children}
      {(state === 'open' || state === 'saving' || state === 'error') && (
        <SaveInsightForm cleaned={cleaned} setState={setStateWrapped} onCancel={reset} />
      )}
    </SaveInsightContext.Provider>
  );
}

/** Small trigger button that sits in the action bar alongside Copy. */
export function SaveInsightTrigger({ text }: { text: string }) {
  const { t } = useLocale();
  const labels = t.ask;
  const ctx = useContext(SaveInsightContext);
  const cleaned = cleanInsightContent(text);
  if (!cleaned || !ctx) return null;

  if (ctx.state === 'saved') {
    return (
      <button
        type="button"
        disabled
        className="p-1 rounded-md bg-card border border-success/40 shadow-sm text-success transition-all"
        title="Saved"
      >
        <Check size={11} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={ctx.open}
      className="p-1 rounded-md bg-card border border-border/60 shadow-sm text-muted-foreground hover:text-[var(--amber)] hover:border-[var(--amber)]/30 transition-all"
      title={(labels as Record<string, unknown>).saveToKB as string ?? 'Save to knowledge base'}
    >
      <FolderInput size={11} />
    </button>
  );
}

/** Expanded inline form that appears below message content. */
function SaveInsightForm({
  cleaned,
  setState,
  onCancel,
}: {
  cleaned: string;
  setState: (s: SaveState) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const labels = t.ask;
  const [radioId] = useState(() => `save-mode-${Math.random().toString(36).slice(2, 6)}`);
  const [path, setPath] = useState(() => generateInsightPath(cleaned));
  const [mode, setMode] = useState<SaveMode>('create');
  const [showPreview, setShowPreview] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, []);

  const handleCancel = useCallback(() => {
    onCancel();
    setErrorMsg('');
  }, [onCancel]);

  const handleSave = useCallback(async () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;

    const safePath = trimmedPath.endsWith('.md') ? trimmedPath : `${trimmedPath}.md`;
    setSaving(true);
    setErrorMsg('');
    setState('saving');

    try {
      const content = mode === 'create'
        ? formatInsightMarkdown(cleaned)
        : `\n\n---\n\n${formatInsightMarkdown(cleaned)}`;

      await apiFetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: safePath,
          op: mode === 'create' ? 'create_file' : 'append_to_file',
          content,
          source: 'user',
        }),
      });

      setState('saved');
      const displayName = safePath.split('/').pop() ?? safePath;
      toast.success(
        (labels as Record<string, unknown>).savedToKB
          ? String((labels as Record<string, unknown>).savedToKB).replace('{path}', displayName)
          : `Saved to ${displayName}`,
        3000,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';

      if (msg.toLowerCase().includes('exists') && mode === 'create') {
        setMode('append');
        setErrorMsg(
          (labels as Record<string, unknown>).fileExistsSwitch as string
          ?? 'File exists — switched to append mode',
        );
        setState('open');
        setSaving(false);
        return;
      }

      setErrorMsg(msg);
      setState('error');
      setSaving(false);
    }
  }, [path, mode, cleaned, labels, setState]);

  const previewText = cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;

  return (
    <div ref={containerRef} className="mt-2 pt-2 border-t border-border/20 animate-[fadeSlideUp_0.18s_ease_both]">
      <div className="text-xs font-medium text-foreground/80 mb-2 flex items-center gap-1.5">
        <FolderInput size={12} className="text-[var(--amber)]" />
        {(labels as Record<string, unknown>).saveToKBTitle as string ?? 'Save to Knowledge Base'}
      </div>

      {/* Path input */}
      <input
        ref={inputRef}
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
          if (e.key === 'Escape') handleCancel();
        }}
        placeholder="Inbox/my-note.md"
        disabled={saving}
        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border/50 bg-background text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 transition-colors"
      />

      {/* Mode toggle */}
      <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={radioId}
            checked={mode === 'create'}
            onChange={() => setMode('create')}
            disabled={saving}
            className="accent-[var(--amber)] w-3 h-3"
          />
          {(labels as Record<string, unknown>).saveNew as string ?? 'New file'}
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={radioId}
            checked={mode === 'append'}
            onChange={() => setMode('append')}
            disabled={saving}
            className="accent-[var(--amber)] w-3 h-3"
          />
          {(labels as Record<string, unknown>).saveAppend as string ?? 'Append'}
        </label>
      </div>

      {/* Preview toggle */}
      <button
        type="button"
        onClick={() => setShowPreview(!showPreview)}
        className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight size={10} className={`transition-transform ${showPreview ? 'rotate-90' : ''}`} />
        {(labels as Record<string, unknown>).previewContent as string ?? 'Preview content'}
      </button>
      {showPreview && (
        <pre className="mt-1 p-2 text-[10px] leading-relaxed rounded-md bg-muted/40 border border-border/20 text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono">
          {previewText}
        </pre>
      )}

      {/* Error message */}
      {errorMsg && (
        <div className="flex items-start gap-1.5 mt-2 text-[11px] text-error">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 mt-2.5">
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="px-2.5 py-1 text-[11px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          {(labels as Record<string, unknown>).cancelSave as string ?? 'Cancel'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !path.trim()}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 size={10} className="animate-spin" />
              {(labels as Record<string, unknown>).saving as string ?? 'Saving...'}
            </>
          ) : (
            <>
              <FolderInput size={10} />
              {(labels as Record<string, unknown>).confirmSave as string ?? 'Save'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
