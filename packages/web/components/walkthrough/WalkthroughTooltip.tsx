'use client';

import { useState, useEffect } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import { useWalkthrough } from '@/lib/stores/walkthrough-store';

interface WalkthroughTooltipProps {
  stepIndex: number;
  rect: DOMRect;
  position: 'right' | 'bottom';
}

export default function WalkthroughTooltip({ stepIndex, rect, position }: WalkthroughTooltipProps) {
  const wt = useWalkthrough();
  const { t } = useLocale();

  // Track viewport dimensions in state to avoid stale values and SSR hazard
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!wt) return null;

  const stepData = t.walkthrough.steps[stepIndex] as { title: string; body: string } | undefined;
  if (!stepData) return null;

  // Calculate tooltip position
  const GAP = 12;
  let top: number;
  let left: number;

  if (position === 'right') {
    top = rect.top + rect.height / 2;
    left = rect.right + GAP;
  } else {
    top = rect.bottom + GAP;
    left = rect.left + rect.width / 2;
  }

  // Clamp to viewport
  const maxLeft = viewport.width - 320;
  const maxTop = viewport.height - 200;
  left = Math.min(left, maxLeft);
  top = Math.min(top, maxTop);
  top = Math.max(top, 8);

  return (
    <div
      className={`fixed z-[102] w-[280px] rounded-xl border shadow-lg animate-in fade-in duration-200 ${
        position === 'right' ? 'slide-in-from-left-2' : 'slide-in-from-top-2'
      }`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: position === 'right' ? 'translateY(-50%)' : 'translateX(-50%)',
        background: 'var(--card)',
        borderColor: 'var(--amber)',
      }}
    >
      <div className="p-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-2xs font-mono px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}
          >
            {t.walkthrough.step(stepIndex + 1, wt.totalSteps)}
          </span>
        </div>

        {/* Content */}
        <h3
          className="text-sm font-semibold mb-1"
          style={{ color: 'var(--foreground)' }}
        >
          {stepData.title}
        </h3>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
          {stepData.body}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={wt.skip}
            className="text-xs transition-colors hover:opacity-80"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t.walkthrough.skip}
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={wt.back}
                className="text-xs px-2.5 py-1 rounded-lg transition-colors hover:bg-muted"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {t.walkthrough.back}
              </button>
            )}
            <button
              onClick={wt.next}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
            >
              {stepIndex === wt.totalSteps - 1 ? t.walkthrough.done : t.walkthrough.next}
            </button>
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 pb-3">
        {Array.from({ length: wt.totalSteps }, (_, i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full transition-all duration-200"
            style={{
              background: i === stepIndex ? 'var(--amber)' : 'var(--border)',
              transform: i === stepIndex ? 'scale(1.3)' : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}
