'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/stores/locale-store';
import { FolderSync, PenLine, BarChart3, Sparkles, ArrowUpRight } from 'lucide-react';
import OnboardingView from './OnboardingView';
import Logo from './Logo';
import GuideCard from './GuideCard';
import AskContent from '@/components/ask/AskContent';
import type { SpaceInfo } from '@/app/page';

interface RecentFile {
  path: string;
  mtime: number;
}

function injectAskInput(text: string) {
  window.dispatchEvent(new CustomEvent('mindos:home-suggestion', { detail: { text } }));
}

const TAB_ICONS = [FolderSync, PenLine, BarChart3, Sparkles];

export default function HomeContent({ recent, existingFiles, spaces }: { recent: RecentFile[]; existingFiles?: string[]; spaces?: SpaceInfo[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);
  const [maximized, setMaximized] = useState(false);

  const toggleMaximize = useCallback(() => setMaximized(v => !v), []);

  // Auto-fullscreen when user sends the first message in a session
  const handleFirstMessage = useCallback(() => {
    setMaximized(true);
  }, []);

  // Navigate to editor with right-side Ask panel open
  const handleDockToPanel = useCallback(() => {
    const target = recent.length > 0 ? `/view/${recent[0].path}` : '/';
    // Signal the already-mounted SidebarLayout to open the Ask panel
    window.dispatchEvent(new CustomEvent('mindos:open-ask-panel'));
    router.push(target);
  }, [recent, router]);

  if (recent.length === 0) {
    return <OnboardingView />;
  }

  const categories: { label: string; items: { label: string; desc: string; prompt: string }[] }[] =
    (t.ask as Record<string, unknown>)?.homeCategories as typeof categories ?? [];

  const current = categories[activeTab];

  /*
   * Single render tree — AskContent is always mounted in the same position.
   * Normal vs fullscreen is purely a CSS layout change, so chat state is preserved.
   */
  return (
    <div className="flex flex-col h-[100dvh]">

      {/* ── Landing chrome: hidden when maximized ── */}
      {!maximized && (
        <>
          {/* Guide Card */}
          <div className="flex-shrink-0 px-4 md:px-6 pt-4 pb-6">
            <div className="max-w-4xl mx-auto">
              <GuideCard />
            </div>
          </div>

          {/* Spacer top */}
          <div className="flex-1 min-h-0" />

          {/* Hero */}
          <div className="flex-shrink-0 flex flex-col items-center text-center px-4 md:px-6 pb-8">
            <div className="flex items-center gap-4 mb-3">
              <Logo id="home-hero" className="w-10 h-5 opacity-90" />
              <h1 className="text-2xl font-brand leading-none">
                <span className="text-foreground">Mind</span><span className="text-[var(--amber)]">OS</span>
              </h1>
            </div>
            <p className="text-sm text-muted-foreground/50 max-w-sm leading-relaxed">
              {t.app.tagline}
            </p>
          </div>
        </>
      )}

      {/* ── Chatbot area: always mounted, layout changes with maximized ── */}
      <div
        className={
          maximized
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : 'flex-shrink-0 px-4 md:px-6 flex justify-center'
        }
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
        onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.stopPropagation(); } }}
        onDrop={(e) => { e.stopPropagation(); }}
      >
        <div className={maximized ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'w-full max-w-4xl'}>
          <div
            data-walkthrough="ask-button"
            className={maximized ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'rounded-xl border border-border/70 shadow-sm overflow-hidden flex flex-col max-h-[50vh]'}
          >
            <AskContent
              visible={true}
              variant="home"
              maximized={maximized}
              onMaximize={toggleMaximize}
              onFirstMessage={handleFirstMessage}
              onDockToPanel={handleDockToPanel}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom chrome: hidden when maximized ── */}
      {!maximized && (
        <>
          {/* Tabs + Prompt Grid */}
          {categories.length > 0 && current && (
            <div className="flex-shrink-0 flex justify-center px-4 md:px-6 pt-6">
              <div className="w-full max-w-4xl">

                {/* Pill Tabs */}
                <div className="flex items-center justify-center gap-1.5 mb-5" role="tablist">
                  {categories.map((cat, i) => {
                    const Icon = TAB_ICONS[i % TAB_ICONS.length];
                    const isActive = i === activeTab;
                    return (
                      <button
                        key={cat.label}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveTab(i)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full transition-all duration-150 ${
                          isActive
                            ? 'bg-[var(--amber)]/12 text-[var(--amber)]'
                            : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40'
                        }`}
                      >
                        <Icon size={13} />
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Prompt Cards — 2x2 grid */}
                <div className="grid grid-cols-2 gap-2" role="tabpanel">
                  {current.items.map((item, i) => (
                    <button
                      key={`${activeTab}-${i}`}
                      type="button"
                      onClick={() => injectAskInput(item.prompt)}
                      className="group relative text-left px-4 py-3.5 rounded-xl border border-border/30 hover:border-border/60 transition-all duration-150 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-foreground/90 leading-snug mb-0.5">{item.label}</div>
                          <div className="text-xs text-muted-foreground/60 leading-relaxed">{item.desc}</div>
                        </div>
                        <ArrowUpRight size={14} className="shrink-0 mt-0.5 text-muted-foreground/20 group-hover:text-[var(--amber)] transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Spacer bottom */}
          <div className="flex-1 min-h-0" />

          {/* Footer */}
          <div className="flex-shrink-0 py-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/20">
            <Logo id="home-footer" className="w-4 h-2 opacity-20" />
            <span>{t.app.footer}</span>
          </div>
        </>
      )}
    </div>
  );
}
