'use client';

import PendingAgentActions from '@/components/ask/PendingAgentActions';

/**
 * Dev playground for the cross-process pending-actions surface
 * (spec-cross-process-run-events H): renders the exact component ChatContent
 * mounts above the message list, fed by the live
 * `GET /api/agent/pending-actions` (in-process prompts ∪ cross-process store
 * rows ∪ automation approvals). Useful for screenshots and for exercising the
 * list against a prompt recorded by another process, e.g.:
 *
 *   node -e "..." packages/mindos/dist/agent/bridges/pending-prompt-store.js
 */
export default function PendingActionsDemoPage() {
  return (
    <main className="box-border min-h-[calc(100vh-var(--app-titlebar-h))] max-w-[100vw] overflow-x-hidden bg-background py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col">
      <header className="border-b border-border/40 px-4 py-3">
        <h1 className="font-mono text-sm font-semibold text-foreground">Pending agent actions — dev demo</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          The list below is the same component the Ask panel mounts. Prompts from any host
          process appear here; decisions are sent through the normal resolve endpoints.
        </p>
      </header>
      <PendingAgentActions
        labels={{
          title: 'Pending agent actions',
          answer: 'Answer',
          cancel: 'Cancel',
          approve: 'Approve',
          deny: 'Deny',
        }}
      />
      <div className="flex-1 px-4 py-6">
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-10 text-center font-mono text-xs text-muted-foreground">
          message list area (see /chat for the real panel)
        </div>
      </div>
      </div>
    </main>
  );
}
