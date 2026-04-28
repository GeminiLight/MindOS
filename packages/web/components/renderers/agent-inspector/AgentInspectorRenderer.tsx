'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Terminal, FileEdit, FilePlus, Trash2, Search, Clock, ChevronDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';

// ─── Log entry format ─────────────────────────────────────────────────────────
// Primary format:
// {
//   "version": 1,
//   "events": [{ "ts": "...", "tool": "mindos_write_file", "params": {}, "result": "ok" }]
// }
//
// Legacy format (still supported for compatibility): JSON Lines.

interface AgentOp {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  agentName?: string;
}

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

// ─── Tool metadata ────────────────────────────────────────────────────────────

type OpKind = 'read' | 'write' | 'create' | 'delete' | 'search' | 'other';

function opKind(tool: string): OpKind {
  if (/read|list|get|search/.test(tool)) {
    if (/search/.test(tool)) return 'search';
    return 'read';
  }
  if (/create/.test(tool)) return 'create';
  if (/delete/.test(tool)) return 'delete';
  if (/write|update|insert|append/.test(tool)) return 'write';
  return 'other';
}

const KIND_STYLE: Record<OpKind, { bg: string; text: string; border: string }> = {
  read:   { bg: 'rgba(138,180,216,0.10)', text: 'var(--tool-read)', border: 'rgba(138,180,216,0.25)' },
  write:  { bg: 'rgba(200,135,58,0.10)',  text: 'var(--amber)', border: 'rgba(200,135,58,0.25)' },
  create: { bg: 'rgba(122,173,128,0.10)', text: 'var(--success)', border: 'rgba(122,173,128,0.25)' },
  delete: { bg: 'rgba(200,80,80,0.10)',   text: 'var(--error)', border: 'rgba(200,80,80,0.25)' },
  search: { bg: 'rgba(200,160,216,0.10)', text: 'var(--tool-search)', border: 'rgba(200,160,216,0.25)' },
  other:  { bg: 'var(--muted)', text: 'var(--muted-foreground)', border: 'var(--border)' },
};

function OpIcon({ kind, size = 13 }: { kind: OpKind; size?: number }) {
  if (kind === 'read')   return <Clock size={size} />;
  if (kind === 'write')  return <FileEdit size={size} />;
  if (kind === 'create') return <FilePlus size={size} />;
  if (kind === 'delete') return <Trash2 size={size} />;
  if (kind === 'search') return <Search size={size} />;
  return <Terminal size={size} />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

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

function getFilePath(params: Record<string, unknown>): string | null {
  return typeof params.path === 'string' ? params.path : null;
}

function truncateContent(v: unknown, max = 120): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ─── Single op card ───────────────────────────────────────────────────────────

function OpCard({ op }: { op: AgentOp }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const kind = opKind(op.tool);
  const style = KIND_STYLE[kind];
  const filePath = getFilePath(op.params);

  const toolShort = op.tool.replace('mindos_', '');

  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid var(--border)`,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 8,
    }}>
      {/* Header row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* kind badge */}
        <span className="font-display" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 999, fontSize: '0.68rem',
          fontWeight: 600,
          background: style.bg, color: style.text, border: `1px solid ${style.border}`,
          flexShrink: 0,
        }}>
          <OpIcon kind={kind} size={10} />
          {kind}
        </span>

        {/* tool name */}
        <span className="font-display" style={{ fontSize: '0.78rem', color: 'var(--foreground)', fontWeight: 600, flexShrink: 0 }}>
          {toolShort}
        </span>

        {/* file path */}
        {filePath && (
          <span
            style={{ fontSize: '0.72rem', color: 'var(--amber)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); router.push('/view/' + filePath.split('/').map(encodeURIComponent).join('/')); }}
            title={filePath}
            className="font-display"
          >
            {filePath}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* agent name badge */}
          {op.agentName && (
            <span className="font-display" style={{
              fontSize: '0.62rem', fontWeight: 500,
              padding: '1px 6px', borderRadius: 999,
              background: 'var(--muted)', color: 'var(--muted-foreground)',
              whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
            }} title={op.agentName}>
              {op.agentName.length > 30 ? op.agentName.slice(0, 30) + '...' : op.agentName}
            </span>
          )}
          {/* result */}
          {op.result === 'ok'
            ? <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
            : <AlertCircle size={13} style={{ color: 'var(--error)' }} />
          }
          {/* timestamp */}
          <span className="font-display" style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)', opacity: 0.6 }} title={formatTs(op.ts)}>
            {relativeTs(op.ts)}
          </span>
          {/* chevron */}
          <ChevronDown size={12} style={{ color: 'var(--muted-foreground)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </div>
      </div>

      {/* Expanded params */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--background)' }}>
          {/* params table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: op.message ? 8 : 0 }}>
            {Object.entries(op.params).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span className="font-display" style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)', opacity: 0.7, flexShrink: 0, minWidth: 80 }}>
                  {k}
                </span>
                <span className="font-display" style={{ fontSize: '0.72rem', color: 'var(--foreground)', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {truncateContent(v)}
                </span>
              </div>
            ))}
          </div>
          {/* result message */}
          {op.message && (
            <div className="font-display" style={{ marginTop: 6, padding: '5px 9px', borderRadius: 5, fontSize: '0.72rem',
              background: op.result === 'error' ? 'rgba(200,80,80,0.08)' : 'rgba(122,173,128,0.08)',
              color: op.result === 'error' ? 'var(--error)' : 'var(--success)',
              border: `1px solid ${op.result === 'error' ? 'rgba(200,80,80,0.2)' : 'rgba(122,173,128,0.2)'}`,
            }}>
              {op.message}
            </div>
          )}
          {/* agent info */}
          {op.agentName && (
            <div className="font-display" style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--muted-foreground)' }}>
              Agent: <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{op.agentName}</span>
            </div>
          )}
          {/* absolute timestamp */}
          <div className="font-display" style={{ marginTop: 6, fontSize: '0.65rem', color: 'var(--muted-foreground)', opacity: 0.5 }}>
            {formatTs(op.ts)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

const KINDS: Array<OpKind | 'all'> = ['all', 'write', 'create', 'delete', 'read', 'search'];

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
      <div className="font-display" style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>
        <Terminal size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
        <p>No agent operations logged yet.</p>
        <p style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
          Agent writes appear here from <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: 4 }}>.mindos/agent-audit-log.json</code>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        {KINDS.map(k => {
          const cnt = counts[k] ?? 0;
          if (k !== 'all' && !cnt) return null;
          const style = k !== 'all' ? KIND_STYLE[k] : undefined;
          const active = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="font-display"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 999, fontSize: '0.7rem',
                cursor: 'pointer', border: 'none',
                background: active ? (style?.bg ?? 'var(--accent)') : 'var(--muted)',
                color: active ? (style?.text ?? 'var(--foreground)') : 'var(--muted-foreground)',
                outline: active ? `1px solid ${style?.border ?? 'var(--border)'}` : 'none',
                transition: 'all .1s',
              }}
            >
              {k !== 'all' && <OpIcon kind={k} size={10} />}
              {k} <span style={{ opacity: 0.6 }}>({cnt})</span>
            </button>
          );
        })}
      </div>

      {/* ops list */}
      <div>
        {filtered.map((op, i) => <OpCard key={i} op={op} />)}
      </div>
    </div>
  );
}
