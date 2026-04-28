'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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
  const summaryHtml = useMemo(() => renderMarkdown(summary), [summary]);

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
    <div className="max-w-[720px] mx-auto py-6">
      {/* header row */}
      <div className="flex items-center gap-2.5 mb-6 flex-wrap">
        <span className="font-display text-[11px] text-muted-foreground">
          {recentFiles.length > 0
            ? `${recentFiles.length} recently modified files`
            : 'Loading recent files…'}
        </span>
        <button
          onClick={generate}
          disabled={streaming || recentFiles.length === 0}
          className={`font-display summary-gen-btn ${streaming ? 'summary-gen-btn--busy' : ''}`}
        >
          {streaming ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {streaming ? 'Generating…' : generated ? 'Regenerate' : 'Generate briefing'}
        </button>
      </div>

      {/* source files */}
      {recentFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {recentFiles.map(f => (
            <a
              key={f.path}
              href={`/view/${encodePath(f.path)}`}
              className="font-display summary-source-chip"
              title={f.path}
            >
              <FileText size={10} />
              {basename(f.path)}
              <span className="opacity-50">
                <Clock size={9} className="inline ml-0.5" />
                {' '}{relativeTime(f.mtime)}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* error */}
      {error && (
        <div className="font-display px-3.5 py-2.5 rounded-lg bg-[var(--error)]/10 border border-[var(--error)]/30 text-[var(--error)] text-xs mb-4">
          {error}
        </div>
      )}

      {/* summary output */}
      {summary ? (
        <div className="bg-card border border-border rounded-[10px] px-5 py-[18px] relative">
          {streaming && (
            <div className="absolute top-3 right-3.5 w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse" />
          )}
          <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
        </div>
      ) : !streaming && !generated && recentFiles.length > 0 ? (
        <div className="border border-dashed border-border rounded-[10px] px-6 py-10 text-center text-muted-foreground">
          <Sparkles size={28} className="mx-auto mb-2.5 opacity-30 text-[var(--amber)]" />
          <p className="font-display text-xs">
            Click <strong className="text-foreground">Generate briefing</strong> to summarize recent changes with AI.
          </p>
        </div>
      ) : null}

      {/* CSS for custom classes (can't use Tailwind for generated HTML) */}
      <style>{`
        .summary-gen-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 14px; border-radius: 7px; font-size: 12px;
          cursor: pointer; border: none;
          background: var(--amber); color: var(--amber-foreground);
          transition: opacity .15s;
        }
        .summary-gen-btn:disabled { cursor: not-allowed; opacity: 0.5; }
        .summary-gen-btn--busy { background: var(--muted); color: var(--muted-foreground); }
        .summary-source-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 10px; border-radius: 999px; font-size: 0.7rem;
          background: var(--muted); color: var(--muted-foreground);
          text-decoration: none; border: 1px solid var(--border);
          transition: color .15s;
        }
        .summary-source-chip:hover { color: var(--foreground); }
      `}</style>
    </div>
  );
}
