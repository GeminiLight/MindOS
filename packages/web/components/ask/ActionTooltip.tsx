'use client';

import { useState, useRef, useCallback } from 'react';

interface ActionTooltipProps {
  label: string;
  /** Delay in ms before tooltip shows (default 800) */
  delay?: number;
  children: React.ReactNode;
}

/**
 * Lightweight tooltip wrapper — shows a brief label above the child element
 * after a hover delay. Auto-hides on mouse leave.
 */
export default function ActionTooltip({ label, delay = 800, children }: ActionTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const handleLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap
            rounded-md bg-foreground/90 px-2 py-0.5 text-[11px] font-medium text-background
            shadow-sm animate-in fade-in-0 slide-in-from-bottom-1 duration-100 z-20"
        >
          {label}
        </span>
      )}
    </span>
  );
}
