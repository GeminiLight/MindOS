'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Globe, BookOpen, FileText, Loader2, GitBranch, AlertCircle } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);

  const ob = t.onboarding;

  async function handleSelect(template: Template) {
    setLoading(template);
    setError(null);
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
      setError(e instanceof Error ? e.message : 'Unknown error');
      setLoading(null);
    }
  }

  return (
    <div className="content-width px-4 md:px-6 py-12 md:py-20">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 mb-4">
          <Sparkles size={18} className="text-[var(--amber)]" />
          <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">
            MindOS
          </h1>
        </div>
        <p className="text-sm leading-relaxed max-w-md mx-auto text-muted-foreground">
          {ob.subtitle}
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="max-w-2xl mx-auto mb-6 flex items-center gap-2.5 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{ob.initError ?? 'Initialization failed. Please try again.'}</span>
          <button
            onClick={() => setError(null)}
            className="text-xs underline shrink-0 hover:opacity-80"
          >
            {ob.dismiss ?? 'Dismiss'}
          </button>
        </div>
      )}

      {/* Template cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
        {TEMPLATES.map((tpl) => {
          const isLoading = loading === tpl.id;
          const isDisabled = loading !== null;
          return (
            <button
              key={tpl.id}
              disabled={isDisabled}
              title={isDisabled ? "Another template is being initialized" : undefined}
              onClick={() => handleSelect(tpl.id)}
              className="group relative flex flex-col items-start gap-3 p-5 rounded-xl border border-border bg-card text-left transition-all duration-150 hover:border-[var(--amber)]/50 hover:bg-[var(--amber)]/5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {/* Icon + title */}
              <div className="flex items-center gap-2.5 w-full">
                <span className="text-[var(--amber)]">{tpl.icon}</span>
                <span className="text-sm font-semibold text-foreground">
                  {ob.templates[tpl.id].title}
                </span>
                {isLoading && (
                  <Loader2 size={14} className="animate-spin ml-auto text-[var(--amber)]" />
                )}
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {ob.templates[tpl.id].desc}
              </p>

              {/* Directory preview */}
              <div className="w-full rounded-lg px-3 py-2 text-xs leading-relaxed font-display bg-muted text-muted-foreground opacity-80">
                {tpl.dirs.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Import hint */}
      <p className="text-center text-xs leading-relaxed max-w-sm mx-auto font-display text-muted-foreground opacity-60">
        {ob.importHint}
      </p>
      <p className="text-center mt-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('mindos:open-import'))}
          className="text-xs text-[var(--amber-text)] hover:underline transition-colors"
        >
          {t.fileImport.onboardingHint}
        </button>
      </p>

      {/* Sync hint card */}
      <div className="max-w-md mx-auto mt-6 flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card text-left">
        <GitBranch size={16} className="text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {ob.syncHint ?? 'Want cross-device sync? Run'}
            {' '}
            <code className="font-mono px-1 py-0.5 rounded select-all bg-muted text-[11px]">
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
