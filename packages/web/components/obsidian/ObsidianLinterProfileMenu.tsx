'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { OBSIDIAN_LINTER_RULE_METADATA } from '@/lib/obsidian-compat/linter-adapter';
import {
  resetObsidianLinterProfilePreference,
  setObsidianLinterMaxConsecutiveBlankLines,
  setObsidianLinterRuleEnabled,
  useObsidianLinterProfile,
} from '@/lib/stores/obsidian-linter-profile-store';

const MENU_WIDTH_PX = 288;
const MENU_VIEWPORT_MARGIN_PX = 8;

export default function ObsidianLinterProfileMenu() {
  const profile = useObsidianLinterProfile();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: MENU_VIEWPORT_MARGIN_PX, top: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxLeft = Math.max(
      MENU_VIEWPORT_MARGIN_PX,
      window.innerWidth - MENU_WIDTH_PX - MENU_VIEWPORT_MARGIN_PX,
    );
    const centeredLeft = rect.left + rect.width / 2 - MENU_WIDTH_PX / 2;
    setMenuPosition({
      left: Math.min(Math.max(MENU_VIEWPORT_MARGIN_PX, centeredLeft), maxLeft),
      top: rect.bottom + MENU_VIEWPORT_MARGIN_PX,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Configure Linter rules"
        aria-expanded={open}
        title="Configure Linter rules"
        onClick={() => {
          updateMenuPosition();
          setOpen(value => !value);
        }}
        className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-sm transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation ${
          open
            ? 'border-[var(--amber)] bg-[var(--amber-subtle)] text-[var(--amber)]'
            : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
      >
        <SlidersHorizontal size={13} />
        <span className="hidden sm:inline">Rules</span>
      </button>

      {open && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-border bg-card p-3 text-foreground shadow-lg"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          data-testid="linter-profile-menu"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold">Linter rules</div>
            <button
              type="button"
              aria-label="Reset Linter rules"
              title="Reset Linter rules"
              onClick={() => resetObsidianLinterProfilePreference()}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          <div className="mt-2 space-y-1.5">
            {OBSIDIAN_LINTER_RULE_METADATA.map((rule) => (
              <label
                key={rule.id}
                className="flex min-h-8 items-center gap-2 rounded-md px-1.5 text-xs transition-colors duration-75 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="form-check"
                  checked={profile.enabledRules[rule.id]}
                  onChange={(event) => setObsidianLinterRuleEnabled(rule.id, event.currentTarget.checked)}
                  data-testid={`linter-rule-toggle-${rule.id}`}
                />
                <span className="min-w-0 flex-1 truncate">{rule.label}</span>
              </label>
            ))}
          </div>

          <label className="mt-3 flex min-h-8 items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Max blank lines</span>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={profile.maxConsecutiveBlankLines}
              onChange={(event) => setObsidianLinterMaxConsecutiveBlankLines(Number(event.currentTarget.value))}
              className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="linter-max-blank-lines"
            />
          </label>
        </div>
      )}
    </div>
  );
}
