'use client';

import { Sparkles } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';

interface AskFabProps {
  /** Toggle the right-side Ask AI panel */
  onToggle: () => void;
  /** Whether the right panel is currently open (FAB hides when open) */
  askPanelOpen: boolean;
}

export default function AskFab({ onToggle, askPanelOpen }: AskFabProps) {
  const { t } = useLocale();
  const label = `${t.ask?.fabLabel ?? 'Ask AI'} (⌘/)`;

  return (
    <button
      onClick={onToggle}
      className={`
        group hidden md:flex
        fixed z-40 bottom-5 right-5
        items-center justify-center
        gap-0 hover:gap-2
        p-[11px] rounded-xl
        text-white font-medium text-[13px]
        shadow-md shadow-amber-900/15
        transition-all duration-200 ease-out
        hover:shadow-lg hover:shadow-amber-800/25
        active:scale-95 cursor-pointer overflow-hidden font-display
        ${askPanelOpen ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100 translate-y-0'}
      `}
      style={{
        background: 'linear-gradient(135deg, var(--amber), color-mix(in srgb, var(--amber) 80%, white))',
      }}
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
        {t.ask?.fabLabel ?? 'Ask AI'}
      </span>
    </button>
  );
}
