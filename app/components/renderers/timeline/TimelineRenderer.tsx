'use client';

import { useMemo } from 'react';
import type { RendererContext } from '@/lib/renderers/registry';

// ─── Parser ───────────────────────────────────────────────────────────────────

interface TimelineEntry {
  heading: string;
  date: Date | null;
  body: string; // raw markdown lines joined
  tags: string[];
}

// Detect date-like H2 headings: ## 2025-01-15, ## Jan 2025, ## 2025/01/15, etc.
const DATE_RE = /(\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|[A-Za-z]+ \d{4}|\d{4}年\d{1,2}月(?:\d{1,2}日)?)/;

function parseDate(s: string): Date | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const d = new Date(m[1].replace(/[/年月]/g, '-').replace('日', ''));
  return isNaN(d.getTime()) ? null : d;
}

// Extract #tag or **tag** markers from body text
function extractTags(body: string): string[] {
  const tags: string[] = [];
  const hashTags = body.match(/#([\w\u4e00-\u9fff]+)/g);
  if (hashTags) tags.push(...hashTags.map(t => t.slice(1)));
  return [...new Set(tags)];
}

function parseTimeline(content: string): TimelineEntry[] {
  const lines = content.split('\n');
  const entries: TimelineEntry[] = [];
  let current: TimelineEntry | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (!current) return;
    const body = bodyLines.join('\n').trim();
    current.body = body;
    current.tags = extractTags(body);
    entries.push(current);
    current = null;
    bodyLines = [];
  };

  for (const line of lines) {
    // H1 is the document title — skip
    if (/^# /.test(line)) continue;

    // H2 = timeline entry
    if (/^## /.test(line)) {
      flush();
      const heading = line.slice(3).trim();
      current = { heading, date: parseDate(heading), body: '', tags: [] };
      continue;
    }

    if (current) bodyLines.push(line);
  }
  flush();

  return entries;
}

// ─── Markdown inline renderer (no extra dep) ──────────────────────────────────

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="font-display" style="font-size:0.85em;padding:1px 5px;border-radius:4px;background:var(--muted)">$1</code>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
      `<span style="color:var(--amber);cursor:pointer" title="${target}">${alias ?? target}</span>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--amber)">$1</a>');
}

function renderBody(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) { closeList(); out.push('<br/>'); continue; }

    if (/^### /.test(line)) { closeList(); out.push(`<h3 style="font-size:0.8rem;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.06em;margin:.9em 0 .3em">${renderInline(line.slice(4))}</h3>`); continue; }
    if (/^- /.test(line) || /^\* /.test(line)) {
      if (!inList) { out.push('<ul style="margin:.3em 0;padding-left:1.2em;list-style:disc">'); inList = true; }
      out.push(`<li style="margin:.15em 0;font-size:.82rem;color:var(--foreground)">${renderInline(line.slice(2))}</li>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      if (!inList) { out.push('<ol style="margin:.3em 0;padding-left:1.2em">'); inList = true; }
      out.push(`<li style="margin:.15em 0;font-size:.82rem;color:var(--foreground)">${renderInline(line.replace(/^\d+\. /, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="margin:.25em 0;font-size:.82rem;line-height:1.6;color:var(--foreground)">${renderInline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

// ─── Tag color ────────────────────────────────────────────────────────────────

const TAG_PALETTE = [
  { bg: 'rgba(200,135,58,0.12)', text: 'var(--amber)' },
  { bg: 'rgba(122,173,128,0.12)', text: '#7aad80' },
  { bg: 'rgba(138,180,216,0.12)', text: '#8ab4d8' },
  { bg: 'rgba(200,160,216,0.12)', text: '#c8a0d8' },
];
function tagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimelineRenderer({ content }: RendererContext) {
  const entries = useMemo(() => parseTimeline(content), [content]);

  if (entries.length === 0) {
    return (
      <div className="font-display" style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
        No timeline entries found. Add <code style={{ background: 'var(--muted)', padding: '1px 6px', borderRadius: 4 }}>## 2025-01-15</code> headings to create entries.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* count pill */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="font-display" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {/* timeline */}
      <div style={{ position: 'relative', paddingLeft: 28 }}>
        {/* vertical line */}
        <div style={{ position: 'absolute', left: 6, top: 8, bottom: 8, width: 1, background: 'var(--border)' }} />

        {entries.map((entry, idx) => (
          <div key={idx} style={{ position: 'relative', marginBottom: '1.5rem' }}>
            {/* dot */}
            <div style={{
              position: 'absolute',
              left: -22,
              top: 10,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: entry.date ? 'var(--amber)' : 'var(--border)',
              outline: entry.date ? '2px solid var(--amber-dim)' : 'none',
              zIndex: 1,
            }} />

            {/* card */}
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '14px 18px',
              transition: 'border-color .15s',
            }}>
              {/* header */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)' }}>
                  {entry.heading}
                </span>
                {entry.date && (
                  <span className="font-display" style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', opacity: 0.7, flexShrink: 0 }}>
                    {formatDate(entry.date)}
                  </span>
                )}
              </div>

              {/* body */}
              {entry.body && (
                <div dangerouslySetInnerHTML={{ __html: renderBody(entry.body) }} />
              )}

              {/* tags */}
              {entry.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                  {entry.tags.map(tag => {
                    const c = tagColor(tag);
                    return (
                      <span key={tag} className="font-display" style={{ fontSize: '0.68rem', padding: '1px 8px', borderRadius: 999, background: c.bg, color: c.text }}>
                        #{tag}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
