'use client';

import type { DailySnapshot } from '@/lib/daily-echo/types';

interface DailyEchoSnapshotSectionProps {
  snapshot: DailySnapshot;
  locale?: { t: Record<string, any> };
}

export function DailyEchoSnapshotSection({
  snapshot,
  locale,
}: DailyEchoSnapshotSectionProps) {
  const t = locale?.t || {};

  return (
    <section className="mb-8">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        {t.snapshotTitle || '今日动向'}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {[
          { value: snapshot.filesEdited, label: t.snapshotFilesEdited || 'Files edited' },
          { value: snapshot.filesCreated, label: t.snapshotFilesCreated || 'Files created' },
          { value: snapshot.sessionCount, label: t.snapshotSessions || 'Chat sessions' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-lg font-semibold text-foreground">{stat.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-muted/25 px-3 py-2.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{t.snapshotKbGrowth || 'KB growth'}:</span>{' '}
        {snapshot.kbGrowth}
      </div>
    </section>
  );
}
