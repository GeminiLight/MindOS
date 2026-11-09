'use client';

import { useState } from 'react';
import NativeRuntimeOptionsCapsule from '@/components/ask/NativeRuntimeOptionsCapsule';
import type { NativeRuntimeOptions } from '@/lib/types';

/**
 * Preview for the composer's per-runtime model controls. Codex reads a model
 * list from its runtime; Claude Code has no such endpoint, so it offers stable
 * aliases next to the free-text override.
 */
export default function NativeModelPickerDemoPage() {
  const [claude, setClaude] = useState<NativeRuntimeOptions>({});
  const [codex, setCodex] = useState<NativeRuntimeOptions>({});

  return (
    <main className="box-border min-h-[calc(100vh-var(--app-titlebar-h))] max-w-[100vw] overflow-x-hidden bg-background py-8 text-foreground">
      <div className="mx-6 box-border flex w-[calc(100vw_-_48px)] min-w-0 max-w-[calc(100vw_-_48px)] flex-col gap-6 sm:mx-auto sm:w-full sm:max-w-4xl">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">MindOS Agent Demo</p>
          <h1 className="text-2xl font-semibold tracking-normal">Runtime Model Controls</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Claude Code offers stable aliases, since pinned model ids go stale.
          </p>
        </header>

        <section className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Claude Code</p>
            <NativeRuntimeOptionsCapsule runtimeKind="claude" value={claude} onChange={setClaude} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Codex</p>
            <NativeRuntimeOptionsCapsule runtimeKind="codex" value={codex} onChange={setCodex} />
          </div>
        </section>
      </div>
    </main>
  );
}
