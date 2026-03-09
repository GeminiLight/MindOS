'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitCompare, CheckCircle2, XCircle, FileEdit, ChevronDown } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';

// ─── Diff entry format ────────────────────────────────────────────────────────
// Agent writes diff entries as fenced blocks:
//
// ```agent-diff
// { "ts": "2025-01-15T10:30:00Z", "path": "Profile/Identity.md",
//   "tool": "mindos_write_file",
//   "before": "...full old content...",
//   "after": "...full new content..." }
// ```

interface DiffEntry {
  ts: string;
  path: string;
  tool: string;
  before: string;
  after: string;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseDiffs(content: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const re = /```agent-diff\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    try {
      const entry = JSON.parse(m[1].trim()) as DiffEntry;
      if (entry.path && entry.ts) entries.push(entry);
    } catch { /* skip */ }
  }
  return entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

// ─── Diff algorithm (line-level Myers-light) ──────────────────────────────────

type LineChange = { type: 'equal' | 'insert' | 'delete'; text: string };

function diffLines(oldText: string, newText: string): LineChange[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // LCS-based diff (simple patience-like for short files)
  const result: LineChange[] = [];

  // Build LCS table
  const m = oldLines.length, n = newLines.length;
  // For large files, limit context
  if (m > 500 || n > 500) {
    // Truncate and just show a summary
    const added = newLines.filter(l => !oldLines.includes(l)).length;
    const removed = oldLines.filter(l => !newLines.includes(l)).length;
    result.push({ type: 'delete', text: `[... ${removed} lines removed, ${added} lines added — file too large for line diff ...]` });
    return result;
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type: 'equal', text: oldLines[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'insert', text: newLines[j] });
      j++;
    } else {
      result.push({ type: 'delete', text: oldLines[i] });
      i++;
    }
  }

  return result;
}

// Collapse long equal runs — show 3 context lines around changes
function collapseContext(changes: LineChange[], ctx = 3): Array<LineChange | { type: 'collapse'; count: number }> {
  type AnyLine = LineChange | { type: 'collapse'; count: number };
  const result: AnyLine[] = [];
  const changed = new Set<number>();

  changes.forEach((c, i) => { if (c.type !== 'equal') { for (let k = Math.max(0, i - ctx); k <= Math.min(changes.length - 1, i + ctx); k++) changed.add(k); } });

  let skipStart = -1;
  for (let i = 0; i < changes.length; i++) {
    if (changed.has(i)) {
      if (skipStart !== -1) {
        result.push({ type: 'collapse', count: i - skipStart });
        skipStart = -1;
      }
      result.push(changes[i]);
    } else {
      if (skipStart === -1) skipStart = i;
    }
  }
  if (skipStart !== -1) result.push({ type: 'collapse', count: changes.length - skipStart });

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTs(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function stats(changes: LineChange[]): { added: number; removed: number } {
  return {
    added: changes.filter(c => c.type === 'insert').length,
    removed: changes.filter(c => c.type === 'delete').length,
  };
}

// ─── Diff card ────────────────────────────────────────────────────────────────

function DiffCard({ entry, saveAction, fullContent }: {
  entry: DiffEntry;
  saveAction: (c: string) => Promise<void>;
  fullContent: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [approved, setApproved] = useState<boolean | null>(null);

  const changes = useMemo(() => diffLines(entry.before, entry.after), [entry]);
  const collapsed = useMemo(() => collapseContext(changes), [changes]);
  const { added, removed } = stats(changes);

  const toolShort = entry.tool.replace('mindos_', '');

  async function handleApprove() {
    setApproved(true);
    // Mark this diff as approved by updating the block in the source file
    const updated = fullContent.replace(
      `"ts": "${entry.ts}", "path": "${entry.path}"`,
      `"ts": "${entry.ts}", "path": "${entry.path}", "approved": true`,
    );
    await saveAction(updated);
  }

  async function handleReject() {
    setApproved(false);
    // Revert: write the "before" content back to the target file
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'save_file', path: entry.path, content: entry.before }),
    });
    const updated = fullContent.replace(
      `"ts": "${entry.ts}", "path": "${entry.path}"`,
      `"ts": "${entry.ts}", "path": "${entry.path}", "approved": false, "reverted": true`,
    );
    await saveAction(updated);
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--card)', marginBottom: 10 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderBottom: expanded ? '1px solid var(--border)' : 'none' }}>
        <FileEdit size={13} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        <span
          style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.78rem', color: 'var(--amber)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
          onClick={() => router.push('/view/' + entry.path.split('/').map(encodeURIComponent).join('/'))}
          title={entry.path}
        >
          {entry.path}
        </span>

        {/* diff stats */}
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.7rem', color: '#7aad80', flexShrink: 0 }}>+{added}</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.7rem', color: '#c85050', flexShrink: 0 }}>−{removed}</span>

        {/* tool badge */}
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', padding: '1px 7px', borderRadius: 999, background: 'var(--muted)', color: 'var(--muted-foreground)', flexShrink: 0 }}>
          {toolShort}
        </span>

        {/* timestamp */}
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: 'var(--muted-foreground)', opacity: 0.6, flexShrink: 0 }}>
          {relativeTs(entry.ts)}
        </span>

        {/* approve/reject — only if not yet decided */}
        {approved === null ? (
          <>
            <button
              onClick={handleApprove}
              title="Approve this change"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#7aad80', display: 'flex', alignItems: 'center' }}
            >
              <CheckCircle2 size={15} />
            </button>
            <button
              onClick={handleReject}
              title="Reject & revert this change"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#c85050', display: 'flex', alignItems: 'center' }}
            >
              <XCircle size={15} />
            </button>
          </>
        ) : (
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: approved ? '#7aad80' : '#c85050' }}>
            {approved ? '✓ approved' : '✕ reverted'}
          </span>
        )}

        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center' }}
        >
          <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
      </div>

      {/* diff view */}
      {expanded && (
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', lineHeight: 1.5, overflowX: 'auto' }}>
          {collapsed.map((line, i) => {
            if (line.type === 'collapse') {
              return (
                <div key={i} style={{ padding: '2px 14px', background: 'var(--muted)', color: 'var(--muted-foreground)', opacity: 0.6, fontSize: '0.65rem' }}>
                  ··· {line.count} unchanged lines ···
                </div>
              );
            }
            const bg =
              line.type === 'insert' ? 'rgba(122,173,128,0.12)' :
              line.type === 'delete' ? 'rgba(200,80,80,0.10)' :
              'transparent';
            const color =
              line.type === 'insert' ? '#7aad80' :
              line.type === 'delete' ? '#c85050' :
              'var(--muted-foreground)';
            const prefix =
              line.type === 'insert' ? '+' :
              line.type === 'delete' ? '−' :
              ' ';
            return (
              <div key={i} style={{ display: 'flex', background: bg, borderLeft: line.type !== 'equal' ? `2px solid ${color}` : '2px solid transparent' }}>
                <span style={{ width: 20, textAlign: 'center', color, opacity: 0.8, flexShrink: 0, userSelect: 'none' }}>{prefix}</span>
                <span style={{ padding: '1px 8px 1px 0', color: line.type === 'equal' ? 'var(--muted-foreground)' : color, whiteSpace: 'pre', flex: 1 }}>
                  {line.text || ' '}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main renderer ────────────────────────────────────────────────────────────

export function DiffRenderer({ content, saveAction }: RendererContext) {
  const entries = useMemo(() => parseDiffs(content), [content]);

  if (entries.length === 0) {
    return (
      <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>
        <GitCompare size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
        <p>No agent diffs logged yet.</p>
        <p style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
          Agent writes appear here as <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>```agent-diff</code> blocks.
        </p>
      </div>
    );
  }

  const totalAdded = entries.reduce((acc, e) => acc + diffLines(e.before, e.after).filter(c => c.type === 'insert').length, 0);
  const totalRemoved = entries.reduce((acc, e) => acc + diffLines(e.before, e.after).filter(c => c.type === 'delete').length, 0);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* stats bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.2rem', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--muted-foreground)' }}>
        <span>{entries.length} change{entries.length !== 1 ? 's' : ''}</span>
        <span style={{ color: '#7aad80' }}>+{totalAdded}</span>
        <span style={{ color: '#c85050' }}>−{totalRemoved}</span>
      </div>

      {entries.map((entry, i) => (
        <DiffCard key={i} entry={entry} saveAction={saveAction} fullContent={content} />
      ))}
    </div>
  );
}
