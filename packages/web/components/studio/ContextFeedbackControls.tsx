'use client';

import { RotateCcw, ThumbsDown, ThumbsUp, TimerOff, Unlink } from 'lucide-react';
import { useState } from 'react';
import type { ContextAsset, ContextFeedback, ContextStaleReview } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { mutateContextFeedback } from '@/lib/context-observability';
import { cn } from '@/lib/utils';

type Labels = {
  helpful: string;
  irrelevant: string;
  stale: string;
  missing: string;
  undo: string;
  saved: string;
  failed: string;
  staleReview: string;
  staleReviewDescription: string;
  keepActive: string;
  deprecate: string;
};

export function ReceiptFeedbackControls({
  receiptId,
  assetId,
  current,
  labels,
  onFeedback,
}: {
  receiptId: string;
  assetId: string;
  current?: ContextFeedback;
  labels: Labels;
  onFeedback(feedback: ContextFeedback): void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (signal: 'helpful' | 'irrelevant' | 'stale') => {
    setSaving(true);
    setMessage('');
    try {
      const payload = await mutateContextFeedback({ action: 'submit', receiptId, assetId, signal });
      onFeedback(payload.feedback as ContextFeedback);
      setMessage(labels.saved);
    } catch {
      setMessage(labels.failed);
    } finally {
      setSaving(false);
    }
  };
  const undo = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const payload = await mutateContextFeedback({ action: 'retract', feedbackId: current.id });
      onFeedback(payload.feedback as ContextFeedback);
      setMessage(labels.saved);
    } catch {
      setMessage(labels.failed);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-3 border-t border-border/45 pt-3">
      <div className="flex flex-wrap gap-2">
        <FeedbackButton label={labels.helpful} active={current?.status === 'active' && current.signal === 'helpful'} disabled={saving} icon={<ThumbsUp size={13} />} onClick={() => void submit('helpful')} ariaLabel={`${labels.helpful} ${assetId} for ${receiptId}`} />
        <FeedbackButton label={labels.irrelevant} active={current?.status === 'active' && current.signal === 'irrelevant'} disabled={saving} icon={<ThumbsDown size={13} />} onClick={() => void submit('irrelevant')} ariaLabel={`${labels.irrelevant} ${assetId} for ${receiptId}`} />
        <FeedbackButton label={labels.stale} active={current?.status === 'active' && current.signal === 'stale'} disabled={saving} icon={<TimerOff size={13} />} onClick={() => void submit('stale')} ariaLabel={`${labels.stale} ${assetId} for ${receiptId}`} />
        {current?.status === 'active' ? <Button type="button" size="xs" variant="ghost" disabled={saving} onClick={() => void undo()}><RotateCcw size={13} />{labels.undo}</Button> : null}
      </div>
      {message ? <p role="status" className="mt-2 text-[11px] text-muted-foreground">{message}</p> : null}
    </div>
  );
}

export function MissingContextControl({ receiptId, current, labels, onFeedback }: {
  receiptId: string;
  current?: ContextFeedback;
  labels: Labels;
  onFeedback(feedback: ContextFeedback): void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload = await mutateContextFeedback({ action: 'submit', receiptId, signal: 'missing' });
      onFeedback(payload.feedback as ContextFeedback);
      setMessage(labels.saved);
    } catch {
      setMessage(labels.failed);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/45 pt-4">
      <FeedbackButton label={labels.missing} active={current?.status === 'active'} disabled={saving} icon={<Unlink size={13} />} onClick={() => void submit()} ariaLabel={`${labels.missing} for ${receiptId}`} />
      {message ? <span role="status" className="text-[11px] text-muted-foreground">{message}</span> : null}
    </div>
  );
}

export function StaleReviewControls({ asset, review, labels, onReviewed }: {
  asset: ContextAsset;
  review?: ContextStaleReview;
  labels: Labels;
  onReviewed(): void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const reviewAsset = async (decision: 'keep' | 'deprecate') => {
    setSaving(true);
    setError(false);
    try {
      await mutateContextFeedback({
        action: 'review-stale',
        assetId: asset.id,
        decision,
        idempotencyKey: `context-stale:${asset.id}:${asset.version}:${decision}`,
      });
      onReviewed();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-5 rounded-lg border border-border/60 bg-muted/15 p-4">
      <h3 className="text-sm font-semibold text-foreground">{labels.staleReview}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{labels.staleReviewDescription}</p>
      {review?.status === 'applied' ? <p className="mt-3 text-xs font-medium text-foreground">{review.decision === 'keep' ? labels.keepActive : labels.deprecate}</p> : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void reviewAsset('keep')}>{labels.keepActive}</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} aria-label={`${labels.deprecate} stale asset ${asset.id}`} onClick={() => void reviewAsset('deprecate')}>{labels.deprecate}</Button>
        </div>
      )}
      {error ? <p role="alert" className="mt-2 text-xs text-error">{labels.failed}</p> : null}
    </div>
  );
}

function FeedbackButton({ label, active, disabled, icon, onClick, ariaLabel }: {
  label: string; active: boolean; disabled: boolean; icon: React.ReactNode; onClick(): void; ariaLabel: string;
}) {
  return <button type="button" aria-label={ariaLabel} aria-pressed={active} disabled={disabled} onClick={onClick} className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', active ? 'border-[var(--amber)] bg-[var(--amber-subtle)] text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground')}>{icon}{label}</button>;
}

export type ContextFeedbackLabels = Labels;
