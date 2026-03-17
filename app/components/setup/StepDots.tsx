'use client';

export interface StepDotsProps {
  step: number;
  setStep: (s: number) => void;
  stepTitles: readonly string[];
  disabled?: boolean;
}

export default function StepDots({ step, setStep, stepTitles, disabled }: StepDotsProps) {
  return (
    <div className="flex items-center gap-2 mb-8" role="navigation" aria-label="Setup steps">
      {stepTitles.map((title: string, i: number) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <div className="w-8 h-px" style={{ background: i <= step ? 'var(--amber)' : 'var(--border)' }} />}
          <button onClick={() => setStep(i)}
            aria-current={i === step ? 'step' : undefined}
            aria-label={title}
            className="flex items-center gap-1.5 p-1 -m-1 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || i >= step}>
            <div
              className="w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center transition-colors"
              style={{
                background: i <= step ? 'var(--amber)' : 'var(--muted)',
                color: i <= step ? 'var(--amber-foreground)' : 'var(--muted-foreground)',
                opacity: i <= step ? 1 : 0.5,
              }}>
              {i + 1}
            </div>
            <span className="text-xs hidden sm:inline"
              style={{ color: i === step ? 'var(--foreground)' : 'var(--muted-foreground)', opacity: i <= step ? 1 : 0.5 }}>
              {title}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
