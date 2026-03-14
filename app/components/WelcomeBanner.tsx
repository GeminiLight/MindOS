'use client';

import { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';

export default function WelcomeBanner() {
  const { t } = useLocale();
  const s = t.setup;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show banner if ?welcome=1 is in the URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') {
      setVisible(true);
      // Remove ?welcome=1 from URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete('welcome');
      const newUrl = url.pathname + (url.searchParams.size > 0 ? '?' + url.searchParams.toString() : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="mb-6 rounded-xl border px-5 py-4 flex items-start gap-4"
      style={{ background: 'var(--amber-subtle, rgba(200,135,30,0.08))', borderColor: 'var(--amber)' }}>
      <Sparkles size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
          {s.welcomeTitle}
        </p>
        <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--muted-foreground)' }}>
          {s.welcomeDesc}
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/setup?force=1" className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
            {s.welcomeLinkReconfigure}
          </a>
          <button onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }))}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
            {s.welcomeLinkAskAI}
          </button>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }))}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
            {s.welcomeLinkMCP}
          </button>
        </div>
      </div>
      <button onClick={() => setVisible(false)}
        className="p-1 rounded hover:bg-muted transition-colors shrink-0"
        style={{ color: 'var(--muted-foreground)' }}>
        <X size={14} />
      </button>
    </div>
  );
}
