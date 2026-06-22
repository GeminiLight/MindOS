'use client';

import { type ComponentType, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import type { EchoAssistantId } from '@/lib/echo-assistants';
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
  assistantId,
  userPrompt,
  generateSignal = 0,
  maxSteps = 12,
}: {
  noAiHint: string;
  generatingLabel: string;
  errorPrefix: string;
  retryLabel: string;
  assistantId: EchoAssistantId;
  userPrompt: string;
  generateSignal?: number;
  maxSteps?: number;
}) {
  const [requested, setRequested] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [insightMd, setInsightMd] = useState('');
  const [err, setErr] = useState('');
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

  const runGenerate = useCallback(async () => {
    setRequested(true);
    if (aiLoading || !aiReady || streaming) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErr('');
    setInsightMd('');
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

      await consumeUIMessageStream(
        res.body,
        (msg) => {
          setInsightMd(msg.content ?? '');
        },
        ctrl.signal,
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [aiLoading, aiReady, assistantId, maxSteps, streaming, userPrompt]);

  useEffect(() => {
    if (generateSignal === lastGenerateSignalRef.current) return;
    lastGenerateSignalRef.current = generateSignal;
    void runGenerate();
  }, [generateSignal, runGenerate]);

  if (!requested && !streaming && !insightMd && !err) {
    return null;
  }

  return (
    <section
      id={panelId}
      aria-live="polite"
      className="mt-6 rounded-xl border border-border/55 bg-card/45 p-5 shadow-sm"
    >
      {streaming && !insightMd ? (
        <p className="flex items-center gap-2 font-sans text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin shrink-0" aria-hidden />
          {generatingLabel}
        </p>
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
      {insightMd ? (
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
      ) : null}
    </section>
  );
}
