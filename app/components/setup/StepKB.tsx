'use client';

import { useState, useEffect, useRef } from 'react';
import { Field } from '@/components/settings/Primitives';
import type { Messages } from '@/lib/i18n';
import type { SetupState } from './types';
import { TEMPLATES } from './constants';

// Derive parent dir from current input for ls — supports both / and \ separators
function getParentDir(p: string): string {
  if (!p.trim()) return '';
  const trimmed = p.trim();
  // Already a directory (ends with separator)
  if (trimmed.endsWith('/') || trimmed.endsWith('\\')) return trimmed;
  // Find last separator (/ or \)
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : '';
}

export interface StepKBProps {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  t: Messages;
  homeDir: string;
}

export default function StepKB({ state, update, t, homeDir }: StepKBProps) {
  const s = t.setup;
  // Build platform-aware placeholder, e.g. /Users/alice/MindOS/mind or C:\Users\alice\MindOS\mind
  // Windows homedir always contains \, e.g. C:\Users\Alice — safe to detect by separator
  const sep = homeDir.includes('\\') ? '\\' : '/';
  const placeholder = homeDir !== '~' ? [homeDir, 'MindOS', 'mind'].join(sep) : s.kbPathDefault;
  const [pathInfo, setPathInfo] = useState<{ exists: boolean; empty: boolean; count: number } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [showTemplatePickerAnyway, setShowTemplatePickerAnyway] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const justSelectedRef = useRef(false);

  // Debounced autocomplete
  useEffect(() => {
    // Skip when a suggestion was just selected — prevents dropdown flicker
    if (justSelectedRef.current) { justSelectedRef.current = false; return; }
    if (!state.mindRoot.trim()) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      const parent = getParentDir(state.mindRoot) || homeDir;
      fetch('/api/setup/ls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: parent }),
      })
        .then(r => r.json())
        .then(d => {
          if (!d.dirs?.length) { setSuggestions([]); return; }
          // Normalize parent to end with a separator (preserve existing / or \)
          const endsWithSep = parent.endsWith('/') || parent.endsWith('\\');
          const localSep = parent.includes('\\') ? '\\' : '/';
          const parentNorm = endsWithSep ? parent : parent + localSep;
          const typed = state.mindRoot.trim();
          const full: string[] = (d.dirs as string[]).map((dir: string) => parentNorm + dir);
          const endsWithAnySep = typed.endsWith('/') || typed.endsWith('\\');
          const filtered = endsWithAnySep ? full : full.filter(f => f.startsWith(typed));
          setSuggestions(filtered.slice(0, 20));
          setShowSuggestions(filtered.length > 0);
          setActiveSuggestion(-1);
        })
        .catch(e => { console.warn('[SetupWizard] autocomplete fetch failed:', e); setSuggestions([]); });
    }, 300);
    return () => clearTimeout(timer);
  }, [state.mindRoot, homeDir]);

  // Debounced path check
  useEffect(() => {
    if (!state.mindRoot.trim()) { setPathInfo(null); return; }
    const timer = setTimeout(() => {
      fetch('/api/setup/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.mindRoot }),
      })
        .then(r => r.json())
        .then(d => {
          setPathInfo(d);
          setShowTemplatePickerAnyway(false);
          // Non-empty directory: default to skip template (user can opt-in to merge)
          if (d?.exists && !d.empty) update('template', '');
        })
        .catch(e => { console.warn('[SetupWizard] check-path failed:', e); setPathInfo(null); });
    }, 600);
    return () => clearTimeout(timer);
  }, [state.mindRoot, update]);

  const hideSuggestions = () => {
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  };

  const selectSuggestion = (val: string) => {
    justSelectedRef.current = true;
    update('mindRoot', val);
    hideSuggestions();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="space-y-6">
      <Field label={s.kbPath} hint={s.kbPathHint}>
        <div className="relative">
          <input
            ref={inputRef}
            value={state.mindRoot}
            onChange={e => { update('mindRoot', e.target.value); setShowSuggestions(true); }}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => hideSuggestions(), 150)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-sm rounded-lg border outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
            style={{
              background: 'var(--input, var(--card))',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border overflow-auto"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                maxHeight: '220px',
              }}>
              {suggestions.map((suggestion, i) => (
                <button
                  key={suggestion}
                  type="button"
                  role="option"
                  aria-selected={i === activeSuggestion}
                  onMouseDown={() => selectSuggestion(suggestion)}
                  className="w-full text-left px-3 py-2 text-sm font-mono transition-colors"
                  style={{
                    background: i === activeSuggestion ? 'var(--muted)' : 'transparent',
                    color: 'var(--foreground)',
                    borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                  }}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Recommended default — one-click accept */}
        {state.mindRoot !== placeholder && placeholder !== s.kbPathDefault && (
          <button type="button"
            onClick={() => update('mindRoot', placeholder)}
            className="mt-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors hover:bg-muted/50"
            style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
            {s.kbPathUseDefault(placeholder)}
          </button>
        )}
      </Field>
      {/* Template selection — conditional on directory state */}
      {pathInfo && pathInfo.exists && !pathInfo.empty && !showTemplatePickerAnyway ? (
        <div>
          <label className="text-sm text-foreground font-medium mb-3 block">{s.template}</label>
          <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 6%, transparent)' }}>
            <p style={{ color: 'var(--amber)' }}>
              {s.kbPathHasFiles(pathInfo.count)}
            </p>
            <div className="flex gap-2 mt-2">
              <button type="button"
                onClick={() => update('template', '')}
                className="px-2.5 py-1 text-xs rounded-md border transition-colors"
                style={{
                  borderColor: 'var(--amber)',
                  color: state.template === '' ? 'var(--background)' : 'var(--amber)',
                  background: state.template === '' ? 'var(--amber)' : 'transparent',
                }}>
                {state.template === '' ? <>{s.kbTemplateSkip} ✓</> : s.kbTemplateSkip}
              </button>
              <button type="button"
                onClick={() => setShowTemplatePickerAnyway(true)}
                className="px-2.5 py-1 text-xs rounded-md border transition-colors hover:bg-muted/50"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                {s.kbTemplateMerge}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div>
        <label className="text-sm text-foreground font-medium mb-3 block">{s.template}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TEMPLATES.map(tpl => (
            <button key={tpl.id} onClick={() => update('template', tpl.id)}
              className="flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all duration-150"
              style={{
                background: state.template === tpl.id ? 'var(--amber-dim)' : 'var(--card)',
                borderColor: state.template === tpl.id ? 'var(--amber)' : 'var(--border)',
              }}>
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--amber)' }}>{tpl.icon}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.onboarding.templates[tpl.id as 'en' | 'zh' | 'empty'].title}
                </span>
              </div>
              <div className="w-full rounded-lg px-2.5 py-1.5 text-xs leading-relaxed font-display"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                {tpl.dirs.map(d => <div key={d}>{d}</div>)}
              </div>
            </button>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
