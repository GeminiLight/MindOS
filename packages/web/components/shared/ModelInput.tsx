'use client';

import { useState, useRef, useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Input } from '@/components/settings/Primitives';
import { type ProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';

export interface ModelInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  provider: ProviderId;
  apiKey: string;
  envKey?: boolean;
  baseUrl?: string;
  supportsListModels: boolean;
  allowNoKey?: boolean;
  browseLabel?: string;
  noModelsLabel?: string;
}

export default function ModelInput({
  value, onChange, placeholder, provider, apiKey, envKey, baseUrl,
  supportsListModels, allowNoKey,
  browseLabel = 'Browse',
  noModelsLabel = 'No models found',
}: ModelInputProps) {
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const fetchedRef = useRef(false);
  const fetchVersionRef = useRef(0);
  const loadingRef = useRef(false);

  const hasKey = allowNoKey || !!apiKey || !!envKey || !!PROVIDER_PRESETS[provider]?.apiKeyFallback;

  useEffect(() => {
    fetchedRef.current = false;
    fetchVersionRef.current++;
    setModels(null);
  }, [provider, apiKey, baseUrl]);

  const fetchModels = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    if (!silent) setError('');
    const version = fetchVersionRef.current;
    try {
      const body: Record<string, string> = { provider };
      if (apiKey) body.apiKey = apiKey;
      if (baseUrl) body.baseUrl = baseUrl;

      const res = await fetch('/api/settings/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (version !== fetchVersionRef.current) return;
      const json = await res.json();
      if (version !== fetchVersionRef.current) return;
      if (json.ok && Array.isArray(json.models)) {
        setModels(json.models);
        fetchedRef.current = true;
        if (!silent) setOpen(true);
      } else if (!silent) {
        setError(json.error || 'Failed to fetch models');
      }
    } catch {
      if (version !== fetchVersionRef.current) return;
      if (!silent) setError('Network error');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [provider, apiKey, baseUrl]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (!fetchedRef.current && supportsListModels && hasKey && !loadingRef.current) {
      fetchModels(true);
    }
  }, [supportsListModels, hasKey, fetchModels]);

  const filtered = useMemo(() => {
    if (!models) return [];
    if (!value.trim()) return models;
    const q = value.toLowerCase();
    return [...models].sort((a, b) => {
      const al = a.toLowerCase(), bl = b.toLowerCase();
      const aMatch = al.includes(q), bMatch = bl.includes(q);
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      if (aMatch && bMatch) {
        const aPrefix = al.startsWith(q), bPrefix = bl.startsWith(q);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
        const aExact = al === q, bExact = bl === q;
        if (aExact !== bExact) return aExact ? -1 : 1;
      }
      return a.localeCompare(b);
    });
  }, [models, value]);

  const showDropdown = open || (focused && models !== null && value.trim().length > 0 && filtered.length > 0);

  // Compute fixed position for dropdown so it escapes overflow:auto ancestors
  useEffect(() => {
    if (!showDropdown || !inputRowRef.current) return;
    const rect = inputRowRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, [showDropdown]);

  useEffect(() => { setHighlightIdx(-1); }, [filtered]);

  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-model-item]');
    items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = showDropdown ? filtered : [];
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && highlightIdx >= 0 && highlightIdx < items.length) {
      e.preventDefault();
      onChange(items[highlightIdx]);
      setOpen(false);
      setFocused(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setFocused(false);
    }
  }, [showDropdown, filtered, highlightIdx, onChange]);

  useEffect(() => {
    if (!showDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  return (
    <div ref={containerRef} className="relative">
      <div ref={inputRowRef} className="flex gap-1.5">
        <Input
          value={value}
          onChange={e => { onChange(e.target.value); if (!open) setFocused(true); }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1"
          autoComplete="off"
        />
        {supportsListModels && (
          <button
            type="button"
            disabled={!hasKey || loading}
            onClick={() => fetchModels(false)}
            title={browseLabel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
            {browseLabel}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-error mt-1">{error}</p>}
      {showDropdown && filtered.length > 0 && (
        <div ref={listRef} style={dropdownStyle} className="fixed z-50 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {filtered.map((m, i) => {
            const isMatch = !value.trim() || m.toLowerCase().includes(value.toLowerCase());
            return (
              <button
                key={m}
                type="button"
                data-model-item
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  m === value ? 'bg-accent/60 font-medium'
                  : i === highlightIdx ? 'bg-accent'
                  : 'hover:bg-accent'
                } ${!isMatch ? 'opacity-50' : ''}`}
                onClick={() => { onChange(m); setOpen(false); setFocused(false); }}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div style={dropdownStyle} className="fixed z-50 rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs text-muted-foreground">
          {noModelsLabel}
        </div>
      )}
    </div>
  );
}
