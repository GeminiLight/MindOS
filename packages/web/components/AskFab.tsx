'use client';

import { Sparkles } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { usePathname } from 'next/navigation';

interface AskFabProps {
  /** Toggle the right-side MindOS panel */
  onToggle: () => void;
  /** Whether the right panel is currently open (FAB hides when open) */
  askPanelOpen: boolean;
}

export default function AskFab({ onToggle, askPanelOpen }: AskFabProps) {
  const { t } = useLocale();
  const pathname = usePathname();
  const label = `${t.ask?.fabLabel ?? 'Ask MindOS'} (⌘/)`;

  // Hide on home page — it already has an inline chatbot
  const isHome = pathname === '/' || pathname === '';
  const hidden = askPanelOpen || isHome;

  return (
    <button
      onClick={onToggle}
      className={`
        hit-target-box
        group hidden md:flex
        fixed z-40 bottom-5 right-5
        items-center justify-center
        gap-0 hover:gap-2
        p-3
        text-[var(--amber-foreground)] font-medium text-[13px]
        transition-all duration-200 ease-out
        active:scale-95 cursor-pointer overflow-hidden
        [--hit-target-bg:var(--amber)] [--hit-target-hover-bg:var(--amber)]
        [--hit-target-radius:var(--radius-xl)]
        [--hit-target-shadow:0_4px_6px_-1px_color-mix(in_srgb,var(--amber)_15%,transparent)]
        [--hit-target-hover-shadow:0_10px_15px_-3px_color-mix(in_srgb,var(--amber)_20%,transparent)]
        ${hidden ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100 translate-y-0'}
      `}
      title={label}
      aria-label={label}
    >
      <Sparkles size={16} className="relative z-10 shrink-0" />
      <span className="
        relative z-10
        max-w-0 group-hover:max-w-[120px]
        opacity-0 group-hover:opacity-100
        transition-all duration-200 ease-out
        whitespace-nowrap overflow-hidden
      ">
        {t.ask?.fabLabel ?? 'Ask MindOS'}
      </span>
    </button>
  );
}
