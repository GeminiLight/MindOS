'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAllRenderers, isRendererEnabled, setRendererEnabled, loadDisabledState } from '@/lib/renderers/registry';
import { Toggle } from '../settings/Primitives';
import PanelHeader from './PanelHeader';

interface PluginsPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function PluginsPanel({ active, maximized, onMaximize }: PluginsPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [, forceUpdate] = useState(0);
  const router = useRouter();

  // Defer renderer reads to client only — avoids hydration mismatch
  useEffect(() => {
    loadDisabledState();
    setMounted(true);
  }, []);

  const renderers = mounted ? getAllRenderers() : [];
  const enabledCount = mounted ? renderers.filter(r => isRendererEnabled(r.id)).length : 0;

  const handleToggle = (id: string, enabled: boolean) => {
    setRendererEnabled(id, enabled);
    forceUpdate(n => n + 1);
    window.dispatchEvent(new Event('renderer-state-changed'));
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      {/* Header */}
      <PanelHeader title="Plugins" maximized={maximized} onMaximize={onMaximize}>
        <span className="text-2xs text-muted-foreground">{enabledCount}/{renderers.length} active</span>
      </PanelHeader>

      {/* Plugin list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {mounted && renderers.length === 0 && (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">No plugins registered</p>
        )}
        {renderers.map(r => {
          const enabled = isRendererEnabled(r.id);
          return (
            <div
              key={r.id}
              className="px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors"
            >
              {/* Top row: icon + name + toggle */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base shrink-0">{r.icon}</span>
                  <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                  {r.core && (
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">Core</span>
                  )}
                </div>
                <Toggle
                  checked={enabled}
                  onChange={(v) => handleToggle(r.id, v)}
                  size="sm"
                  disabled={r.core}
                  title={r.core ? 'Core plugin — cannot be disabled' : undefined}
                />
              </div>

              {/* Description */}
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed pl-[30px]">
                {r.description}
              </p>

              {/* Tags + entry path */}
              <div className="mt-1.5 flex items-center gap-1.5 pl-[30px] flex-wrap">
                {r.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-2xs px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                    {tag}
                  </span>
                ))}
                {r.entryPath && enabled && (
                  <button
                    onClick={() => router.push(`/view/${r.entryPath!.split('/').map(encodeURIComponent).join('/')}`)}
                    className="text-2xs px-1.5 py-0.5 rounded-full text-[var(--amber)] hover:bg-[var(--amber-dim)] transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    → {r.entryPath}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer info */}
      <div className="px-4 py-2 border-t border-border shrink-0">
        <p className="text-2xs text-muted-foreground">
          Plugins customize how files render. Core plugins cannot be disabled.
        </p>
      </div>
    </div>
  );
}
