'use client';

import { useEffect, useMemo, useState } from 'react';
import RuntimeIconSwitcher from '@/components/ask/RuntimeIconSwitcher';
import type { AgentRuntimeDescriptor, AgentRuntimeIdentity, RuntimeSessionBinding } from '@/lib/types';

const CHECKED_AT = '2026-06-10T00:00:00.000Z';

export default function RuntimeSwitcherDemoPage() {
  const [selectedRuntime, setSelectedRuntime] = useState<AgentRuntimeIdentity | null>(null);
  const runtimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName'>>>>(() => [
    {
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      status: 'signed-out',
      availability: {
        checkedAt: CHECKED_AT,
        sources: ['native-health'],
        reason: 'Codex model provider "openai" requires OPENAI_API_KEY, but MindOS cannot see that environment variable.',
        diagnosticHints: [
          'MindOS detected Codex at /opt/homebrew/bin/codex.',
          'Restart MindOS after exporting the required environment variable so the server process inherits it.',
        ],
      },
    },
    {
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      status: 'missing',
      installCmd: 'npm install -g @anthropic-ai/claude-code',
      packageName: '@anthropic-ai/claude-code',
      availability: {
        checkedAt: CHECKED_AT,
        sources: ['native-health'],
        reason: 'Claude Code executable was not detected.',
        diagnosticHints: [
          'MindOS checked command "claude" on the server PATH.',
          'Install it or add it to the PATH used to start MindOS: npm install -g @anthropic-ai/claude-code',
        ],
      },
    },
  ], []);
  const binding = useMemo<RuntimeSessionBinding | null>(() => selectedRuntime?.kind === 'claude'
    ? {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'session_1234567890abcdef',
        cwd: '/Users/moonshot/projects/product/mindos-dev',
        status: 'active',
        updatedAt: 1,
      }
    : null, [selectedRuntime]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.click();
    }, 100);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="min-h-screen max-w-[100vw] overflow-x-hidden bg-background text-foreground">
      <div className="mx-0 flex w-full max-w-[100vw] min-w-0 flex-col gap-6 px-6 py-8 sm:mx-auto sm:max-w-3xl">
        <header className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            MindOS Agent Demo
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            Runtime Switcher Diagnostics
          </h1>
          <p className="w-full max-w-[calc(100vw-48px)] text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere] sm:max-w-2xl">
            Runtime diagnostics.
          </p>
        </header>

        <section className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background p-4">
          <RuntimeIconSwitcher
            selectedRuntime={selectedRuntime}
            onSelect={setSelectedRuntime}
            runtimeSessionBinding={binding}
            nativeRuntimes={runtimes}
            loadingByKind={{ codex: false, claude: false }}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {selectedRuntime?.name ?? 'MindOS'}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {selectedRuntime
                ? 'Local runtime selected'
                : 'MindOS provider/model controls remain active'}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
