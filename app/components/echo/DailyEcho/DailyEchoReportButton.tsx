'use client';

/**
 * Daily Echo Report Generate Button
 *
 * Triggers report generation and shows loading/error states
 */

import { useState, useCallback } from 'react';
import { Zap, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type {
  DailyEchoGenerateResponse,
  DailyEchoReport,
} from '@/lib/daily-echo/types';

interface DailyEchoReportButtonProps {
  onGenerated: (report: DailyEchoReport) => void;
  onError: (error: string) => void;
  locale?: { t: Record<string, string> };
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
      const response = await apiFetch<DailyEchoGenerateResponse>(
        '/api/daily-echo/generate',
        {
          method: 'POST',
          body: JSON.stringify({}),
          timeout: 30000, // 30 seconds for full generation
        }
      );

      onGenerated(response.report);
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
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle
            size={18}
            className="mt-0.5 shrink-0 text-destructive"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">
              {t.dailyReportError || '生成失败'}
            </p>
            <p className="mt-1 text-xs text-destructive/80">
              {error}
            </p>
            <button
              onClick={handleGenerate}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
              type="button"
              disabled={isLoading}
            >
              {isLoading
                ? t.dailyReportGenerating || '重试中...'
                : t.dailyReportRetry || '重试'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={isLoading}
      className="w-full rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] px-4 py-2.5 font-sans text-sm font-medium transition-all duration-150 hover:bg-[var(--amber)]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
