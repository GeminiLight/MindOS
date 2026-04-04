'use client';

import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  const s = t.shortcutPanel;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts = useMemo(() => [
    { keys: `${mod} K`, label: s.toggleSearch, section: s.navigation },
    { keys: `${mod} /`, label: s.toggleAskAI, section: s.navigation },
    { keys: `${mod} ,`, label: s.openSettings, section: s.navigation },
    { keys: `${mod} ?`, label: s.keyboardShortcuts, section: s.navigation },
    { keys: 'Esc', label: s.closePanel, section: s.panelsSection },
    { keys: `${mod} S`, label: s.saveFile, section: s.editor },
    { keys: `${mod} Z`, label: s.undo, section: s.editor },
    { keys: `${mod} Shift Z`, label: s.redo, section: s.editor },
  ], [mod, s]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '/') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const sections = [...new Set(shortcuts.map(s => s.section))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={e => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
        className="w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <span className="text-sm font-medium font-display text-foreground">{s.title}</span>
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
                {shortcuts.filter(s => s.section === section).map(s => (
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
            Press <kbd className="px-1 py-0.5 text-2xs rounded border border-border bg-muted font-mono">{mod}</kbd>
            <kbd className="px-1 py-0.5 text-2xs rounded border border-border bg-muted font-mono ml-0.5">?</kbd> {s.toggleHint}
          </p>
        </div>
      </div>
    </div>
  );
}
