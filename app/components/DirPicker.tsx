'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Folder, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { stripEmoji } from '@/lib/utils';

interface DirPickerProps {
  /** Flat list of all directory paths (e.g. ['Notes', 'Notes/Daily', 'Projects']) */
  dirPaths: string[];
  /** Currently selected path ('' = root) */
  value: string;
  /** Called when user selects a directory */
  onChange: (path: string) => void;
  /** Label for root level */
  rootLabel?: string;
}

const PANEL_MAX_H = 200;

/**
 * Hierarchical directory picker — always renders as a single-line trigger button.
 * When expanded, the tree browser floats as an overlay (absolute) so it never
 * pushes sibling content down.
 */
export default function DirPicker({ dirPaths, value, onChange, rootLabel = 'Root' }: DirPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [browsing, setBrowsing] = useState(value);
  const [flipUp, setFlipUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setBrowsing(value); }, [value]);

  // Decide flip direction when opening
  useEffect(() => {
    if (!expanded || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setFlipUp(spaceBelow < PANEL_MAX_H + 8 && spaceAbove > spaceBelow);
  }, [expanded]);

  const collapse = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); collapse(); }
    };
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        collapse();
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [expanded, collapse]);

  const children = useMemo(() => {
    const prefix = browsing ? browsing + '/' : '';
    return dirPaths
      .filter(p => {
        if (!p.startsWith(prefix)) return false;
        const rest = p.slice(prefix.length);
        return rest.length > 0 && !rest.includes('/');
      })
      .sort();
  }, [dirPaths, browsing]);

  const segments = useMemo(() => browsing ? browsing.split('/') : [], [browsing]);

  const navigateTo = (idx: number) => {
    if (idx < 0) { setBrowsing(''); onChange(''); }
    else { const p = segments.slice(0, idx + 1).join('/'); setBrowsing(p); onChange(p); }
  };

  const drillInto = (childPath: string) => {
    setBrowsing(childPath);
    onChange(childPath);
  };

  const displayLabel = value
    ? value.split('/').map(s => stripEmoji(s)).join(' / ')
    : '/ ' + rootLabel;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger — always in document flow */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-haspopup="true"
        aria-expanded={expanded}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors text-left focus-visible:ring-1 focus-visible:ring-ring outline-none ${
          expanded ? 'border-[var(--amber)]' : 'border-border hover:border-[var(--amber)]/40'
        }`}
      >
        <Folder size={14} className="shrink-0 text-[var(--amber)]" />
        <span className="flex-1 truncate">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Floating panel — absolute, never pushes content */}
      {expanded && (
        <div className={`absolute z-50 left-0 right-0 rounded-lg border border-[var(--amber)] bg-card shadow-lg overflow-hidden max-h-[200px] flex flex-col ${
          flipUp ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}>
          {/* Breadcrumb */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 bg-muted/30 border-b border-border overflow-x-auto text-xs shrink-0">
            <button
              type="button"
              onClick={() => navigateTo(-1)}
              className={`shrink-0 px-1.5 py-0.5 rounded transition-colors ${
                browsing === '' ? 'text-[var(--amber)] font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              / {rootLabel}
            </button>
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight size={10} className="text-muted-foreground/50" />
                <button
                  type="button"
                  onClick={() => navigateTo(i)}
                  className={`px-1.5 py-0.5 rounded transition-colors truncate max-w-[100px] ${
                    i === segments.length - 1 ? 'text-[var(--amber)] font-medium' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
          {/* Child directories */}
          {children.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              {children.map(childPath => {
                const childName = childPath.split('/').pop() || childPath;
                const hasChildren = dirPaths.some(p => p.startsWith(childPath + '/'));
                return (
                  <button
                    key={childPath}
                    type="button"
                    onClick={() => drillInto(childPath)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <Folder size={12} className="shrink-0 text-[var(--amber)]" />
                    <span className="flex-1 text-left truncate">{childName}</span>
                    {hasChildren && <ChevronRight size={11} className="shrink-0 text-muted-foreground/40" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground/50 text-center">—</div>
          )}
          {/* Confirm & collapse */}
          <button
            type="button"
            onClick={collapse}
            className="w-full py-1.5 flex items-center justify-center gap-1 text-xs font-medium text-[var(--amber)] border-t border-border hover:bg-muted/30 transition-colors shrink-0"
          >
            <Check size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
