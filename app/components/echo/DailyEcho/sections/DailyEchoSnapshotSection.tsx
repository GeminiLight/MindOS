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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        {t.snapshotTitle || '📊 今日动向'}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-muted/40 p-3 text-center hover:bg-muted/60 transition-colors">
          <div className="text-lg font-semibold text-foreground">
            {snapshot.filesEdited}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t.snapshotFilesEdited ||
              'Files edited'}
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 p-3 text-center hover:bg-muted/60 transition-colors">
          <div className="text-lg font-semibold text-foreground">
            {snapshot.filesCreated}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t.snapshotFilesCreated ||
              'Files created'}
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 p-3 text-center hover:bg-muted/60 transition-colors">
          <div className="text-lg font-semibold text-foreground">
            {snapshot.sessionCount}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t.snapshotSessions ||
              'Chat sessions'}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {t.snapshotKbGrowth || 'KB growth'}:
        </span>{' '}
        {snapshot.kbGrowth}
      </div>
    </section>
  );
}
