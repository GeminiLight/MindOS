'use client';

import { CheckCircle2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

export interface StepDotsProps {
  step: number;
  setStep: (s: number) => void;
  stepTitles: readonly string[];
  disabled?: boolean;
  /** Number of "numbered" steps to show (Confirm step is not numbered) */
  numberedSteps?: number;
}

export default function StepDots({ step, setStep, stepTitles, disabled, numberedSteps }: StepDotsProps) {
  const { t } = useLocale();
  const count = numberedSteps ?? stepTitles.length;
  // Only render dots for numbered steps (exclude Confirm)
  const dotsToShow = stepTitles.slice(0, count);
  const isConfirmStep = step >= count;

  return (
    <div className="flex items-center gap-2 mb-8" role="navigation" aria-label="Setup steps">
      {dotsToShow.map((title: string, i: number) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <div className="w-8 h-px" style={{ background: i <= step || isConfirmStep ? 'var(--amber)' : 'var(--border)' }} />}
          <button onClick={() => setStep(i)}
            aria-current={i === step ? 'step' : undefined}
            aria-label={title}
            className="flex flex-col items-center gap-1 p-1 -m-1 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || i > step}
            title={(disabled || i > step) ? t.hints.cannotJumpForward : undefined}>
            <div
              className="w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center transition-colors"
              style={{
                background: (i < step || isConfirmStep) ? 'var(--amber)' : i === step ? 'var(--amber)' : 'var(--muted)',
                color: (i <= step || isConfirmStep) ? 'var(--amber-foreground)' : 'var(--muted-foreground)',
                opacity: (i <= step || isConfirmStep) ? 1 : 0.5,
              }}>
              {(i < step || isConfirmStep) ? <CheckCircle2 size={14} /> : i + 1}
            </div>
            <span className="text-[10px] leading-tight hidden sm:inline max-w-[4rem] text-center truncate"
              style={{ color: (i === step && !isConfirmStep) ? 'var(--foreground)' : 'var(--muted-foreground)', opacity: (i <= step || isConfirmStep) ? 1 : 0.5 }}>
              {title}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
