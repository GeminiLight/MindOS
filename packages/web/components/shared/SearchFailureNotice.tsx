'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';

export function SearchFailureNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <div role="alert" className="mx-3 my-3 rounded-lg border border-border bg-background px-4 py-4">
      <div className="flex items-start gap-2.5">
        <AlertCircle aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-error" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t.search.failed}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.search.failedHint}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>{t.search.retry}</Button>
        </div>
      </div>
    </div>
  );
}
