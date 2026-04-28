'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Sparkles, Upload, MessageCircle, ExternalLink, Check, Copy, ChevronDown } from 'lucide-react';
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
  const [step3Done, setStep3Done] = useState(false);
  const hasAutoExpanded = useRef(false);

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
    const handleGuideUpdate = () => fetchGuideState();
    window.addEventListener('focus', handleGuideUpdate);
    window.addEventListener('guide-state-updated', handleGuideUpdate);
    return () => {
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

  // ── Auto-expand: always show current step ──
  // On initial load, expand the first incomplete step
  useEffect(() => {
    if (!guideState || hasAutoExpanded.current) return;
    hasAutoExpanded.current = true;
    if (!guideState.step1Done) {
      setExpanded('import');
    } else if (!guideState.askedAI) {
      setExpanded('ai');
    } else if (!step3Done) {
      setExpanded('agent');
    }
  }, [guideState, step3Done]);

  // On step completion, auto-advance to next step
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

  const showStep3 = step1Done && step2Done && !step3Done;

  // ── Final state: all next-steps done ──
  if (allCoreDone && allNextDone) {
    return (
      <div className="rounded-lg border border-border/50 px-4 py-3 flex items-center gap-3 animate-in fade-in duration-300">
        <Sparkles size={14} className="text-[var(--amber)] shrink-0" />
        <span className="text-xs font-medium flex-1 text-foreground">
          {g.done.titleFinal}
        </span>
        <Link
          href="/explore"
          className="text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80"
        >
          {t.walkthrough.exploreCta}
        </Link>
        <button onClick={handleDismiss} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <X size={12} />
        </button>
      </div>
    );
  }

  // ── Done state: next-step prompts ──
  if (allCoreDone) {
    const step = g.done.steps[nextIdx];
    return (
      <div className="rounded-lg border border-border/50 px-4 py-3 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <Sparkles size={14} className="text-[var(--amber)] shrink-0" />
          <span className="text-xs font-medium flex-1 text-foreground">
            {g.done.title}
          </span>
          <button onClick={handleDismiss} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
            <X size={12} />
          </button>
        </div>
        {step && (
          <button
            onClick={handleNextStepClick}
            className="mt-2 ml-6 flex items-center gap-1.5 text-xs text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer"
          >
            <span>{step.hint}</span>
            <ChevronDown size={10} className="-rotate-90" />
          </button>
        )}
      </div>
    );
  }

  // ── Steps data ──
  const steps = [
    { key: 'import' as const, done: step1Done, icon: Upload, title: g.import.title, dimmed: false },
    { key: 'ai' as const, done: step2Done, icon: MessageCircle, title: g.ai.title, dimmed: !step1Done },
    { key: 'agent' as const, done: step3Done, icon: ExternalLink, title: g.agent.title, dimmed: !step1Done || !step2Done },
  ];

  const handleStepClick = (key: 'import' | 'ai' | 'agent', done: boolean, dimmed: boolean) => {
    if (done || dimmed) return;
    setExpanded(expanded === key ? null : key);
  };

  // ── Main guide card ──
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">

      {/* Header row with inline steps */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Sparkles size={14} className="text-[var(--amber)] shrink-0" />
        <span className="text-xs font-semibold text-foreground mr-2">{g.title}</span>

        {/* Step indicators — horizontal */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isActive = expanded === s.key;
            const isClickable = !s.done && !s.dimmed;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => handleStepClick(s.key, s.done, s.dimmed)}
                disabled={s.done || s.dimmed}
                title={s.dimmed ? g.stepLocked : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-medium transition-all ${
                  s.done
                    ? 'text-success/70'
                    : s.dimmed
                      ? 'text-muted-foreground/30'
                      : isActive
                        ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                } ${isClickable ? 'cursor-pointer' : ''}`}
              >
                {s.done ? (
                  <Check size={11} className="shrink-0" />
                ) : (
                  <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold shrink-0 ${
                    isActive ? 'bg-[var(--amber)] text-[var(--amber-foreground)] animate-pulse' : s.dimmed ? 'bg-muted/50 text-muted-foreground/30' : 'bg-muted text-muted-foreground'
                  }`}>
                    {i + 1}
                  </span>
                )}
                <span className="truncate hidden sm:inline">{s.title}</span>
              </button>
            );
          })}
        </div>

        <button onClick={handleDismiss} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground shrink-0">
          <X size={12} />
        </button>
      </div>

      {/* ── Step 1 panel (Grid transition) ── */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        expanded === 'import' && !step1Done ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3">
            <div className="flex items-center gap-3 pl-6">
              <p className="text-xs text-muted-foreground flex-1">{g.import.desc}</p>
              <button
                onClick={handleImportClick}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] transition-all hover:opacity-90"
              >
                {g.import.button}
              </button>
              <button
                onClick={handleSkipImport}
                className="shrink-0 text-xs px-2 py-1 rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors"
              >
                {g.skip}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step 2 panel (Grid transition) ── */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        expanded === 'ai' && step1Done && !step2Done ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3">
            <div className="flex items-center gap-3 pl-6">
              <p className="text-xs text-muted-foreground flex-1">{g.ai.desc}</p>
              <button
                onClick={handleStartAI}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] transition-all hover:opacity-90"
              >
                {g.ai.cta}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step 3 panel (Grid transition) ── */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        expanded === 'agent' && showStep3 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3">
            <div className="pl-6">
              <p className="text-xs text-muted-foreground mb-2">{g.agent.desc}</p>
              <div className="relative rounded-md bg-muted/50 p-3 pr-20">
                <p className="text-xs font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {g.agent.copyPrompt}
                </p>
                <button
                  onClick={handleCopyPrompt}
                  className="absolute top-2 right-2 flex items-center gap-1 text-2xs font-medium px-2 py-1 rounded-md bg-background border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy size={10} />
                  {g.agent.copy}
                </button>
              </div>
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleStep3Done}
                  className="text-xs px-2 py-1 rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors"
                >
                  {g.skip}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
