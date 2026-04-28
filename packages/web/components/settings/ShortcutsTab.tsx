'use client';

import type { ShortcutsTabProps } from './types';

export function ShortcutsTab({ t }: ShortcutsTabProps) {
  return (
    <div className="space-y-1">
      {t.shortcuts.map((s: { readonly description: string; readonly keys: readonly string[] }, i: number) => (
        <div key={i} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
          <span className="text-sm text-foreground">{s.description}</span>
          <div className="flex items-center gap-1">
            {s.keys.map((k: string, j: number) => (
              <kbd key={j} className="px-2 py-0.5 text-xs font-mono bg-muted border border-border rounded text-foreground">{k}</kbd>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
