'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Brain } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
}

export default function ThinkingBlock({ text, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLocale();

  if (!text && !isStreaming) return null;

  return (
    <div className="my-1 rounded-md border border-border/40 bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/30 transition-colors rounded-md"
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
        )}
        <Brain size={12} className="shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground font-medium">
          {t.ask.thinkingLabel}
          {isStreaming && !expanded && (
            <span className="ml-1 animate-pulse">...</span>
          )}
        </span>
        {!expanded && text && (
          <span className="text-muted-foreground/60 truncate flex-1 ml-1">
            {text.slice(0, 80)}{text.length > 80 ? '...' : ''}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-0.5 border-t border-border/30">
          <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {text}
            {isStreaming && (
              <span className="inline-block w-1 h-3 bg-muted-foreground/40 ml-0.5 align-middle animate-pulse rounded-sm" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
