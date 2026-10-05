'use client';

import { ArrowUpRight, UserRound, Inbox, RefreshCw, Repeat2, Lightbulb, Rocket, Search, UsersRound, ShieldCheck, Sparkles } from 'lucide-react';
import { openAskModal } from '@/hooks/useAskModal';

interface UseCaseCardProps {
  icon: string;
  title: string;
  description: string;
  prompt: string;
  tryItLabel: string;
  wide?: boolean;
}

const icons = { '👤': UserRound, '📥': Inbox, '🔄': RefreshCw, '🔁': Repeat2, '💡': Lightbulb, '🚀': Rocket, '🔍': Search, '🤝': UsersRound, '🛡️': ShieldCheck } as Record<string, typeof Sparkles>;

export default function UseCaseCard({ icon, title, description, prompt, tryItLabel, wide = false }: UseCaseCardProps) {
  const Icon = icons[icon] ?? Sparkles;

  return (
    <article data-explore-task className="group flex gap-3 border-b border-border/60 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground" aria-hidden="true">
        <Icon size={17} />
      </span>
      <div className={`min-w-0 flex-1 ${wide ? 'md:flex md:items-center md:justify-between md:gap-6' : ''}`}>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-snug text-foreground">{title}</h4>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => openAskModal(prompt, 'user')}
          className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber-subtle)] focus-visible:ring-2 focus-visible:ring-ring ${wide ? 'md:mt-0 md:shrink-0' : ''}`}
        >
          {tryItLabel}
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
