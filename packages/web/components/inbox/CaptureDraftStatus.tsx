'use client';

import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { CaptureDraftSnapshot } from '@/lib/capture-draft-controller';

export function CaptureDraftStatus({ status, hasContent, onRetry }: {
  status: CaptureDraftSnapshot['status'];
  hasContent: boolean;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const failed = status === 'unavailable' || status === 'conflict';
  if (!hasContent && !failed) return null;
  const message = status === 'conflict' ? t.inbox.draftConflict
    : status === 'unavailable' ? t.inbox.draftUnavailable
      : status === 'saved' ? t.inbox.draftSaved : t.inbox.draftSaving;
  const Icon = failed ? AlertCircle : status === 'saved' ? Check : Loader2;
  return (
    <div data-capture-draft-status className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
      <p role={failed ? 'alert' : 'status'} className="flex min-w-0 flex-1 items-start gap-2">
        <Icon aria-hidden size={14} className={`mt-0.5 shrink-0 ${failed ? 'text-error' : status === 'saving' ? 'animate-spin' : ''}`} />
        <span>{message}</span>
      </p>
      {status === 'unavailable' && (
        <button type="button" onClick={onRetry} className="min-h-11 shrink-0 rounded-md px-2 font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          {t.inbox.draftRetry}
        </button>
      )}
    </div>
  );
}
