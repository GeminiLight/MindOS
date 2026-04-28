'use client';

import type { AlignmentAnalysis } from '@/lib/daily-echo/types';

interface DailyEchoAlignmentSectionProps {
  alignment: AlignmentAnalysis;
  locale?: { t: Record<string, any> };
}

export function DailyEchoAlignmentSection({
  alignment,
  locale,
}: DailyEchoAlignmentSectionProps) {
  const t = locale?.t || {};
  const score = alignment.alignmentScore;
  const percentage = Math.round(score);

  let colorClass = 'bg-destructive/25 text-destructive';
  let barColorClass = 'bg-destructive';
  let labelText = t.reportAlignmentMisaligned || 'Drifted';

  if (score >= 70) {
    colorClass = 'bg-success/25 text-success';
    barColorClass = 'bg-success';
    labelText = t.reportAlignmentAligned || 'Aligned';
  } else if (score >= 40) {
    colorClass = 'bg-[var(--amber)]/25 text-[var(--amber)]';
    barColorClass = 'bg-[var(--amber)]';
    labelText = t.reportAlignmentPartial || 'Partial';
  }

  return (
    <section className="mb-8">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        {t.reportAlignmentTitle || 'Alignment'}
      </h3>

      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-4">
        {/* Score Display */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              {t.reportAlignmentScore || 'Alignment'}
            </span>
            <span className={`inline-flex px-2.5 py-0.5 rounded text-sm font-semibold ${colorClass}`}>
              {percentage}/100
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 bg-muted rounded-sm overflow-hidden">
            <div
              className={`h-full ${barColorClass} transition-all duration-300`}
              style={{ width: `${percentage}%` }}
              role="progressbar"
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          <p className="text-xs text-muted-foreground mt-1">{labelText}</p>
        </div>

        {/* Analysis Text */}
        <div className="text-sm text-muted-foreground leading-relaxed">{alignment.analysis}</div>

        {alignment.reasoning && (
          <div className="text-xs text-muted-foreground italic border-l-2 border-border pl-3">
            {alignment.reasoning}
          </div>
        )}
      </div>
    </section>
  );
}
