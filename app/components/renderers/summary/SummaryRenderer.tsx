'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, RefreshCw, Clock, FileText } from 'lucide-react';
import { encodePath } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import type { RendererContext } from '@/lib/renderers/registry';

interface RecentFile {
  path: string;
  mtime: number;
}

function relativeTime(mtime: number): string {
  const diff = Date.now() - mtime;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function basename(p: string) {
  return p.split('/').pop()?.replace(/\.(md|csv)$/, '') ?? p;
}

// Minimal markdown→HTML for the streamed summary
function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="font-size:.8rem;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.06em;margin:1em 0 .3em">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:.9rem;font-weight:700;color:var(--foreground);margin:1.2em 0 .4em">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:1rem;font-weight:700;color:var(--foreground);margin:1.2em 0 .4em">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="font-display" style="font-size:.82em;padding:1px 5px;border-radius:4px;background:var(--muted)">$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li style="margin:.2em 0;padding-left:.3em">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, s => `<ul style="margin:.4em 0;padding-left:1.4em;list-style:disc">${s}</ul>`)
    .replace(/\n{2,}/g, '</p><p style="margin:.5em 0;font-size:.85rem;line-height:1.7;color:var(--foreground)">')
    .replace(/^(?!<[hulo])(.+)$/gm, '<p style="margin:.5em 0;font-size:.85rem;line-height:1.7;color:var(--foreground)">$1</p>');
}

const LIMIT = 8;

export function SummaryRenderer({ filePath }: RendererContext) {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [summary, setSummary] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch recent files once
  useEffect(() => {
    apiFetch<RecentFile[]>(`/api/recent-files?limit=${LIMIT}`)
      .then((data) => setRecentFiles(data.filter(f => f.path.endsWith('.md'))))
      .catch((err) => { console.warn("[SummaryRenderer] fetch recent-files failed:", err); });
  }, [filePath]);

  async function generate() {
    if (recentFiles.length === 0) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSummary('');
    setError('');
    setStreaming(true);
    setGenerated(false);

    const attachedFiles = recentFiles.map(f => f.path);
    const fileListMd = recentFiles
      .map(f => `- **${basename(f.path)}** (${f.path}, modified ${relativeTime(f.mtime)})`)
      .join('\n');

    const prompt = `You are summarizing recent changes in a personal knowledge base (MindOS).

The following files were recently modified:
${fileListMd}

Please provide a concise daily briefing in this format:
1. **Key changes**: What was added or updated in each file (1–2 sentences per file)
2. **Themes**: Any patterns or recurring topics across the changes
3. **Suggested next actions**: 2–3 actionable follow-ups based on the content

Be specific. Reference actual content from the files. Keep the total response under 300 words.`;

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          attachedFiles,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Vercel AI SDK text stream: each chunk may have "0:..." prefix
        const raw = decoder.decode(value, { stream: true });
        for (const line of raw.split('\n')) {
          const m = line.match(/^0:"((?:[^"\\]|\\.)*)"$/);
          if (m) {
            acc += m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          } else if (line && !line.startsWith('d:') && !line.startsWith('e:') && !line.startsWith('0:')) {
            // plain text stream fallback
            acc += line;
          }
        }
        setSummary(acc);
      }
      setGenerated(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || 'Failed to generate summary');
      }
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <span className="font-display" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
          {recentFiles.length > 0
            ? `${recentFiles.length} recently modified files`
            : 'Loading recent files…'}
        </span>
        <button
          onClick={generate}
          disabled={streaming || recentFiles.length === 0}
          className="font-display"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 14px',
            borderRadius: 7,
            fontSize: 12,
            cursor: streaming || recentFiles.length === 0 ? 'not-allowed' : 'pointer',
            border: 'none',
            background: streaming ? 'var(--muted)' : 'var(--amber)',
            color: streaming ? 'var(--muted-foreground)' : 'var(--amber-foreground)',
            opacity: recentFiles.length === 0 ? 0.5 : 1,
            transition: 'opacity .15s',
          }}
        >
          {streaming ? (
            <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Sparkles size={12} />
          )}
          {streaming ? 'Generating…' : generated ? 'Regenerate' : 'Generate briefing'}
        </button>
      </div>

      {/* source files */}
      {recentFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '1.5rem' }}>
          {recentFiles.map(f => (
            <a
              key={f.path}
              href={`/view/${encodePath(f.path)}`}
              className="font-display"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: '0.7rem',
                background: 'var(--muted)',
                color: 'var(--muted-foreground)',
                textDecoration: 'none',
                border: '1px solid var(--border)',
                transition: 'color .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--foreground)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
              title={f.path}
            >
              <FileText size={10} />
              {basename(f.path)}
              <span style={{ opacity: 0.5 }}>
                <Clock size={9} style={{ display: 'inline', marginLeft: 2 }} />
                {' '}{relativeTime(f.mtime)}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* error */}
      {error && (
        <div className="font-display" style={{ padding: '10px 14px', borderRadius: 8, background: 'color-mix(in srgb, var(--error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)', color: 'var(--error)', fontSize: 12, marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* summary output */}
      {summary ? (
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '18px 20px',
          position: 'relative',
        }}>
          {streaming && (
            <div style={{ position: 'absolute', top: 12, right: 14, width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse 1.2s ease-in-out infinite' }} />
          )}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
        </div>
      ) : !streaming && !generated && recentFiles.length > 0 ? (
        <div style={{
          border: '1px dashed var(--border)',
          borderRadius: 10,
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
        }}>
          <Sparkles size={28} style={{ margin: '0 auto 10px', opacity: 0.3, color: 'var(--amber)' }} />
          <p className="font-display" style={{ fontSize: 12 }}>
            Click <strong style={{ color: 'var(--foreground)' }}>Generate briefing</strong> to summarize recent changes with AI.
          </p>
        </div>
      ) : null}

      {/* CSS keyframes injected inline */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
      `}</style>
    </div>
  );
}
