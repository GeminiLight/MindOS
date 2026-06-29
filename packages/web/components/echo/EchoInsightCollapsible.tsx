'use client';

import { type ComponentType, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, FileText, Loader2, Save } from 'lucide-react';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import type { EchoAssistantId } from '@/lib/echo-assistants';
import type { EchoSavedItem, EchoStoredSegment } from '@/lib/echo-store';
import { useSettingsAiAvailable } from '@/hooks/useSettingsAiAvailable';
import { useLocale } from '@/lib/stores/locale-store';
import { Button } from '@/components/ui/button';

type InsightMarkdownComponent = ComponentType<{ markdown: string }>;

const proseInsight =
  'prose prose-sm prose-panel dark:prose-invert max-w-none text-foreground ' +
  'prose-p:my-1 prose-p:leading-relaxed ' +
  'prose-headings:font-semibold prose-headings:my-2 prose-headings:text-sm ' +
  'prose-ul:my-1 prose-li:my-0.5 prose-ol:my-1 ' +
  'prose-code:text-[0.8em] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none ' +
  'prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs ' +
  'prose-blockquote:border-l-[var(--amber)] prose-blockquote:text-muted-foreground ' +
  'prose-a:text-[var(--amber)] prose-a:no-underline hover:prose-a:underline ' +
  'prose-strong:text-foreground prose-strong:font-semibold';

export function EchoInsightCollapsible({
  noAiHint,
  generatingLabel,
  errorPrefix,
  retryLabel,
  saveLabel,
  savingLabel,
  savedLabel,
  saveErrorPrefix,
  draftTitle,
  draftIdleLabel,
  draftOutputLabel,
  draftSavedHint,
  segment,
  assistantId,
  userPrompt,
  generateSignal = 0,
  maxSteps = 12,
  onSaved,
}: {
  noAiHint: string;
  generatingLabel: string;
  errorPrefix: string;
  retryLabel: string;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  saveErrorPrefix: string;
  draftTitle: string;
  draftIdleLabel: string;
  draftOutputLabel: string;
  draftSavedHint: string;
  segment: EchoStoredSegment;
  assistantId: EchoAssistantId;
  userPrompt: string;
  generateSignal?: number;
  maxSteps?: number;
  onSaved?: (item: EchoSavedItem) => void;
}) {
  const [requested, setRequested] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [insightMd, setInsightMd] = useState('');
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveErr, setSaveErr] = useState('');
  const panelId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const lastGenerateSignalRef = useRef(generateSignal);
  const { ready: aiReady, loading: aiLoading } = useSettingsAiAvailable();
  const { t } = useLocale();

  // react-markdown (~46KB gz) stays out of the Echo first-screen chunk: the
  // renderer is dynamic-imported only after generated content exists. Until it
  // arrives, the raw insight text renders as a lightweight pre-wrapped fallback.
  const [InsightMarkdown, setInsightMarkdown] = useState<InsightMarkdownComponent | null>(null);
  useEffect(() => {
    if (!insightMd || InsightMarkdown) return;
    let cancelled = false;
    import('./EchoInsightMarkdown')
      .then((mod) => {
        if (!cancelled) setInsightMarkdown(() => mod.default);
      })
      .catch((err) => {
        // Graceful degradation: the raw-text fallback keeps content readable.
        console.error('[EchoInsightCollapsible] Failed to load markdown renderer:', err);
      });
    return () => { cancelled = true; };
  }, [insightMd, InsightMarkdown]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const persistDraft = useCallback(async (markdown: string) => {
    try {
      const res = await fetch('/api/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'draft',
          segment,
          assistantId,
          markdown,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (draftErr) {
      console.warn('[EchoInsightCollapsible] Failed to persist Echo draft:', draftErr);
    }
  }, [assistantId, segment]);

  const runGenerate = useCallback(async () => {
    setRequested(true);
    if (aiLoading || !aiReady || streaming) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErr('');
    setInsightMd('');
    setSaveErr('');
    setSaveState('idle');
    setStreaming(true);
    try {
      const res = await fetch('/api/assistant-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantId,
          messages: [{ role: 'user', content: userPrompt }],
          permissionMode: 'read',
          maxSteps,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: { message?: string }; message?: string };
          msg = j?.error?.message ?? j?.message ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      if (!res.body) throw new Error('No response body');

      const finalMessage = await consumeUIMessageStream(
        res.body,
        (msg) => {
          setInsightMd(msg.content ?? '');
        },
        ctrl.signal,
      );
      const finalMarkdown = finalMessage.content ?? '';
      if (finalMarkdown.trim()) {
        setInsightMd(finalMarkdown);
        await persistDraft(finalMarkdown);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [aiLoading, aiReady, assistantId, maxSteps, persistDraft, streaming, userPrompt]);

  const saveEcho = useCallback(async () => {
    const markdown = insightMd.trim();
    if (!markdown || streaming || saveState === 'saving' || saveState === 'saved') return;

    setSaveState('saving');
    setSaveErr('');
    try {
      const res = await fetch('/api/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'save',
          segment,
          assistantId,
          markdown,
        }),
      });
      const body = await res.json().catch(() => ({})) as { item?: EchoSavedItem; error?: string };
      if (!res.ok || !body.item) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSaveState('saved');
      onSaved?.(body.item);
    } catch (saveError) {
      setSaveState('idle');
      setSaveErr(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }, [assistantId, insightMd, onSaved, saveState, segment, streaming]);

  useEffect(() => {
    if (generateSignal === lastGenerateSignalRef.current) return;
    lastGenerateSignalRef.current = generateSignal;
    void runGenerate();
  }, [generateSignal, runGenerate]);

  const statusLabel = streaming
    ? generatingLabel
    : saveState === 'saved'
      ? savedLabel
      : insightMd
        ? draftOutputLabel
        : requested && !aiLoading && !aiReady
          ? noAiHint
          : draftIdleLabel;

  return (
    <section
      id={panelId}
      aria-live="polite"
      className="flex min-h-[18rem] min-w-0 flex-col rounded-xl border border-border/60 bg-card/45 shadow-sm"
      data-testid="echo-ai-draft-panel"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/45 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground" aria-hidden>
              <FileText size={16} />
            </span>
            <h2 className="font-sans text-base font-medium leading-tight text-foreground">{draftTitle}</h2>
          </div>
          <p className="mt-2 line-clamp-2 font-sans text-xs leading-5 text-muted-foreground">{statusLabel}</p>
        </div>
        {saveState === 'saved' ? (
          <span className="shrink-0 rounded-full border border-[var(--success)]/30 bg-[var(--success)]/10 px-2.5 py-1 font-sans text-xs text-success">
            {draftSavedHint}
          </span>
        ) : insightMd && !streaming ? (
          <span className="shrink-0 rounded-full border border-[var(--amber)]/30 bg-[var(--amber)]/10 px-2.5 py-1 font-sans text-xs text-[var(--amber)]">
            {draftOutputLabel}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 px-5 py-5">
      {streaming && !insightMd ? (
        <div className="space-y-4" role="status" aria-label={generatingLabel}>
          <p className="flex items-center gap-2 font-sans text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin shrink-0" aria-hidden />
            {generatingLabel}
          </p>
          <div className="space-y-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-full bg-muted/55" />
            <div className="h-3.5 w-full rounded-full bg-muted/45" />
            <div className="h-3.5 w-5/6 rounded-full bg-muted/35" />
            <div className="h-20 rounded-lg border border-border/35 bg-background/35" />
          </div>
        </div>
      ) : null}
      {!aiLoading && !aiReady ? (
        <p className="font-sans text-sm text-muted-foreground">{noAiHint}</p>
      ) : null}
      {err ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-sans text-sm text-error" role="alert">
            {errorPrefix} {err}
          </p>
          <Button
            type="button"
            onClick={runGenerate}
            disabled={streaming || !aiReady}
            title={streaming || !aiReady ? t.hints.generationInProgress : undefined}
            variant="ghost"
            size="sm"
            className="w-fit text-[var(--amber)]"
          >
            {retryLabel}
          </Button>
        </div>
      ) : null}
      {!streaming && !insightMd && !err && (aiLoading || aiReady) ? (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border/55 bg-background/35 px-6 text-center">
          <p className="max-w-sm font-sans text-sm leading-6 text-muted-foreground">{draftIdleLabel}</p>
        </div>
      ) : null}
      {insightMd ? (
        <>
          <div className={proseInsight}>
            {InsightMarkdown ? (
              <InsightMarkdown markdown={insightMd} />
            ) : (
              <p className="whitespace-pre-wrap">{insightMd}</p>
            )}
            {streaming ? (
              <span
                className="ml-0.5 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-[var(--amber)] align-middle"
                aria-hidden
              />
            ) : null}
          </div>
          {!streaming ? (
            <div className="mt-5 flex flex-col gap-2 border-t border-border/45 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant={saveState === 'saved' ? 'outline' : 'amber'}
                size="sm"
                onClick={saveEcho}
                disabled={saveState === 'saving' || saveState === 'saved'}
                aria-busy={saveState === 'saving'}
                className="w-fit"
              >
                {saveState === 'saving' ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : saveState === 'saved' ? (
                  <Check size={14} aria-hidden />
                ) : (
                  <Save size={14} aria-hidden />
                )}
                {saveState === 'saving' ? savingLabel : saveState === 'saved' ? savedLabel : saveLabel}
              </Button>
              {saveErr ? (
                <p className="font-sans text-xs text-error" role="alert">
                  {saveErrorPrefix} {saveErr}
                </p>
              ) : saveState === 'saved' ? (
                <p className="font-sans text-xs text-muted-foreground">{draftSavedHint}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      </div>
    </section>
  );
}
