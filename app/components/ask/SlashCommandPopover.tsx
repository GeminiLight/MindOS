'use client';

import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import type { SlashItem } from '@/hooks/useSlashCommand';
import HighlightMatch from './HighlightMatch';

interface SlashCommandPopoverProps {
  results: SlashItem[];
  selectedIndex: number;
  query?: string;
  onSelect: (item: SlashItem) => void;
}

/**
 * Popover for slash commands. Renders as a flex child within the AskContent
 * column (not absolutely positioned) to avoid clipping by the panel's
 * overflow-hidden. Uses a dynamic max-height that caps at 50% of the
 * viewport so the popover never overflows the visible area.
 */
export default function SlashCommandPopover({ results, selectedIndex, query, onSelect }: SlashCommandPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxListH, setMaxListH] = useState(280);

  // Dynamically compute max list height based on available space
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Reserve ~80px for header + footer chrome, and cap at 50vh
    const available = Math.min(rect.top - 8, window.innerHeight * 0.5) - 80;
    setMaxListH(Math.max(120, Math.min(320, available)));
  }, [results.length]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (results.length === 0) return null;

  return (
    <div ref={containerRef} className="border border-border rounded-lg bg-card shadow-lg overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border flex items-center gap-1.5">
        <Zap size={11} className="text-[var(--amber)]/50" />
        <span className="text-2xs font-medium text-muted-foreground/70 uppercase tracking-wider">Skills</span>
        <span className="text-2xs text-muted-foreground/40 ml-auto">{results.length}</span>
      </div>
      <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: maxListH }}>
        {results.map((item, idx) => (
          <button
            key={item.name}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
              idx === selectedIndex
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Zap size={13} className="text-[var(--amber)] shrink-0" />
            <span className="text-sm font-medium shrink-0">/<HighlightMatch text={item.name} query={query} /></span>
            {item.description && (
              <span className="text-2xs text-muted-foreground/50 truncate min-w-0 flex-1" title={item.description}>{item.description}</span>
            )}
          </button>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-border flex gap-3 text-2xs text-muted-foreground/40 shrink-0">
        <span>↑↓ navigate</span>
        <span>↵ / Tab select</span>
        <span>ESC dismiss</span>
      </div>
    </div>
  );
}
