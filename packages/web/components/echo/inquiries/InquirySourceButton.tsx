'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GitFork, Check, CircleAlert } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { inquiryCopy } from './inquiry-copy';
import { INQUIRY_UPDATED } from './inquiry-events';
export default function InquirySourceButton({
  sessionId,
  messageIndex,
  text,
}: {
  sessionId: string;
  messageIndex: number;
  text: string;
}) {
  const { locale } = useLocale();
  const p = inquiryCopy[locale];
  const [saved, setSaved] = useState('');
  const pending = useRef<{ key: string; requestId: string; locale: 'en' | 'zh' } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof p.errors | null>(null);
  useEffect(() => {
    setSaved('');
    setError(null);
    setBusy(false);
    pending.current = null;
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [sessionId, messageIndex, text]);
  async function create() {
    if (controller.current || saved) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text),
      );
      if (abort.signal.aborted || controller.current !== abort) return;
      const messageHash = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const key = JSON.stringify([
        sessionId,
        messageIndex,
        messageHash,
      ]);
      if (pending.current?.key !== key)
        pending.current = { key, requestId: crypto.randomUUID(), locale };
      const response = await fetch('/api/echo/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
        body: JSON.stringify({
          sessionId,
          messageIndex,
          messageHash,
          locale: pending.current.locale,
          requestId: pending.current.requestId,
        }),
      });
      const data = await response.json();
      if (abort.signal.aborted || controller.current !== abort) return;
      if (!response.ok || typeof data.inquiry?.id !== 'string' || !/^inquiry-[a-f0-9]{24}$/.test(data.inquiry.id)) {
        setError(
          Object.hasOwn(p.errors, data.code) ? data.code as keyof typeof p.errors : 'storage',
        );
        return;
      }
      setSaved(data.inquiry.id);
      window.dispatchEvent(new Event(INQUIRY_UPDATED));
    } catch {
      if (!abort.signal.aborted) setError('storage');
    } finally {
      if (controller.current === abort) controller.current = null;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        title={p.capture}
        aria-label={p.capture}
        disabled={busy || !!saved}
        onClick={() => void create()}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {saved ? (
          <Check size={15} aria-hidden />
        ) : (
          <GitFork size={15} aria-hidden />
        )}
      </button>
      {saved ? (
        <Link
          href={'/echo/questions?inquiry=' + saved}
          className="inline-flex min-h-11 items-center rounded text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {locale === 'zh' ? '继续追问' : 'Continue this question'}
        </Link>
      ) : null}
      {error ? (
        <span
          role="alert"
          className="inline-flex max-w-xs items-start gap-1.5 text-xs leading-5 text-foreground"
        >
          <CircleAlert
            size={15}
            className="mt-0.5 shrink-0 text-error"
            aria-hidden
          />
          {p.errors[error]}
        </span>
      ) : null}
    </span>
  );
}
