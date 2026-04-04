'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, ChevronDown, Check, Settings } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  type ProviderId,
  PROVIDER_PRESETS,
  ALL_PROVIDER_IDS,
  isProviderId,
  getApiKeyEnvVar,
} from '@/lib/agent/providers';

const STORAGE_KEY = 'mindos-provider-override';

interface ProviderModelCapsuleProps {
  value: ProviderId | null;
  onChange: (provider: ProviderId | null) => void;
  disabled?: boolean;
}

interface DropdownPos {
  top: number;
  left: number;
  direction: 'up' | 'down';
}

interface SettingsData {
  ai?: {
    provider?: string;
    providers?: Record<string, { apiKey?: string; model?: string }>;
  };
  envOverrides?: Record<string, boolean>;
}

export function getPersistedProvider(): ProviderId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isProviderId(stored)) return stored;
  } catch { /* localStorage unavailable */ }
  return null;
}

export function persistProvider(provider: ProviderId | null): void {
  try {
    if (provider) {
      localStorage.setItem(STORAGE_KEY, provider);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* localStorage unavailable */ }
}

/**
 * Determine which providers are configured (have an API key set via settings or env).
 * Providers with apiKeyFallback (e.g. Ollama) are always considered configured.
 */
function getConfiguredProviders(data: SettingsData): ProviderId[] {
  const result: ProviderId[] = [];
  const providers = data.ai?.providers ?? {};
  const env = data.envOverrides ?? {};

  for (const id of ALL_PROVIDER_IDS) {
    const preset = PROVIDER_PRESETS[id];
    const hasSettingsKey = providers[id]?.apiKey === '***set***';
    const envVar = getApiKeyEnvVar(id);
    const hasEnvKey = envVar ? !!env[envVar] : false;
    if (hasSettingsKey || hasEnvKey || preset.apiKeyFallback) result.push(id);
  }
  return result;
}

export default function ProviderModelCapsule({
  value,
  onChange,
  disabled = false,
}: ProviderModelCapsuleProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: SettingsData) => { if (!cancelled) setSettingsData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const defaultProvider = (settingsData?.ai?.provider && isProviderId(settingsData.ai.provider))
    ? settingsData.ai.provider as ProviderId
    : 'anthropic';
  const configuredProviders = useMemo(
    () => settingsData ? getConfiguredProviders(settingsData) : [],
    [settingsData],
  );

  // Auto-clear stale override if the provider lost its API key
  useEffect(() => {
    if (!settingsData || !value) return;
    if (!configuredProviders.includes(value)) {
      onChange(null);
      persistProvider(null);
    }
  }, [settingsData, value, configuredProviders, onChange]);

  const activeProvider = value ?? defaultProvider;
  const activePreset = PROVIDER_PRESETS[activeProvider];
  const activeModel = settingsData?.ai?.providers?.[activeProvider]?.model || activePreset.defaultModel;
  const displayName = locale === 'zh' ? activePreset.nameZh : activePreset.name;

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedH = 240;
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

  const handleSelect = useCallback((provider: ProviderId | null) => {
    onChange(provider);
    persistProvider(provider);
    setOpen(false);
  }, [onChange]);

  if (!settingsData || configuredProviders.length === 0) return null;

  const modelShort = activeModel.length > 24
    ? activeModel.slice(0, 22) + '…'
    : activeModel;

  const dropdown = open && pos ? (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={t.ask.providerCapsule}
      className="fixed z-50 min-w-[200px] max-w-[280px] rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        left: pos.left,
        ...(pos.direction === 'up'
          ? { bottom: window.innerHeight - pos.top }
          : { top: pos.top }),
      }}
    >
      {/* Default (use server settings) */}
      <button
        type="button"
        role="option"
        aria-selected={value === null}
        onClick={() => handleSelect(null)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-muted"
      >
        <Settings size={12} className="shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{t.ask.providerDefault}</div>
          <div className="text-2xs text-muted-foreground mt-0.5">
            {locale === 'zh'
              ? PROVIDER_PRESETS[defaultProvider].nameZh
              : PROVIDER_PRESETS[defaultProvider].name} · {settingsData?.ai?.providers?.[defaultProvider]?.model || PROVIDER_PRESETS[defaultProvider].defaultModel}
          </div>
        </div>
        {value === null && <Check size={12} className="shrink-0 text-[var(--amber)]" />}
      </button>

      {configuredProviders.length > 0 && (
        <div className="mx-2 my-1 border-t border-border/60" />
      )}

      {configuredProviders.map((id) => {
        const preset = PROVIDER_PRESETS[id];
        const provName = locale === 'zh' ? preset.nameZh : preset.name;
        const provModel = settingsData?.ai?.providers?.[id]?.model || preset.defaultModel;
        const isSelected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => handleSelect(id)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-muted"
          >
            <Cpu size={12} className="shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{provName}</div>
              <div className="text-2xs text-muted-foreground mt-0.5 truncate">{provModel}</div>
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
          ${value
            ? 'bg-[var(--amber)]/10 border-[var(--amber)]/25 text-foreground hover:bg-[var(--amber)]/15'
            : 'bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
          }
        `}
        title={t.ask.providerCapsule}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Cpu size={11} className="shrink-0" />
        <span className="truncate max-w-[140px]">
          {displayName}
          <span className="text-muted-foreground"> · </span>
          <span className="text-muted-foreground">{modelShort}</span>
        </span>
        <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
      </button>
      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </>
  );
}
