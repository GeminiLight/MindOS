'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Sparkles, FolderOpen, MessageCircle, RefreshCw, Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from '@/lib/LocaleContext';
import { openAskModal } from '@/hooks/useAskModal';
import { extractEmoji, stripEmoji } from '@/lib/utils';
import { walkthroughSteps } from './walkthrough/steps';
import type { GuideState } from '@/lib/settings';
import type { SpaceInfo } from '@/app/page';

interface RecentFile {
  path: string;
  mtime: number;
}

interface GuideCardProps {
  /** Called when user clicks a file/dir to open it in FileView */
  onNavigate?: (path: string) => void;
  /** Existing spaces for dynamic directory listing */
  spaces?: SpaceInfo[];
  /** Recent files for empty-template fallback */
  recentFiles?: RecentFile[];
}

export default function GuideCard({ onNavigate, spaces = [], recentFiles = [] }: GuideCardProps) {
  const { t } = useLocale();
  const g = t.guide;

  const [guideState, setGuideState] = useState<GuideState | null>(null);
  const [expanded, setExpanded] = useState<'kb' | 'ai' | 'sync' | null>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [browsedCount, setBrowsedCount] = useState(0);

  // Fetch guide state from backend
  const fetchGuideState = useCallback(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        const gs = data.guideState;
        if (gs?.active && !gs.dismissed) {
          setGuideState(gs);
          if (gs.step1Done) setBrowsedCount(1);
        } else {
          setGuideState(null);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchGuideState();

    const handleFirstVisit = () => { setIsFirstVisit(true); };
    window.addEventListener('mindos:first-visit', handleFirstVisit);

    const handleGuideUpdate = () => fetchGuideState();
    window.addEventListener('focus', handleGuideUpdate);
    window.addEventListener('guide-state-updated', handleGuideUpdate);
    return () => {
      window.removeEventListener('mindos:first-visit', handleFirstVisit);
      window.removeEventListener('focus', handleGuideUpdate);
      window.removeEventListener('guide-state-updated', handleGuideUpdate);
    };
  }, [fetchGuideState]);

  useEffect(() => {
    if (isFirstVisit && guideState && !guideState.step1Done) {
      setExpanded('kb');
    }
  }, [isFirstVisit, guideState]);

  const patchGuide = useCallback((patch: Partial<GuideState>) => {
    setGuideState(prev => prev ? { ...prev, ...patch } : prev);
    fetch('/api/setup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guideState: patch }),
    }).catch(() => {});
  }, []);

  const handleDismiss = useCallback(() => {
    patchGuide({ dismissed: true });
    setGuideState(null);
  }, [patchGuide]);

  const handleFileOpen = useCallback((path: string) => {
    onNavigate?.(path);
    if (browsedCount === 0) {
      setBrowsedCount(1);
      patchGuide({ step1Done: true });
      setTimeout(() => setExpanded(null), 300);
    }
  }, [browsedCount, patchGuide, onNavigate]);

  const handleSkipKB = useCallback(() => {
    setBrowsedCount(1);
    patchGuide({ step1Done: true });
    setExpanded(null);
  }, [patchGuide]);

  const handleStartAI = useCallback(() => {
    const gs = guideState;
    const isEmpty = gs?.template === 'empty';
    const prompt = isEmpty ? g.ai.promptEmpty : g.ai.prompt;
    openAskModal(prompt, 'guide');
  }, [guideState, g]);

  const handleNextStepClick = useCallback(() => {
    if (!guideState) return;
    const idx = guideState.nextStepIndex;
    const steps = g.done.steps;
    if (idx < steps.length) {
      openAskModal(steps[idx].prompt, 'guide-next');
      patchGuide({ nextStepIndex: idx + 1 });
    }
  }, [guideState, g, patchGuide]);

  const handleSyncClick = useCallback(() => {
    // Open settings directly to the Sync tab (SidebarLayout listens for this event)
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'sync' } }));
  }, []);

  // Auto-dismiss final state after 8 seconds
  const autoDismissRef = useRef<ReturnType<typeof setTimeout>>(null);
  const step1Done_ = guideState?.step1Done;
  const step2Done_ = guideState?.askedAI;
  const nextIdx_ = guideState?.nextStepIndex ?? 0;
  const allDone_ = step1Done_ && step2Done_;
  const allNextDone_ = allDone_ && nextIdx_ >= g.done.steps.length;

  useEffect(() => {
    if (allNextDone_) {
      autoDismissRef.current = setTimeout(() => handleDismiss(), 8000);
    }
    return () => { if (autoDismissRef.current) clearTimeout(autoDismissRef.current); };
  }, [allNextDone_, handleDismiss]);

  if (!guideState) return null;

  const walkthroughActive = guideState.walkthroughStep !== undefined
    && guideState.walkthroughStep >= 0
    && guideState.walkthroughStep < walkthroughSteps.length
    && !guideState.walkthroughDismissed;
  if (walkthroughActive) return null;

  const step1Done = guideState.step1Done;
  const step2Done = guideState.askedAI;
  const allDone = step1Done && step2Done;
  const nextIdx = guideState.nextStepIndex;
  const nextSteps = g.done.steps;
  const allNextDone = nextIdx >= nextSteps.length;
  const isEmptyTemplate = guideState.template === 'empty';

  // After all next-steps done → final state (auto-dismisses after 8s)
  if (allDone && allNextDone) {
    return (
      <div className="mb-6 rounded-xl border border-[var(--amber)] px-5 py-4 flex items-center gap-3 animate-in fade-in duration-300 bg-[var(--amber-subtle)]">
        <Sparkles size={16} className="animate-spin-slow text-[var(--amber)]" />
        <span className="text-sm font-semibold flex-1 text-foreground">
          ✨ {g.done.titleFinal}
        </span>
        <Link
          href="/explore"
          className="text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80"
        >
          {t.walkthrough.exploreCta}
        </Link>
        <button onClick={handleDismiss} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <X size={14} />
        </button>
      </div>
    );
  }

  // Collapsed done state with next-step prompts
  if (allDone) {
    const step = nextSteps[nextIdx];
    return (
      <div className="mb-6 rounded-xl border border-[var(--amber)] px-5 py-4 animate-in fade-in duration-300 bg-[var(--amber-subtle)]">
        <div className="flex items-center gap-3">
          <Sparkles size={16} className="text-[var(--amber)]" />
          <span className="text-sm font-semibold flex-1 text-foreground">
            🎉 {g.done.title}
          </span>
          <button onClick={handleDismiss} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
            <X size={14} />
          </button>
        </div>
        {step && (
          <button
            onClick={handleNextStepClick}
            className="mt-3 flex items-center gap-2 text-sm text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer animate-in fade-in slide-in-from-left-2 duration-300"
          >
            <ChevronRight size={14} />
            <span>{step.hint}</span>
          </button>
        )}
      </div>
    );
  }

  // Main guide card with 3 tasks
  return (
    <div className="mb-6 rounded-xl border border-[var(--amber)] overflow-hidden bg-[var(--amber-subtle)]">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-2">
        <Sparkles size={16} className="text-[var(--amber)]" />
        <span className="text-sm font-semibold flex-1 font-display text-foreground">
          {g.title}
        </span>
        <button onClick={handleDismiss} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <X size={14} />
        </button>
      </div>

      {/* Task cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-5 py-3">
        <TaskCard icon={<FolderOpen size={16} />} title={g.kb.title} cta={g.kb.cta} done={step1Done} active={expanded === 'kb'} onClick={() => step1Done ? null : setExpanded(expanded === 'kb' ? null : 'kb')} />
        <TaskCard icon={<MessageCircle size={16} />} title={g.ai.title} cta={g.ai.cta} done={step2Done} active={expanded === 'ai'} onClick={() => { if (!step2Done) handleStartAI(); }} />
        <TaskCard icon={<RefreshCw size={16} />} title={g.sync.title} cta={g.sync.cta} done={false} optional={g.sync.optional} active={false} onClick={handleSyncClick} />
      </div>

      {/* Expanded content: Explore KB */}
      {expanded === 'kb' && !step1Done && (
        <div className="px-5 pb-4 animate-in slide-in-from-top-2 duration-200">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs mb-3 text-muted-foreground">
              {isEmptyTemplate ? g.kb.emptyDesc : g.kb.fullDesc}
            </p>

            {isEmptyTemplate ? (
              <div className="flex flex-col gap-1.5">
                {recentFiles.length > 0 ? (
                  recentFiles.map(file => {
                    const fileName = file.path.split('/').pop() || file.path;
                    return (
                      <button key={file.path} onClick={() => handleFileOpen(file.path)}
                        className="text-left text-xs px-3 py-2 rounded-lg border border-border text-foreground transition-colors hover:border-[var(--amber)]/30 hover:bg-muted/50 truncate">
                        📄 {fileName}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">{g.kb.emptyHint}</p>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {spaces.slice(0, 6).map(s => {
                    const emoji = extractEmoji(s.name);
                    const label = stripEmoji(s.name);
                    return (
                      <button key={s.name} onClick={() => handleFileOpen(s.path)}
                        className="text-left text-xs px-3 py-2 rounded-lg border border-border text-foreground transition-colors hover:border-[var(--amber)]/30 hover:bg-muted/50">
                        <span className="mr-1.5">{emoji || '📁'}</span>
                        <span>{label}</span>
                        <span className="block text-2xs mt-0.5 text-muted-foreground">
                          {t.home.nFiles(s.fileCount)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs mt-3 text-[var(--amber)]">
                  💡 {g.kb.instructionHint}
                </p>
              </>
            )}

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {g.kb.progress(browsedCount)}
              </span>
              <button onClick={handleSkipKB}
                className="text-xs px-3 py-1 rounded-lg text-muted-foreground transition-colors hover:bg-muted">
                {g.skip}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { type GuideCardProps };

function TaskCard({ icon, title, cta, done, active, optional, onClick }: {
  icon: React.ReactNode;
  title: string;
  cta: string;
  done: boolean;
  active: boolean;
  optional?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={done}
      className={`
        flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-center
        transition-all duration-150
        ${done ? 'opacity-60' : 'hover:border-[var(--amber)]/30 hover:bg-muted/50 cursor-pointer'}
        ${active ? 'border-[var(--amber)]/40 bg-muted/50' : ''}
        ${done || active ? 'border-[var(--amber)]' : 'border-border'}
      `}
    >
      <span className={`${done ? 'animate-in zoom-in-50 duration-300 text-success' : 'text-[var(--amber)]'}`}>
        {done ? <Check size={16} /> : icon}
      </span>
      <span className="text-xs font-medium text-foreground">
        {title}
      </span>
      {optional && (
        <span className="text-2xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {optional}
        </span>
      )}
      {!done && !optional && (
        <span className="text-2xs text-[var(--amber)]">
          {cta} →
        </span>
      )}
    </button>
  );
}
