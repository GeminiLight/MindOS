'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { useWalkthrough } from './WalkthroughProvider';
import { walkthroughSteps } from './steps';
import WalkthroughTooltip from './WalkthroughTooltip';

/**
 * Full-screen overlay with SVG spotlight mask.
 * Finds the target element via data-walkthrough attribute, measures it,
 * and cuts a transparent rect into the semi-transparent overlay.
 */
export default function WalkthroughOverlay() {
  const wt = useWalkthrough();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const maskId = useId();

  const step = wt ? walkthroughSteps[wt.currentStep] : null;

  const measureTarget = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-walkthrough="${step.anchor}"]`);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    measureTarget();

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      measureTarget();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', measureTarget, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', measureTarget, true);
    };
  }, [measureTarget]);

  // Re-measure when step changes
  useEffect(() => {
    measureTarget();
    // Slight delay to account for animations
    const timer = setTimeout(measureTarget, 100);
    return () => clearTimeout(timer);
  }, [wt?.currentStep, measureTarget]);

  // ESC to dismiss — depend on skip only, not the entire context object
  const skipFn = wt?.skip;
  useEffect(() => {
    if (!skipFn) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        skipFn();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [skipFn]);

  if (!wt || !step) return null;

  // Mobile: bottom sheet instead of spotlight
  if (isMobile) {
    return <MobileWalkthroughSheet />;
  }

  const PAD = 6; // padding around spotlight rect
  const RADIUS = 8;

  return (
    <>
      {/* SVG overlay with spotlight hole */}
      <svg
        className="fixed inset-0 z-[100] pointer-events-auto"
        width="100%"
        height="100%"
        onClick={(e) => {
          // Click outside spotlight → skip
          if (targetRect) {
            const x = e.clientX;
            const y = e.clientY;
            const inSpotlight =
              x >= targetRect.left - PAD &&
              x <= targetRect.right + PAD &&
              y >= targetRect.top - PAD &&
              y <= targetRect.bottom + PAD;
            if (!inSpotlight) {
              wt.skip();
            }
          }
        }}
      >
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - PAD}
                y={targetRect.top - PAD}
                width={targetRect.width + PAD * 2}
                height={targetRect.height + PAD * 2}
                rx={RADIUS}
                ry={RADIUS}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.5)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* Tooltip */}
      {targetRect && (
        <WalkthroughTooltip
          stepIndex={wt.currentStep}
          rect={targetRect}
          position={step.position}
        />
      )}
    </>
  );
}

/** Mobile fallback: bottom sheet card */
function MobileWalkthroughSheet() {
  const wt = useWalkthrough();
  const { t } = useLocale();

  if (!wt) return null;

  const stepData = t.walkthrough.steps[wt.currentStep] as { title: string; body: string } | undefined;
  if (!stepData) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
        onClick={wt.skip}
      />
      {/* Bottom sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[101] rounded-t-2xl border-t shadow-lg p-5 pb-8 animate-in slide-in-from-bottom duration-300"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        {/* Step counter */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className="text-2xs font-mono px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}
          >
            {t.walkthrough.step(wt.currentStep + 1, wt.totalSteps)}
          </span>
          {/* Progress dots */}
          <div className="flex items-center gap-1 ml-auto">
            {Array.from({ length: wt.totalSteps }, (_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: i === wt.currentStep ? 'var(--amber)' : 'var(--border)',
                }}
              />
            ))}
          </div>
        </div>

        <h3
          className="text-base font-semibold font-display mb-1"
          style={{ color: 'var(--foreground)' }}
        >
          {stepData.title}
        </h3>
        <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--muted-foreground)' }}>
          {stepData.body}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={wt.skip}
            className="text-sm transition-colors hover:opacity-80"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t.walkthrough.skip}
          </button>
          <div className="flex items-center gap-2">
            {wt.currentStep > 0 && (
              <button
                onClick={wt.back}
                className="text-sm px-3 py-2 rounded-lg transition-colors hover:bg-muted"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {t.walkthrough.back}
              </button>
            )}
            <button
              onClick={wt.next}
              className="text-sm px-4 py-2 rounded-lg font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
            >
              {wt.currentStep === wt.totalSteps - 1 ? t.walkthrough.done : t.walkthrough.next}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
