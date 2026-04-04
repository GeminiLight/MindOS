'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Sparkles, ChevronDown, Check } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AskMode } from '@/lib/types';

const STORAGE_KEY = 'mindos-ask-mode';

interface ModeCapsuleProps {
  mode: AskMode;
  onChange: (mode: AskMode) => void;
  disabled?: boolean;
}

interface DropdownPos {
  top: number;
  left: number;
  direction: 'up' | 'down';
}

export function getPersistedMode(): AskMode {
  if (typeof window === 'undefined') return 'agent';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'chat' || stored === 'agent') return stored;
  } catch { /* localStorage unavailable */ }
  return 'agent';
}

export function persistMode(mode: AskMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* localStorage unavailable */ }
}

const MODE_OPTIONS: AskMode[] = ['agent', 'chat'];

export default function ModeCapsule({ mode, onChange, disabled }: ModeCapsuleProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedH = 120;
    const direction: 'up' | 'down' = spaceAbove > spaceBelow && spaceAbove > estimatedH ? 'up' : 'down';
    setPos({
      left: rect.left,
      top: direction === 'up' ? rect.top - 6 : rect.bottom + 6,
      direction,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  const handleSelect = useCallback((m: AskMode) => {
    onChange(m);
    persistMode(m);
    setOpen(false);
  }, [onChange]);

  const isChat = mode === 'chat';

  const modeIcon = (m: AskMode, size: number) =>
    m === 'chat'
      ? <MessageSquare size={size} className="shrink-0" />
      : <Sparkles size={size} className="shrink-0" />;

  const modeName = (m: AskMode) => m === 'chat' ? t.ask.modeChat : t.ask.modeAgent;
  const modeHint = (m: AskMode) => m === 'chat' ? t.ask.modeChatHint : t.ask.modeAgentHint;

  const dropdown = open && pos ? (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label="Select mode"
      className="fixed z-50 min-w-[200px] max-w-[260px] rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        left: pos.left,
        ...(pos.direction === 'up'
          ? { bottom: window.innerHeight - pos.top }
          : { top: pos.top }),
      }}
    >
      {MODE_OPTIONS.map((m) => {
        const isSelected = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => handleSelect(m)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-muted"
          >
            <span className="text-muted-foreground">{modeIcon(m, 13)}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{modeName(m)}</div>
              <div className="text-2xs text-muted-foreground mt-0.5">{modeHint(m)}</div>
            </div>
            {isSelected && <Check size={12} className="shrink-0 text-[var(--amber)]" />}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!disabled) setOpen(v => !v); }}
        disabled={disabled}
        className={`
          inline-flex items-center gap-1 rounded-full px-2.5 py-0.5
          text-2xs font-medium transition-colors select-none
          border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          disabled:opacity-40 disabled:cursor-not-allowed
          ${isChat
            ? 'bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
            : 'bg-[var(--amber)]/10 border-[var(--amber)]/25 text-foreground hover:bg-[var(--amber)]/15'
          }
        `}
        title={modeHint(mode)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {modeIcon(mode, 11)}
        <span className="truncate max-w-[80px]">{modeName(mode)}</span>
        <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
      </button>
      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </>
  );
}
