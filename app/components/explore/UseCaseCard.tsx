'use client';

import { openAskModal } from '@/hooks/useAskModal';

interface UseCaseCardProps {
  icon: string;
  title: string;
  description: string;
  prompt: string;
  tryItLabel: string;
}

export default function UseCaseCard({ icon, title, description, prompt, tryItLabel }: UseCaseCardProps) {
  return (
    <div
      className="group flex flex-col gap-3 p-4 rounded-xl border border-border bg-card transition-all duration-150 hover:border-[var(--amber)]/30 hover:bg-muted/50"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none shrink-0 mt-0.5" suppressHydrationWarning>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold font-display truncate text-foreground">
            {title}
          </h3>
          <p className="text-xs leading-relaxed mt-1 line-clamp-2 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <button
        onClick={() => openAskModal(prompt, 'user')}
        className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 hover:opacity-80 cursor-pointer bg-[var(--amber-dim)] text-[var(--amber)]"
      >
        {tryItLabel} →
      </button>
    </div>
  );
}
