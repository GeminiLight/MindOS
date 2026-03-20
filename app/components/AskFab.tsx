'use client';

import { Sparkles } from 'lucide-react';

interface AskFabProps {
  /** Toggle the right-side Ask AI panel */
  onToggle: () => void;
  /** Whether the right panel is currently open (FAB hides when open) */
  askPanelOpen: boolean;
}

export default function AskFab({ onToggle, askPanelOpen }: AskFabProps) {
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
        background: 'linear-gradient(135deg, #b07c2e 0%, #c8873a 50%, #d4943f 100%)',
      }}
      title="MindOS Agent (⌘/)"
      aria-label="MindOS Agent"
    >
      <Sparkles size={16} className="relative z-10 shrink-0" />
      <span className="
        relative z-10
        group-hover:max-w-[120px]
        opacity-0 group-hover:opacity-100
        transition-all duration-200 ease-out
        whitespace-nowrap overflow-hidden
      ">
        MindOS Agent
      </span>
    </button>
  );
}
