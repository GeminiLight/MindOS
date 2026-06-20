'use client';

import { useMemo, useState } from 'react';
import type { RendererContext } from '@/lib/renderers/registry';
import {
  type AgentOp,
  type OpKind,
  opKind,
  ACTIVITY_FILTER_KINDS,
  AgentActivityEmptyState,
  AgentActivityFilterBar,
  AgentActivityOpCard,
} from '@/components/agents/agent-activity-shared';

// ─── Log entry format ─────────────────────────────────────────────────────────
// Primary format:
// {
//   "version": 1,
//   "events": [{ "ts": "...", "tool": "mindos_write_file", "params": {}, "result": "ok" }]
// }
//
// Legacy format (still supported for compatibility): JSON Lines.

interface AgentAuditState {
  version?: number;
  events?: AgentOp[];
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseJsonLines(content: string): AgentOp[] {
  const ops: AgentOp[] = [];

  // JSON Lines format: each line is a JSON object
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    try {
      const op = JSON.parse(trimmed) as AgentOp;
      if (op.tool && op.ts) ops.push(op);
    } catch { /* skip non-JSON lines */ }
  }
  return ops;
}

function parseOps(content: string): AgentOp[] {
  // New format: JSON object with events array.
  try {
    const parsed = JSON.parse(content) as AgentAuditState;
    if (Array.isArray(parsed.events)) {
      return parsed.events
        .filter((op) => Boolean(op?.tool) && Boolean(op?.ts))
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    }
  } catch {
    // Fallback to legacy JSONL.
  }

  const ops = parseJsonLines(content);

  // newest first
  return ops.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

// ─── Main renderer ────────────────────────────────────────────────────────────

export function AgentInspectorRenderer({ content }: RendererContext) {
  const [filter, setFilter] = useState<OpKind | 'all'>('all');
  const ops = useMemo(() => parseOps(content), [content]);

  const filtered = useMemo(() =>
    filter === 'all' ? ops : ops.filter(op => opKind(op.tool) === filter),
    [ops, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ops.length };
    for (const op of ops) {
      const k = opKind(op.tool);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [ops]);

  if (ops.length === 0) {
    return (
      <AgentActivityEmptyState
        title="No agent operations logged yet."
        hint={(
          <>
            Agent writes appear here from{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground">
              .mindos/agent-audit-log.json
            </code>
            .
          </>
        )}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[760px] py-6">
      <AgentActivityFilterBar
        kinds={ACTIVITY_FILTER_KINDS}
        counts={counts}
        active={filter}
        onChange={setFilter}
        locale="en"
        className="mb-5"
      />

      <div className="space-y-2">
        {filtered.map((op, i) => (
          <AgentActivityOpCard
            key={op.id ?? i}
            op={op}
            locale="en"
            showToolName
          />
        ))}
      </div>
    </div>
  );
}
