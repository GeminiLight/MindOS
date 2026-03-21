'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: Array<{ keys: string; label: string; section: string }> = [
  // Navigation
  { keys: `${MOD} K`, label: 'Toggle Search', section: 'Navigation' },
  { keys: `${MOD} /`, label: 'Toggle Ask AI', section: 'Navigation' },
  { keys: `${MOD} ,`, label: 'Open Settings', section: 'Navigation' },
  { keys: `${MOD} ?`, label: 'Keyboard Shortcuts', section: 'Navigation' },
  // Panels
  { keys: 'Esc', label: 'Close panel / Exit maximize', section: 'Panels' },
  // Editor
  { keys: `${MOD} S`, label: 'Save file', section: 'Editor' },
  { keys: `${MOD} Z`, label: 'Undo', section: 'Editor' },
  { keys: `${MOD} Shift Z`, label: 'Redo', section: 'Editor' },
];

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '/') {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  const sections = [...new Set(SHORTCUTS.map(s => s.section))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={e => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        className="w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <span className="text-sm font-medium font-display text-foreground">Keyboard Shortcuts</span>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {sections.map(section => (
            <div key={section}>
              <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{section}</h3>
              <div className="space-y-1">
                {SHORTCUTS.filter(s => s.section === section).map(s => (
                  <div key={s.keys} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-foreground">{s.label}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.split(' ').map((key, i) => (
                        <kbd
                          key={i}
                          className="px-1.5 py-0.5 text-2xs rounded border border-border bg-muted text-muted-foreground font-mono min-w-[24px] text-center"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border">
          <p className="text-2xs text-muted-foreground/60">
            Press <kbd className="px-1 py-0.5 text-2xs rounded border border-border bg-muted font-mono">{MOD}</kbd>
            <kbd className="px-1 py-0.5 text-2xs rounded border border-border bg-muted font-mono ml-0.5">?</kbd> to toggle this panel
          </p>
        </div>
      </div>
    </div>
  );
}
