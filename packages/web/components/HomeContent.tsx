'use client';

import { useState, useCallback, useId, useRef } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import { FolderSync, PenLine, BarChart3, Sparkles, ArrowUpRight, FileText, ChevronDown } from 'lucide-react';
import OnboardingView from './OnboardingView';
import Link from 'next/link';
import GuideCard from './GuideCard';
import ChatContent from '@/components/chat/ChatContent';
import type { SpaceInfo } from '@/lib/space-records';
import type { GuideBootstrap } from './guide-state-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { encodePath } from '@/lib/utils';

interface RecentFile {
  path: string;
  mtime: number;
}

function recentFileDate(mtime: number, locale: string): { iso: string; label: string } | null {
  const date = new Date(mtime);
  if (!Number.isFinite(mtime) || mtime <= 0 || Number.isNaN(date.valueOf())) return null;
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
      year: 'numeric', month: 'short', day: 'numeric',
    }).format(date),
  };
}

function injectAskInput(text: string) {
  window.dispatchEvent(new CustomEvent('mindos:home-suggestion', { detail: { text } }));
}

const TAB_ICONS = [FolderSync, PenLine, BarChart3, Sparkles];

export default function HomeContent({ recent, recentNotes, existingFiles, spaces, initialAiConfigured, initialGuide }: { recent: RecentFile[]; recentNotes?: RecentFile[]; existingFiles?: string[]; spaces?: SpaceInfo[]; initialAiConfigured?: boolean; initialGuide?: GuideBootstrap }) {
  const { t, locale } = useLocale();
  const smoothPush = useSmoothRouterPush();
  const [activeTab, setActiveTab] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(recent.length === 0);
  const [maximized, setMaximized] = useState(false);
  const tabsId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasKnowledge = recent.length > 0 || (existingFiles?.length ?? 0) > 0 || (spaces?.length ?? 0) > 0;
  const displayedRecentNotes = recentNotes ?? recent.slice(0, 3);

  const toggleMaximize = useCallback(() => setMaximized(v => !v), []);

  // Navigate to editor with right-side Ask panel open
  const handleDockToPanel = useCallback(() => {
    const firstPath = recent[0]?.path ?? existingFiles?.[0];
    const target = firstPath ? `/view/${encodePath(firstPath)}` : '/';
    // Signal the already-mounted SidebarLayout to open the Ask panel
    window.dispatchEvent(new CustomEvent('mindos:open-ask-panel'));
    smoothPush(target);
  }, [existingFiles, recent, smoothPush]);

  if (!hasKnowledge) {
    return <OnboardingView />;
  }

  const categories: { label: string; items: { label: string; desc: string; prompt: string }[] }[] =
    (t.ask as Record<string, unknown>)?.homeCategories as typeof categories ?? [];

  const current = categories[activeTab];

  /*
   * Single render tree — ChatContent is always mounted in the same position.
   * Normal vs fullscreen is purely a CSS layout change, so chat state is preserved.
   */
  return (
    <div className={maximized
      ? 'fixed inset-x-0 bottom-0 top-[calc(var(--app-titlebar-h)+var(--mobile-header-height))] z-20 flex flex-col bg-background p-3 md:left-[var(--content-left-offset)] md:top-[var(--app-titlebar-h)] md:p-4'
      : 'flex flex-col h-[calc(100dvh-var(--app-titlebar-h))]'}>

      {/* ── Landing chrome: hidden when maximized ── */}
      {!maximized && (
        <>
          <div className="flex-shrink-0 px-4 pt-2 pb-1.5 md:px-6 md:pt-6 md:pb-4">
            <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h1 className="text-xl font-display text-foreground">{t.ask.homeHeading}</h1>
              <nav className="flex items-center gap-2" aria-label={t.ask.homeWorkLinks}>
                <Link href="/capture" className="min-h-11 inline-flex items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{t.sidebar.capture}</Link>
                <Link href="/wiki" className="min-h-11 inline-flex items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{t.sidebar.files}</Link>
              </nav>
            </div>
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
        <div
          data-home-focus-shell={maximized ? '' : undefined}
          className={maximized ? 'flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-background shadow-sm' : 'w-full max-w-4xl'}
        >
          <div
            data-walkthrough="ask-button"
            className={maximized ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'home-chat-preview flex min-h-0 max-h-[min(69dvh,27rem)] flex-col overflow-hidden'}
          >
            <ChatContent
              visible={true}
              variant="home"
              initialAiConfigured={initialAiConfigured}
              maximized={maximized}
              onMaximize={toggleMaximize}
              onDockToPanel={handleDockToPanel}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom chrome: hidden when maximized ── */}
      {!maximized && (
        <>
          {/* Keep the continuing conversation before optional setup guidance. */}
          <div className="flex-shrink-0 px-4 pt-3 md:px-6 md:pt-5">
            <div className="max-w-4xl mx-auto">
              <GuideCard hasExistingFiles={hasKnowledge} initialGuide={initialGuide} />
            </div>
          </div>
          {displayedRecentNotes.length > 0 && (
            <section className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-0" aria-label={t.home.recentNotes}>
              <h2 className="mb-2 font-display text-base text-foreground">{t.home.recentNotes}</h2>
              <div className="divide-y divide-border/60">
                {displayedRecentNotes.map(file => {
                  const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
                  const modified = recentFileDate(file.mtime, locale);
                  return (
                    <Link key={file.path} href={`/view/${encodePath(file.path)}`} title={file.path} className="group flex min-h-14 items-center gap-3 rounded-md px-2 py-2.5 text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground"><FileText size={16} aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium leading-5 sm:truncate">{file.path.split('/').pop()}</span>
                        {folder || modified ? <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {folder ? <span className="min-w-0 truncate">{folder}</span> : null}
                          {folder && modified ? <span aria-hidden>·</span> : null}
                          {modified ? <time dateTime={modified.iso} className="shrink-0">{modified.label}</time> : null}
                        </span> : null}
                      </span>
                      <ArrowUpRight size={15} className="shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
          {categories.length > 0 && (
            <div className="mx-auto w-full max-w-4xl px-4 pt-5 md:px-0">
              <button type="button" aria-expanded={showSuggestions} aria-controls={`${tabsId}-suggestions`} onClick={() => setShowSuggestions(v => !v)} className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Sparkles size={14} aria-hidden />{t.home.promptIdeas}
                <ChevronDown size={14} className={showSuggestions ? 'rotate-180' : ''} aria-hidden />
              </button>
            </div>
          )}
          {/* Tabs + Prompt Grid */}
          {showSuggestions && categories.length > 0 && current && (
            <div id={`${tabsId}-suggestions`} className="flex-shrink-0 flex justify-center px-4 md:px-6 pt-3">
              <div className="w-full max-w-4xl">

                {/* Pill Tabs */}
                <div className="-mx-1 -mt-1 mb-5 overflow-x-auto px-1 pt-1 pb-1" role="tablist" aria-label={t.ask.title}>
                  <div className="flex w-max min-w-full items-center justify-start gap-1.5">
                  {categories.map((cat, i) => {
                    const Icon = TAB_ICONS[i % TAB_ICONS.length];
                    const isActive = i === activeTab;
                    return (
                      <button
                        key={cat.label}
                        type="button"
                        role="tab"
                        id={`${tabsId}-tab-${i}`}
                        aria-controls={`${tabsId}-panel`}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        ref={node => { tabRefs.current[i] = node; }}
                        onKeyDown={event => {
                          const target = event.key === 'ArrowRight' ? (i + 1) % categories.length
                            : event.key === 'ArrowLeft' ? (i - 1 + categories.length) % categories.length
                            : event.key === 'Home' ? 0
                            : event.key === 'End' ? categories.length - 1 : null;
                          if (target === null) return;
                          event.preventDefault();
                          setActiveTab(target);
                          tabRefs.current[target]?.focus();
                        }}
                        onClick={() => setActiveTab(i)}
                        data-hit-active={isActive ? 'true' : undefined}
                        className={`hit-target-box flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all duration-150 [--hit-target-radius:9999px] [--hit-target-active-bg:color-mix(in_srgb,var(--amber)_12%,transparent)] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_40%,transparent)] ${
                          isActive
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Icon size={13} />
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                  </div>
                </div>

                {/* Prompt Cards — 2x2 grid */}
                <div id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${activeTab}`} className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tabpanel">
                  {current.items.map((item, i) => (
                    <button
                      key={`${activeTab}-${i}`}
                      type="button"
                      onClick={() => injectAskInput(item.prompt)}
                      className="hit-target-box group relative text-left px-4 py-3.5 border border-transparent transition-all duration-150 [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_30%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_60%,transparent)] [--hit-target-radius:var(--radius-xl)] [--hit-target-hover-shadow:0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-foreground/90 leading-snug mb-0.5">{item.label}</div>
                          <div className="text-xs text-muted-foreground leading-relaxed">{item.desc}</div>
                        </div>
                        <ArrowUpRight size={14} className="shrink-0 mt-0.5 text-muted-foreground group-hover:text-foreground transition-colors" aria-hidden />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="h-6 shrink-0" aria-hidden />
        </>
      )}
    </div>
  );
}
