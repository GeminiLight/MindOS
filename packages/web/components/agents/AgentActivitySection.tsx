'use client';

/**
 * AgentActivitySection — Full audit log view for the Agents Activity tab.
 * Fetches data from /api/agent-activity and displays a filterable, expandable timeline.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Terminal, ChevronDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  type AgentOp, type OpKind,
  opKind, KIND_STYLE, KIND_LABEL, OpIcon, KindBadge, formatTs, relativeTs, getFilePath,
} from './agent-activity-shared';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function truncateContent(v: unknown, max = 120): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

// ─── Op Card ───────────────────────────────────────────────────────────────────

function OpCard({ op, copy }: { op: AgentOp; copy?: Record<string, string> }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const kind = opKind(op.tool);
  const style = KIND_STYLE[kind];
  const filePath = getFilePath(op.params);

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
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
        <KindBadge kind={kind} locale={locale} />

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

      {/* Expanded details */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--background)' }}>
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
          {op.message && (
            <div className="font-display" style={{ marginTop: 6, padding: '5px 9px', borderRadius: 5, fontSize: '0.72rem',
              background: op.result === 'error' ? 'rgba(200,80,80,0.08)' : 'rgba(122,173,128,0.08)',
              color: op.result === 'error' ? 'var(--error)' : 'var(--success)',
              border: `1px solid ${op.result === 'error' ? 'rgba(200,80,80,0.2)' : 'rgba(122,173,128,0.2)'}`,
            }}>
              {op.message}
            </div>
          )}
          {op.agentName && (
            <div className="font-display" style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--muted-foreground)' }}>
              {copy?.agentLabel ?? 'Agent'}: <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{op.agentName}</span>
            </div>
          )}
          <div className="font-display" style={{ marginTop: 6, fontSize: '0.65rem', color: 'var(--muted-foreground)', opacity: 0.5 }}>
            {formatTs(op.ts)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter kinds ──────────────────────────────────────────────────────────────

const KINDS: Array<OpKind | 'all'> = ['all', 'write', 'create', 'delete', 'read', 'search'];

// ─── Main section ──────────────────────────────────────────────────────────────

export default function AgentActivitySection() {
  const { t, locale } = useLocale();
  const [ops, setOps] = useState<AgentOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OpKind | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      fetch('/api/agent-activity?limit=200')
        .then(r => r.json())
        .then(data => { if (!cancelled) setOps(data.events ?? []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    doFetch();
    const onVisible = () => { if (document.visibilityState === 'visible') doFetch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);

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

  const copy = t.agentsContent?.activity;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground/50">
        <div className="animate-pulse text-sm font-display">{copy?.loading ?? 'Loading activity...'}</div>
      </div>
    );
  }

  if (ops.length === 0) {
    return (
      <div className="font-display" style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>
        <Terminal size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
        <p>{copy?.empty ?? 'No agent operations logged yet.'}</p>
        <p style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
          {copy?.emptyHint ?? 'Operations from connected agents will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        {KINDS.map(k => {
          const cnt = counts[k] ?? 0;
          if (k !== 'all' && !cnt) return null;
          const s = k !== 'all' ? KIND_STYLE[k] : undefined;
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
                background: active ? (s?.bg ?? 'var(--accent)') : 'var(--muted)',
                color: active ? (s?.text ?? 'var(--foreground)') : 'var(--muted-foreground)',
                outline: active ? `1px solid ${s?.border ?? 'var(--border)'}` : 'none',
                transition: 'all .1s',
              }}
            >
              {k !== 'all' && <OpIcon kind={k} size={10} />}
              {k === 'all' ? (locale?.startsWith('zh') ? '全部' : 'All') : KIND_LABEL[locale?.startsWith('zh') ? 'zh' : 'en'][k]} <span style={{ opacity: 0.6 }}>({cnt})</span>
            </button>
          );
        })}
      </div>

      {/* Ops list */}
      <div>
        {filtered.map((op, i) => <OpCard key={op.id ?? i} op={op} copy={copy} />)}
      </div>
    </div>
  );
}
