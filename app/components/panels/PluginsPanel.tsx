'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getPluginRenderers, isRendererEnabled, setRendererEnabled, loadDisabledState } from '@/lib/renderers/registry';
import { Toggle } from '../settings/Primitives';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/LocaleContext';

interface PluginsPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function PluginsPanel({ active, maximized, onMaximize }: PluginsPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [, forceUpdate] = useState(0);
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set());
  const router = useRouter();
  const { t } = useLocale();
  const p = t.panels.plugins;

  // Defer renderer reads to client only — avoids hydration mismatch
  useEffect(() => {
    loadDisabledState();
    setMounted(true);
  }, []);

  // Check which entry files exist — fetch once on mount, cache result
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!mounted || fetchedRef.current) return;
    fetchedRef.current = true;
    const entryPaths = getPluginRenderers()
      .map(r => r.entryPath)
      .filter((p): p is string => !!p);
    if (entryPaths.length === 0) return;

    // Single request: fetch all file paths and check which entry paths exist
    fetch('/api/files')
      .then(r => r.ok ? r.json() : [])
      .then((allPaths: string[]) => {
        const pathSet = new Set(allPaths);
        setExistingFiles(new Set(entryPaths.filter(p => pathSet.has(p))));
      })
      .catch((err) => { console.warn("[PluginsPanel] fetch /api/files failed:", err); });
  }, [mounted]);

  const renderers = mounted ? getPluginRenderers() : [];
  const enabledCount = mounted ? renderers.filter(r => isRendererEnabled(r.id)).length : 0;

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setRendererEnabled(id, enabled);
    forceUpdate(n => n + 1);
    window.dispatchEvent(new Event('renderer-state-changed'));
  }, []);

  const handleOpen = useCallback((entryPath: string) => {
    router.push(`/view/${entryPath.split('/').map(encodeURIComponent).join('/')}`);
  }, [router]);

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      {/* Header */}
      <PanelHeader title={p.title} maximized={maximized} onMaximize={onMaximize}>
        <span className="text-2xs text-muted-foreground">{enabledCount}/{renderers.length} {p.active}</span>
      </PanelHeader>

      {/* Plugin list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {mounted && renderers.length === 0 && (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">{p.noPlugins}</p>
        )}
        {renderers.map(r => {
          const enabled = isRendererEnabled(r.id);
          const fileExists = r.entryPath ? existingFiles.has(r.entryPath) : false;
          const canOpen = enabled && r.entryPath && fileExists;

          return (
            <div
              key={r.id}
              className={`
                px-4 py-3 border-b border-border/50 transition-colors
                ${canOpen ? 'cursor-pointer hover:bg-muted/40' : 'hover:bg-muted/20'}
                ${!enabled ? 'opacity-50' : ''}
              `}
              onClick={canOpen ? () => handleOpen(r.entryPath!) : undefined}
              onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(r.entryPath!); } } : undefined}
              role={canOpen ? 'link' : undefined}
              tabIndex={canOpen ? 0 : undefined}
            >
              {/* Top row: status dot + icon + name + toggle */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status dot */}
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: !enabled
                        ? 'var(--muted-foreground)'
                        : canOpen
                          ? 'var(--success)'
                          : 'var(--border)',
                    }}
                    title={
                      !enabled
                        ? p.disabled ?? 'Disabled'
                        : canOpen
                          ? p.ready ?? 'Ready'
                          : p.noFile ?? 'File not found'
                    }
                  />
                  <span className="text-base shrink-0" suppressHydrationWarning>{r.icon}</span>
                  <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                  {r.core && (
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{p.core}</span>
                  )}
                </div>
                {/* Toggle — stop propagation to prevent row click */}
                <div onClick={e => e.stopPropagation()}>
                  <Toggle
                    checked={enabled}
                    onChange={(v) => handleToggle(r.id, v)}
                    size="sm"
                    disabled={r.core}
                    title={r.core ? p.coreDisabled : undefined}
                  />
                </div>
              </div>

              {/* Description */}
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed pl-[34px]">
                {r.description}
              </p>

              {/* Tags + status hint */}
              <div className="mt-1.5 flex items-center gap-1.5 pl-[34px] flex-wrap">
                {r.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-2xs px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                    {tag}
                  </span>
                ))}
                {r.entryPath && enabled && !fileExists && (
                  <span className="text-2xs text-[var(--amber-text)]">
                    {(p.createFile ?? 'Create {file}').replace('{file}', r.entryPath)}
                  </span>
                )}
                {canOpen && (
                  <span className="text-2xs text-[var(--amber-text)]">
                    → {r.entryPath}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer info */}
      <div className="px-4 py-2 border-t border-border shrink-0">
        <p className="text-2xs text-muted-foreground">
          {p.footer}
        </p>
      </div>
    </div>
  );
}
