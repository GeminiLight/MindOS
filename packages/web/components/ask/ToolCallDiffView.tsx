'use client';

import { useMemo } from 'react';
import { FileDiff } from 'lucide-react';
import { collapseDiffContext, tryBuildLineDiff } from '@/components/changes/line-diff';
import type { DiffRow } from '@/components/changes/line-diff';

export interface ToolCallDiff {
  path: string;
  oldText: string;
  newText: string;
  truncated?: boolean;
}

/** Keep one tool call's diff panel bounded; a huge rewrite must not freeze the chat. */
const MAX_ROWS_PER_FILE = 400;

function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

type BuiltDiff = {
  rows: DiffRow[];
  added: number;
  removed: number;
  clipped: boolean;
};

function buildRows(diff: ToolCallDiff): BuiltDiff | null {
  // `''.split('\n')` yields one empty line, so diffing a created file against an
  // empty string reports a phantom deletion. Treat each side's absence as "no
  // lines" instead, which is what the user means by created / emptied.
  if (!diff.oldText || !diff.newText) {
    const text = diff.oldText || diff.newText;
    if (!text) return null;
    const inserting = !diff.oldText;
    const lines = text.split('\n').map(line => ({ type: inserting ? 'insert' as const : 'delete' as const, text: line }));
    return {
      rows: lines.slice(0, MAX_ROWS_PER_FILE),
      added: inserting ? lines.length : 0,
      removed: inserting ? 0 : lines.length,
      clipped: lines.length > MAX_ROWS_PER_FILE,
    };
  }

  const lines = tryBuildLineDiff(diff.oldText, diff.newText);
  // The shared diff algorithm is bounded and gives up on very large rewrites.
  // Report the file as changed anyway — an invisible edit is the worse failure.
  if (!lines) return { rows: [], added: 0, removed: 0, clipped: true };
  const added = lines.filter(line => line.type === 'insert').length;
  const removed = lines.filter(line => line.type === 'delete').length;
  if (added === 0 && removed === 0) return null;
  const collapsed = collapseDiffContext(lines);
  return {
    rows: collapsed.slice(0, MAX_ROWS_PER_FILE),
    added,
    removed,
    clipped: collapsed.length > MAX_ROWS_PER_FILE,
  };
}

/**
 * File changes an external agent reported through ACP. Native MindOS tools embed
 * their diff in the tool output text and keep their own renderer; this one draws
 * the structured `tool_diff` payload with the same line-diff algorithm as
 * `/changes`, so both surfaces agree on what changed.
 */
export default function ToolCallDiffView({ diffs }: { diffs: ToolCallDiff[] }) {
  const files = useMemo(
    () => diffs.map(diff => ({ diff, built: buildRows(diff) })).filter(file => file.built !== null),
    [diffs],
  );

  if (files.length === 0) return null;

  return (
    <div className="max-h-80 overflow-y-auto">
      {files.map(({ diff, built }) => (
        <div key={diff.path} className="border-b border-border/30 last:border-b-0">
          <div className="flex flex-wrap items-center gap-1.5 bg-muted/20 px-2.5 py-1.5">
            <FileDiff size={11} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate font-medium text-foreground" title={diff.path}>{fileName(diff.path)}</span>
            {built!.added > 0 && <span className="shrink-0 text-success">+{built!.added}</span>}
            {built!.removed > 0 && <span className="shrink-0 text-error">-{built!.removed}</span>}
            {(diff.truncated || built!.clipped) && (
              <span className="shrink-0 text-2xs text-muted-foreground/70">(truncated)</span>
            )}
          </div>
          {built!.rows.map((row, index) => (
            row.type === 'gap' ? (
              <div key={`gap-${index}`} className="px-2.5 py-px text-2xs text-muted-foreground/50">
                ⋯ {row.count} unchanged
              </div>
            ) : (
              <div
                key={index}
                className={`flex items-start gap-1.5 px-2 py-px ${
                  row.type === 'insert' ? 'bg-success/8' : row.type === 'delete' ? 'bg-error/8' : ''
                }`}
              >
                <span
                  aria-hidden
                  className={`w-3 shrink-0 select-none text-right ${
                    row.type === 'insert' ? 'text-success' : row.type === 'delete' ? 'text-error' : 'text-muted-foreground/50'
                  }`}
                >
                  {row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' '}
                </span>
                <span
                  className={`flex-1 whitespace-pre-wrap break-all ${
                    row.type === 'insert' ? 'text-success' : row.type === 'delete' ? 'text-error' : 'text-muted-foreground'
                  }`}
                >
                  {row.text || ' '}
                </span>
              </div>
            )
          ))}
        </div>
      ))}
    </div>
  );
}
