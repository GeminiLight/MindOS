'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import { useSettingsAiAvailable } from '@/hooks/useSettingsAiAvailable';
import { useLocale } from '@/lib/stores/locale-store';

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
  title,
  showLabel,
  hideLabel,
  hint,
  generateLabel,
  noAiHint,
  generatingLabel,
  errorPrefix,
  retryLabel,
  userPrompt,
}: {
  title: string;
  showLabel: string;
  hideLabel: string;
  hint: string;
  generateLabel: string;
  noAiHint: string;
  generatingLabel: string;
  errorPrefix: string;
  retryLabel: string;
  userPrompt: string;
}) {
  const [open, setOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [insightMd, setInsightMd] = useState('');
  const [err, setErr] = useState('');
  const panelId = useId();
  const btnId = `${panelId}-btn`;
  const abortRef = useRef<AbortController | null>(null);
  const { ready: aiReady, loading: aiLoading } = useSettingsAiAvailable();
  const { t } = useLocale();

  useEffect(() => () => abortRef.current?.abort(), []);

  const runGenerate = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErr('');
    setInsightMd('');
    setStreaming(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: userPrompt }],
          maxSteps: 16,
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
  }, [userPrompt]);

  const generateDisabled = aiLoading || !aiReady || streaming;

  return (
    <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--amber)]/25 hover:shadow">
      <button
        id={btnId}
        type="button"
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-dim)] text-[var(--amber)]"
          aria-hidden
        >
          <Sparkles size={16} strokeWidth={1.75} />
        </span>
        <span className="flex-1 font-sans text-sm font-medium text-foreground">{title}</span>
        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        <span className="sr-only">{open ? hideLabel : showLabel}</span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={btnId}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden" {...(!open && { inert: true } as React.HTMLAttributes<HTMLDivElement>)}>
          <div className="border-t border-border/60 px-5 pb-5 pt-4">
            <p className="font-sans text-sm leading-relaxed text-muted-foreground">{hint}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={generateDisabled}
                title={generateDisabled ? t.hints.aiNotConfigured : undefined}
                onClick={runGenerate}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--amber)] px-3 py-2 font-sans text-sm font-medium text-[var(--amber-foreground)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {streaming ? (
                  <Loader2 size={16} className="animate-spin shrink-0" aria-hidden />
                ) : (
                  <Sparkles size={15} className="shrink-0" aria-hidden />
                )}
                {streaming ? generatingLabel : generateLabel}
              </button>
              {err ? (
                <button
                  type="button"
                  onClick={runGenerate}
                  disabled={streaming || !aiReady}
                  title={streaming || !aiReady ? t.hints.generationInProgress : undefined}
                  className="font-sans text-sm text-[var(--amber)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  {retryLabel}
                </button>
              ) : null}
            </div>
            {!aiLoading && !aiReady ? (
              <p className="mt-2 font-sans text-xs text-muted-foreground">{noAiHint}</p>
            ) : null}
            {err ? (
              <p className="mt-3 font-sans text-sm text-error" role="alert">
                {errorPrefix} {err}
              </p>
            ) : null}
            {insightMd ? (
              <div className={cn(proseInsight, 'mt-4 border-t border-border/50 pt-4')}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{insightMd}</ReactMarkdown>
                {streaming ? (
                  <span
                    className="ml-0.5 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-[var(--amber)] align-middle"
                    aria-hidden
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
