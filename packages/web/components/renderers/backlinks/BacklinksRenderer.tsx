'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ExternalLink } from 'lucide-react';
import { encodePath } from '@/lib/utils';
import type { RendererContext } from '@/lib/renderers/registry';
import { apiFetch } from '@/lib/api';

interface BacklinkItem {
  filePath: string;
  snippets: string[];
}

function basename(p: string) {
  return p.split('/').pop()?.replace(/\.md$/, '') ?? p;
}

function dirname(p: string) {
  const parts = p.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

// Highlight [[...]] and [text](url) references in snippet
function SnippetLine({ text }: { text: string }) {
  // Replace wikilinks and md links with styled spans
  const parts = text.split(/(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (/^\[\[/.test(part) || /^\[/.test(part)) {
          return <span key={i} style={{ color: 'var(--amber)', fontWeight: 500 }}>{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export function BacklinksRenderer({ filePath }: RendererContext) {
  const router = useRouter();
  const [backlinks, setBacklinks] = useState<BacklinkItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<BacklinkItem[]>(`/api/backlinks?path=${encodeURIComponent(filePath)}`)
      .then((data) => { setBacklinks(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filePath]);

  if (loading) {
    return (
      <div className="font-display" style={{ padding: '3rem 1rem', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>
        Scanning backlinks…
      </div>
    );
  }

  const items = backlinks ?? [];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 0' }}>
      {/* header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="font-display" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
          {items.length === 0 ? 'No backlinks found' : `${items.length} file${items.length === 1 ? '' : 's'} link here`}
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{
          border: '1px dashed var(--border)',
          borderRadius: 10,
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          fontSize: 13,
        }}>
          <FileText size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
          <p className="font-display" style={{ fontSize: 12 }}>
            No other files link to <strong style={{ color: 'var(--foreground)' }}>{basename(filePath)}</strong> yet.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(({ filePath: src, snippets }) => {
            const name = basename(src);
            const dir = dirname(src);
            return (
              <div
                key={src}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'border-color .15s',
                }}
                onClick={() => router.push('/view/' + encodePath(src))}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(200,135,58,0.4)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                {/* file header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderBottom: snippets.length > 0 ? '1px solid var(--border)' : 'none',
                  background: 'var(--muted)',
                }}>
                  <FileText size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  {dir && (
                    <span className="font-display" style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)', opacity: 0.6, flexShrink: 0 }}>
                      {dir}
                    </span>
                  )}
                  <ExternalLink size={11} style={{ color: 'var(--muted-foreground)', opacity: 0.5, flexShrink: 0 }} />
                </div>

                {/* snippets */}
                {snippets.map((snippet: string, i: number) => (
                  <div key={i} style={{
                    padding: '8px 14px',
                    borderBottom: i < snippets.length - 1 ? '1px solid var(--border)' : 'none',
                    background: 'var(--background)',
                  }}>
                    {snippet.split('\n').map((line: string, j: number) => (
                      <div key={j} className="font-display" style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        <SnippetLine text={line} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
