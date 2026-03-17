'use client';

import type { GalleryConfig } from './types';
import { tagColor } from './types';

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
        const tc = tag ? tagColor(tag) : null;
        return (
          <div key={i} className="rounded-xl border p-4 flex flex-col gap-2 hover:bg-muted/50 transition-colors"
            style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
          >
            {tag && tc && <span className="self-start text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: tc.bg, color: tc.text }}>{tag}</span>}
            <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--foreground)' }}>{title}</p>
            {desc && <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--muted-foreground)' }}>{desc}</p>}
            <div className="mt-1 flex flex-col gap-0.5">
              {headers.map((h, ci) => {
                if (ci === titleIdx || ci === descIdx || ci === tagIdx) return null;
                const v = row[ci]; if (!v) return null;
                return <div key={ci} className="flex items-baseline gap-1.5 text-xs">
                  <span className="font-display" style={{ color: 'var(--muted-foreground)', opacity: 0.6, fontSize: '0.68rem' }}>{h}</span>
                  <span className="truncate" style={{ color: 'var(--muted-foreground)' }}>{v}</span>
                </div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
