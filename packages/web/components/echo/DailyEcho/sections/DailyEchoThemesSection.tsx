'use client';

import type { DailyTheme } from '@/lib/daily-echo/types';

interface DailyEchoThemesSectionProps {
  themes: DailyTheme[];
  locale?: { t: Record<string, any> };
}

export function DailyEchoThemesSection({
  themes,
  locale,
}: DailyEchoThemesSectionProps) {
  const t = locale?.t || {};

  return (
    <section className="mb-8">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        {t.reportThemesTitle || 'Themes'}
      </h3>
      <div className="space-y-3">
        {themes.map((theme, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-border bg-card/50 p-4 hover:border-[var(--amber)]/25 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h4 className="font-medium text-foreground">{theme.name}</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {theme.fileCount} {t.reportThemeFiles || 'files'} · {theme.percentage}%
                </p>
              </div>
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground whitespace-nowrap">
                {theme.workType}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{theme.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
