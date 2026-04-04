'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Sparkles, Upload, MessageCircle, ExternalLink, Check, ChevronRight, Copy } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import Link from 'next/link';
import { useLocale } from '@/lib/stores/locale-store';
import { openAskModal } from '@/hooks/useAskModal';
import { walkthroughSteps } from './walkthrough/steps';
import type { GuideState } from '@/lib/settings';
export default function GuideCard() {
  const { t } = useLocale();
  const g = t.guide;

  const [guideState, setGuideState] = useState<GuideState | null>(null);
  const [expanded, setExpanded] = useState<'import' | 'ai' | 'agent' | null>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [step3Done, setStep3Done] = useState(false);

  // Fetch guide state from backend
  const fetchGuideState = useCallback(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        const gs = data.guideState;
        if (gs?.active && !gs.dismissed) {
          setGuideState(gs);
        } else {
          setGuideState(null);
        }
      })
      .catch((err) => {
        console.warn('[GuideCard] Fetch guide state failed:', err);
      });
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

  const patchGuide = useCallback((patch: Partial<GuideState>) => {
    setGuideState(prev => prev ? { ...prev, ...patch } : prev);
    fetch('/api/setup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guideState: patch }),
    }).catch((err) => {
      console.warn('[GuideCard] PATCH guide state failed:', err);
    });
  }, []);

  const handleDismiss = useCallback(() => {
    patchGuide({ dismissed: true });
    setGuideState(null);
  }, [patchGuide]);

  // ── Step 1: Import ──

  const handleImportClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('mindos:open-import'));
  }, []);

  const handleSkipImport = useCallback(() => {
    patchGuide({ step1Done: true });
    setExpanded(null);
  }, [patchGuide]);

  // Auto-mark step 1 done when files change (import completes, space created, etc.)
  useEffect(() => {
    if (!guideState || guideState.step1Done) return;
    const handler = () => patchGuide({ step1Done: true });
    window.addEventListener('mindos:files-changed', handler);
    return () => window.removeEventListener('mindos:files-changed', handler);
  }, [guideState, guideState?.step1Done, patchGuide]);

  // ── Step 2: AI verify ──

  const handleStartAI = useCallback(() => {
    const gs = guideState;
    const isEmpty = gs?.template === 'empty';
    const prompt = isEmpty ? g.ai.promptEmpty : g.ai.prompt;
    openAskModal(prompt, 'guide');
  }, [guideState, g]);

  // ── Step 3: Cross-agent copy ──

  const handleCopyPrompt = useCallback(async () => {
    const ok = await copyToClipboard(g.agent.copyPrompt);
    if (ok) toast.copy();
  }, [g]);

  const handleStep3Done = useCallback(() => {
    setStep3Done(true);
    setExpanded(null);
    patchGuide({ nextStepIndex: 0 });
  }, [patchGuide]);

  // ── Next-step prompts ──

  const handleNextStepClick = useCallback(() => {
    if (!guideState) return;
    const idx = guideState.nextStepIndex;
    const steps = g.done.steps;
    if (idx < steps.length) {
      openAskModal(steps[idx].prompt, 'guide-next');
      patchGuide({ nextStepIndex: idx + 1 });
    }
  }, [guideState, g, patchGuide]);

  // ── Auto-expand on step transitions ──

  // First visit: expand step 1
  useEffect(() => {
    if (isFirstVisit && guideState && !guideState.step1Done) {
      setExpanded('import');
    }
  }, [isFirstVisit, guideState]);

  // Step transition: auto-expand next step
  const prevStepRef = useRef({ s1: false, s2: false });
  useEffect(() => {
    if (!guideState) return;
    const prev = prevStepRef.current;
    if (guideState.step1Done && !prev.s1) {
      setExpanded('ai');
      prev.s1 = true;
    }
    if (guideState.askedAI && !prev.s2) {
      setExpanded('agent');
      prev.s2 = true;
    }
  }, [guideState?.step1Done, guideState?.askedAI, guideState]);

  // ── Auto-dismiss final state ──

  const step1Done = guideState?.step1Done ?? false;
  const step2Done = guideState?.askedAI ?? false;
  const nextIdx = guideState?.nextStepIndex ?? 0;
  const allCoreDone = step1Done && step2Done && step3Done;
  const allNextDone = allCoreDone && nextIdx >= g.done.steps.length;

  const autoDismissRef = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (allNextDone) {
      autoDismissRef.current = setTimeout(() => handleDismiss(), 8000);
    }
    return () => { if (autoDismissRef.current) clearTimeout(autoDismissRef.current); };
  }, [allNextDone, handleDismiss]);

  // ── Render guards ──

  if (!guideState) return null;

  const walkthroughActive = guideState.walkthroughStep !== undefined
    && guideState.walkthroughStep >= 0
    && guideState.walkthroughStep < walkthroughSteps.length
    && !guideState.walkthroughDismissed;
  if (walkthroughActive) return null;

  // If both steps 1+2 were already done on load (e.g. page refresh), step3Done is local
  // and starts false — this lets the user see step 3 again, which is useful.
  const showStep3 = step1Done && step2Done && !step3Done;

  // ── Final state: all next-steps done ──

  if (allCoreDone && allNextDone) {
    return (
      <div className="mb-6 rounded-xl border border-[var(--amber)] px-5 py-4 flex items-center gap-3 animate-in fade-in duration-300 bg-[var(--amber-subtle)]">
        <Sparkles size={16} className="animate-spin-slow text-[var(--amber)]" />
        <span className="text-sm font-semibold flex-1 text-foreground">
          {g.done.titleFinal}
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

  // ── Done state: next-step prompts ──

  if (allCoreDone) {
    const step = g.done.steps[nextIdx];
    return (
      <div className="mb-6 rounded-xl border border-[var(--amber)] px-5 py-4 animate-in fade-in duration-300 bg-[var(--amber-subtle)]">
        <div className="flex items-center gap-3">
          <Sparkles size={16} className="text-[var(--amber)]" />
          <span className="text-sm font-semibold flex-1 text-foreground">
            {g.done.title}
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

  // ── Main guide card with 3 steps ──

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
        <TaskCard
          icon={<Upload size={16} />}
          title={g.import.title}
          cta={g.import.cta}
          done={step1Done}
          active={expanded === 'import'}
          onClick={() => !step1Done ? setExpanded(expanded === 'import' ? null : 'import') : null}
        />
        <TaskCard
          icon={<MessageCircle size={16} />}
          title={g.ai.title}
          cta={g.ai.cta}
          done={step2Done}
          active={expanded === 'ai'}
          dimmed={!step1Done}
          onClick={() => {
            if (step2Done || !step1Done) return;
            setExpanded(expanded === 'ai' ? null : 'ai');
          }}
        />
        <TaskCard
          icon={<ExternalLink size={16} />}
          title={g.agent.title}
          cta={g.agent.cta}
          done={step3Done}
          active={expanded === 'agent'}
          dimmed={!step1Done || !step2Done}
          onClick={() => {
            if (!step1Done || !step2Done) return;
            setExpanded(expanded === 'agent' ? null : 'agent');
          }}
        />
      </div>

      {/* ── Step 1 expanded: Import files ── */}
      {expanded === 'import' && !step1Done && (
        <div className="px-5 pb-4 animate-in slide-in-from-top-2 duration-200">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-3">
              {g.import.desc}
            </p>
            <div className="flex items-center justify-between">
              <button
                onClick={handleImportClick}
                className="text-xs font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
              >
                {g.import.button}
              </button>
              <button
                onClick={handleSkipImport}
                className="text-xs px-3 py-1 rounded-lg text-muted-foreground transition-colors hover:bg-muted"
              >
                {g.skip}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2 expanded: AI verification ── */}
      {expanded === 'ai' && step1Done && !step2Done && (
        <div className="px-5 pb-4 animate-in slide-in-from-top-2 duration-200">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-3">
              {g.ai.desc}
            </p>
            <button
              onClick={handleStartAI}
              className="text-xs font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
            >
              {g.ai.cta} →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 expanded: Cross-agent prompt ── */}
      {expanded === 'agent' && showStep3 && (
        <div className="px-5 pb-4 animate-in slide-in-from-top-2 duration-200">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-3">
              {g.agent.desc}
            </p>
            <div className="relative rounded-lg border border-border bg-muted/50 p-3 pr-16">
              <p className="text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap">
                {g.agent.copyPrompt}
              </p>
              <button
                onClick={handleCopyPrompt}
                className="absolute top-2 right-2 flex items-center gap-1 text-2xs font-medium px-2.5 py-1.5 rounded-md border transition-all border-border bg-card text-muted-foreground hover:text-foreground hover:border-[var(--amber)]/30"
              >
                <Copy size={11} />
                {g.agent.copy}
              </button>
            </div>
            <div className="flex items-center justify-end mt-3 pt-3 border-t border-border">
              <button
                onClick={handleStep3Done}
                className="text-xs px-3 py-1 rounded-lg text-muted-foreground transition-colors hover:bg-muted"
              >
                {g.skip}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ icon, title, cta, done, active, dimmed, onClick }: {
  icon: React.ReactNode;
  title: string;
  cta: string;
  done: boolean;
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={done || dimmed}
      className={`
        flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-center
        transition-all duration-150
        ${done ? 'opacity-60' : dimmed ? 'opacity-40 cursor-default' : 'hover:border-[var(--amber)]/30 hover:bg-muted/50 cursor-pointer'}
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
      {!done && !dimmed && (
        <span className="text-2xs text-[var(--amber-text)]">
          {cta} →
        </span>
      )}
    </button>
  );
}
