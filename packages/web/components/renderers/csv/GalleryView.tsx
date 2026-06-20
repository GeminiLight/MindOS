'use client';

import type { GalleryConfig } from './types';
import { tagTone } from './types';
import { cn } from '@/lib/utils';

export function GalleryView({ headers, rows, cfg }: { headers: string[]; rows: string[][]; cfg: GalleryConfig }) {
  const titleIdx = headers.indexOf(cfg.titleField);
  const descIdx = headers.indexOf(cfg.descField);
  const tagIdx = headers.indexOf(cfg.tagField);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((row, i) => {
        const title = titleIdx >= 0 ? row[titleIdx] : row[0] ?? '';
        const desc = descIdx >= 0 ? row[descIdx] : '';
        const tag = tagIdx >= 0 ? row[tagIdx] : '';
        const tone = tag ? tagTone(tag) : null;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50">
            {tag && tone && (
              <span className={cn('self-start rounded-full px-2 py-0.5 text-xs font-medium', tone.badge)}>
                {tag}
              </span>
            )}
            <p className="text-sm font-semibold leading-snug text-foreground">{title}</p>
            {desc && <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
            <div className="mt-1 flex flex-col gap-0.5">
              {headers.map((h, ci) => {
                if (ci === titleIdx || ci === descIdx || ci === tagIdx) return null;
                const v = row[ci]; if (!v) return null;
                return <div key={ci} className="flex items-baseline gap-1.5 text-xs">
                  <span className="font-mono text-[0.68rem] text-muted-foreground/60">{h}</span>
                  <span className="truncate text-muted-foreground">{v}</span>
                </div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
