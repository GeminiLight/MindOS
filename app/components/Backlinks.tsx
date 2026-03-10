'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Link as LinkIcon, FileText } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';

interface BacklinkEntry {
  filePath: string;
  snippets: string[];
}

export default function Backlinks({ filePath }: { filePath: string }) {
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLocale();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/backlinks?path=${encodeURIComponent(filePath)}`)
      .then(res => res.json())
      .then(data => {
        setBacklinks(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch backlinks:', err);
        setLoading(false);
      });
  }, [filePath]);

  if (!loading && backlinks.length === 0) return null;

  return (
    <div className="mt-12 pt-8 border-t border-border">
      <div className="flex items-center gap-2 mb-6 text-muted-foreground">
        <LinkIcon size={16} className="text-amber-500/70" />
        <h3 className="text-sm font-semibold tracking-wider uppercase" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {t.common?.relatedFiles || 'Related Files'}
        </h3>
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full font-mono">
          {backlinks.length}
        </span>
      </div>

      <div className="grid gap-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-20 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          backlinks.map((link) => (
            <Link
              key={link.filePath}
              href={`/view/${link.filePath.split('/').map(encodeURIComponent).join('/')}`}
              className="group block p-4 rounded-xl border border-border/50 bg-card/30 hover:bg-muted/30 hover:border-amber-500/30 transition-all duration-200"
            >
              <div className="flex items-start gap-3">
                <div className="mt-1 p-1.5 rounded-md bg-muted group-hover:bg-amber-500/10 transition-colors">
                  <FileText size={14} className="text-muted-foreground group-hover:text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-foreground group-hover:text-amber-500 transition-colors truncate mb-1">
                    {link.filePath}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed italic opacity-80 group-hover:opacity-100 transition-opacity">
                    {link.snippets[0] || ''}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
