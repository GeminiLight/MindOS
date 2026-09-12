'use client';

import { UserRound, Inbox, RefreshCw, Repeat2, Lightbulb, Rocket, Search, UsersRound, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { openAskModal } from '@/hooks/useAskModal';

interface UseCaseCardProps {
  icon: string;
  image?: string;
  title: string;
  description: string;
  prompt: string;
  tryItLabel: string;
}

export default function UseCaseCard({ icon, image, title, description, prompt, tryItLabel }: UseCaseCardProps) {
  const [imgError, setImgError] = useState(false);
  const Icon = ({ '👤': UserRound, '📥': Inbox, '🔄': RefreshCw, '🔁': Repeat2, '💡': Lightbulb, '🚀': Rocket, '🔍': Search, '🤝': UsersRound, '🛡️': ShieldCheck } as Record<string, typeof Sparkles>)[icon] ?? Sparkles;

  return (
    <div
      className="group flex flex-col gap-3 p-4 rounded-xl border border-border bg-card transition-all duration-150 hover:border-[var(--amber)]/30 hover:bg-muted/50"
    >
      {/* Image or emoji fallback */}
      {image && !imgError ? (
        <div className="w-full aspect-[16/9] rounded-lg overflow-hidden bg-muted">
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden><Icon size={17} /></span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold leading-snug text-foreground" title={title}>
            {title}
          </h3>
          <p className="text-sm leading-relaxed mt-2 text-muted-foreground" title={description}>
            {description}
          </p>
        </div>
      </div>
      <button
        onClick={() => openAskModal(prompt, 'user')}
        className="mt-auto self-start inline-flex min-h-10 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer bg-[var(--amber-dim)] text-[var(--amber-text)]"
      >
        {tryItLabel} →
      </button>
    </div>
  );
}
