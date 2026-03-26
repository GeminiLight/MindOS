'use client';

import { Puzzle } from 'lucide-react';
import { getPluginRenderers, setRendererEnabled } from '@/lib/renderers/registry';
import { Toggle } from './Primitives';
import type { PluginsTabProps } from './types';

export function PluginsTab({ pluginStates, setPluginStates, t }: PluginsTabProps) {
  const renderers = getPluginRenderers();
  return (
    <div className="space-y-6">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.settings.plugins.title}</p>

      {renderers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.settings.plugins.noPlugins}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {renderers.map(renderer => {
            const isCore = !!renderer.core;
            const enabled = isCore ? true : (pluginStates[renderer.id] ?? true);
            return (
              <div
                key={renderer.id}
                className={`border rounded-xl p-4 transition-colors ${enabled ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none mt-0.5">{renderer.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{renderer.name}</span>
                        {isCore && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-[var(--amber-subtle)] text-[var(--amber)] font-mono">
                            core
                          </span>
                        )}
                        {renderer.builtin && !isCore && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                            {t.settings.plugins.builtinBadge}
                          </span>
                        )}
                        <div className="flex gap-1 flex-wrap">
                          {renderer.tags.map(tag => (
                            <span key={tag} className="text-2xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{renderer.description}</p>
                      <p className="text-xs text-muted-foreground/60 mt-1.5 font-mono">
                        {t.settings.plugins.matchHint}: <code className="bg-muted px-1 rounded">{renderer.match.toString().match(/\/(.+)\//)?.[1] ?? '—'}</code>
                      </p>
                    </div>
                  </div>

                  {isCore ? (
                    <Toggle checked={true} disabled />
                  ) : (
                    <Toggle checked={enabled} onChange={(next) => { setRendererEnabled(renderer.id, next); setPluginStates(s => ({ ...s, [renderer.id]: next })); }} title={enabled ? t.settings.plugins.enabled : t.settings.plugins.disabled} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed border-border rounded-xl px-4 py-3">
        <Puzzle size={13} className="shrink-0" />
        <span>{t.settings.plugins.comingSoon}</span>
      </div>
    </div>
  );
}
