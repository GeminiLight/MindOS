'use client';

/**
 * Daily Echo Report Generate Button
 *
 * Triggers client-side report generation and shows loading/error states.
 * All data sources (localStorage, IndexedDB, fetch) are browser-only,
 * so generation runs entirely on the client.
 */

import { useState, useCallback } from 'react';
import { Zap, AlertCircle } from 'lucide-react';
import type { DailyEchoReport } from '@/lib/daily-echo/types';
import { generateDailyEchoReport } from '@/lib/daily-echo/generator';
import { loadDailyEchoConfig } from '@/lib/daily-echo/config';

interface DailyEchoReportButtonProps {
  onGenerated: (report: DailyEchoReport) => void;
  onError: (error: string) => void;
  locale?: { t: Record<string, any> };
}

export default function DailyEchoReportButton({
  onGenerated,
  onError,
  locale,
}: DailyEchoReportButtonProps) {
  const t = locale?.t || {};
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const config = loadDailyEchoConfig();
      const report = await generateDailyEchoReport(new Date(), config);
      onGenerated(report);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      onError(message);
    } finally {
      setIsLoading(false);
    }
  }, [onGenerated, onError]);

  if (error) {
    return (
      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 font-sans text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        type="button"
        title={error}
      >
        <AlertCircle size={16} className="shrink-0" />
        <span>
          {isLoading
            ? t.dailyReportGenerating || '重试中...'
            : t.dailyReportRetry || '重试'}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={isLoading}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] px-4 py-2.5 font-sans text-sm font-medium transition-all duration-150 hover:bg-[var(--amber)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
      type="button"
      aria-busy={isLoading}
    >
      {isLoading ? (
        <>
          <div className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-[var(--amber-foreground)]/30 border-t-[var(--amber-foreground)]" />
          <span>{t.dailyReportGenerating || '生成中...'}</span>
        </>
      ) : (
        <>
          <Zap size={16} />
          <span>{t.dailyReportGenerate || '生成今日回响'}</span>
        </>
      )}
    </button>
  );
}
