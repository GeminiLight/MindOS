'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Globe, BookOpen, FileText, Loader2, GitBranch } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';

type Template = 'en' | 'zh' | 'empty';

const TEMPLATES: Array<{
  id: Template;
  icon: React.ReactNode;
  dirs: string[];
}> = [
  {
    id: 'en',
    icon: <Globe size={20} />,
    dirs: ['Profile/', 'Connections/', 'Notes/', 'Workflows/', 'Resources/', 'Projects/'],
  },
  {
    id: 'zh',
    icon: <BookOpen size={20} />,
    dirs: ['画像/', '关系/', '笔记/', '流程/', '资源/', '项目/'],
  },
  {
    id: 'empty',
    icon: <FileText size={20} />,
    dirs: ['README.md', 'CONFIG.json', 'INSTRUCTION.md'],
  },
];

export default function OnboardingView() {
  const { t } = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState<Template | null>(null);

  const ob = t.onboarding;

  async function handleSelect(template: Template) {
    setLoading(template);
    try {
      const res = await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      console.error('[Onboarding] init failed:', e);
      setLoading(null);
    }
  }

  return (
    <div className="content-width px-4 md:px-6 py-12 md:py-20">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 mb-4">
          <Sparkles size={18} style={{ color: 'var(--amber)' }} />
          <h1
            className="text-2xl font-semibold tracking-tight font-display"
            style={{ color: 'var(--foreground)' }}
          >
            MindOS
          </h1>
        </div>
        <p
          className="text-sm leading-relaxed max-w-md mx-auto"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {ob.subtitle}
        </p>
      </div>

      {/* Template cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
        {TEMPLATES.map((tpl) => {
          const isLoading = loading === tpl.id;
          const isDisabled = loading !== null;
          return (
            <button
              key={tpl.id}
              disabled={isDisabled}
              onClick={() => handleSelect(tpl.id)}
              className="group relative flex flex-col items-start gap-3 p-5 rounded-xl border text-left transition-all duration-150 hover:border-amber-500/50 hover:bg-amber-500/5 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              {/* Icon + title */}
              <div className="flex items-center gap-2.5 w-full">
                <span style={{ color: 'var(--amber)' }}>{tpl.icon}</span>
                <span
                  className="text-sm font-semibold"
                  style={{ color: 'var(--foreground)' }}
                >
                  {ob.templates[tpl.id].title}
                </span>
                {isLoading && (
                  <Loader2 size={14} className="animate-spin ml-auto" style={{ color: 'var(--amber)' }} />
                )}
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                {ob.templates[tpl.id].desc}
              </p>

              {/* Directory preview */}
              <div
                className="w-full rounded-lg px-3 py-2 text-xs leading-relaxed font-display"
                style={{
                  background: 'var(--muted)',
                  color: 'var(--muted-foreground)',
                  opacity: 0.8,
                }}
              >
                {tpl.dirs.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Import hint */}
      <p
        className="text-center text-xs leading-relaxed max-w-sm mx-auto font-display"
        style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}
      >
        {ob.importHint}
      </p>

      {/* Sync hint card */}
      <div
        className="max-w-md mx-auto mt-6 flex items-center gap-3 px-4 py-3 rounded-lg border text-left"
        style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
      >
        <GitBranch size={16} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
        <div className="min-w-0">
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {ob.syncHint ?? 'Want cross-device sync? Run'}
            {' '}
            <code
              className="font-mono px-1 py-0.5 rounded select-all"
              style={{ background: 'var(--muted)', fontSize: '11px' }}
            >
              mindos sync init
            </code>
            {' '}
            {ob.syncHintSuffix ?? 'in the terminal after setup.'}
          </p>
        </div>
      </div>
    </div>
  );
}
