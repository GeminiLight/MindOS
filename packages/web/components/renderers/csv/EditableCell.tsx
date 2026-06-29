'use client';

import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';

interface OpenableUrl {
  href: string;
  display: string;
  external: boolean;
}

const OPENABLE_URL_SCHEMES = /^(https?:\/\/|mailto:)/i;

function parseOpenableUrl(value: string): OpenableUrl | null {
  const href = value.trim();
  if (!OPENABLE_URL_SCHEMES.test(href)) return null;

  try {
    const url = new URL(href);
    if (url.protocol === 'mailto:') {
      return {
        href,
        display: href.replace(/^mailto:/i, 'mailto:'),
        external: false,
      };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        href,
        display: `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}`,
        external: true,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function EditableCell({ value, onCommit }: { value: string; onCommit: (v: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const url = parseOpenableUrl(value);
  function startEdit() {
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    if (draft !== value) {
      void Promise.resolve(onCommit(draft)).catch(() => setDraft(value));
    } else {
      setDraft(value);
    }
  }
  if (editing) return (
    <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
      className="min-w-[60px] w-full border-b border-[var(--amber)] bg-transparent text-sm text-foreground outline-none" onClick={e => e.stopPropagation()}
    />
  );
  if (url) return (
    <div className="flex min-w-[120px] max-w-xs items-center gap-1.5">
      <a
        href={url.href}
        target={url.external ? '_blank' : undefined}
        rel={url.external ? 'noopener noreferrer' : undefined}
        onClick={e => e.stopPropagation()}
        className="min-w-0 flex-1 truncate text-sm text-[var(--amber)] underline-offset-2 transition-colors hover:text-[var(--amber-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={value}
        aria-label={`Open URL ${url.display}`}
      >
        {url.display}
      </a>
      <ExternalLink size={11} aria-hidden="true" className="shrink-0 text-[var(--amber)] opacity-70" />
      <button
        type="button"
        onClick={startEdit}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Edit URL ${url.display}`}
        title="Edit URL"
      >
        <Pencil size={11} aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <div className="min-w-[60px] truncate text-sm text-foreground cursor-text"
      onClick={startEdit} title={value}
    >{value || <span className="text-muted-foreground/30">—</span>}</div>
  );
}

export function AddRowTr({ headers, visibleIndices, onAdd, onCancel }: { headers: string[]; visibleIndices: number[]; onAdd: (r: string[]) => void | Promise<void>; onCancel: () => void }) {
  const [vals, setVals] = useState(() => Array(headers.length).fill(''));
  function set(i: number, v: string) { setVals(prev => { const n = [...prev]; n[i] = v; return n; }); }
  return (
    <tr className="border-t border-[var(--amber)] bg-[var(--amber-subtle)]">
      {visibleIndices.map((ci, pos) => (
        <td key={ci} className="border-b border-border px-3 py-2">
          <input autoFocus={pos === 0} value={vals[ci]} onChange={e => set(ci, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void Promise.resolve(onAdd(vals)).catch(() => {}); if (e.key === 'Escape') onCancel(); }}
            placeholder={headers[ci]} className="w-full border-b border-border bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/30"
          />
        </td>
      ))}
      <td className="border-b border-border px-2 py-2" />
    </tr>
  );
}
