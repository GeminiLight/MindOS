'use client';

import { useEffect, useRef } from 'react';

interface IncomingPromptNoticeProps {
  prompt: string;
  labels: {
    title: string;
    context: string;
    keep: string;
    use: string;
  };
  onKeep: () => void;
  onUse: () => void;
}

export default function IncomingPromptNotice({ prompt, labels, onKeep, onUse }: IncomingPromptNoticeProps) {
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, [prompt]);

  return (
    <div className="mx-2 my-1.5 rounded-xl border border-[var(--amber)]/20 bg-[var(--amber-subtle)]/65 px-3 py-2.5" role="status" data-incoming-prompt-notice>
      <p className="text-sm font-medium text-foreground">{labels.title}</p>
      <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{prompt}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{labels.context}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          ref={keepRef}
          type="button"
          onClick={onKeep}
          className="min-h-11 rounded-lg border border-border/70 bg-background/70 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {labels.keep}
        </button>
        <button
          type="button"
          onClick={onUse}
          className="min-h-11 rounded-lg border border-[var(--amber)]/30 bg-background/70 px-3 text-xs font-medium text-[var(--amber-text)] transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          {labels.use}
        </button>
      </div>
    </div>
  );
}
