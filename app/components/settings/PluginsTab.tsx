'use client';

import { Puzzle } from 'lucide-react';
import { getAllRenderers, setRendererEnabled } from '@/lib/renderers/registry';

interface PluginsTabProps {
  pluginStates: Record<string, boolean>;
  setPluginStates: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  t: any;
}

export function PluginsTab({ pluginStates, setPluginStates, t }: PluginsTabProps) {
  return (
    <div className="space-y-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.settings.plugins.title}</p>

      {getAllRenderers().length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.settings.plugins.noPlugins}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {getAllRenderers().map(renderer => {
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
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/15 text-amber-600 font-mono">
                            core
                          </span>
                        )}
                        {renderer.builtin && !isCore && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                            {t.settings.plugins.builtinBadge}
                          </span>
                        )}
                        <div className="flex gap-1 flex-wrap">
                          {renderer.tags.map(tag => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{renderer.description}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-1.5 font-mono">
                        {t.settings.plugins.matchHint}: <code className="bg-muted px-1 rounded">{renderer.match.toString().match(/\/(.+)\//)?.[1] ?? '—'}</code>
                      </p>
                    </div>
                  </div>

                  {isCore ? (
                    <span
                      className="shrink-0 w-9 h-5 rounded-full bg-amber-600 relative cursor-not-allowed opacity-60"
                      title={t.settings.plugins.coreHint ?? 'Core renderer — always enabled'}
                    >
                      <span className="absolute top-[3px] left-[18px] w-3.5 h-3.5 rounded-full shadow-sm bg-white" />
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        const next = !enabled;
                        setRendererEnabled(renderer.id, next);
                        setPluginStates(s => ({ ...s, [renderer.id]: next }));
                      }}
                      role="switch"
                      aria-checked={enabled}
                      className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${enabled ? 'bg-amber-600' : 'bg-muted border border-border'}`}
                      title={enabled ? t.settings.plugins.enabled : t.settings.plugins.disabled}
                    >
                      <span
                        className={`absolute top-[3px] w-3.5 h-3.5 rounded-full shadow-sm transition-all ${enabled ? 'left-[18px] bg-white' : 'left-[3px] bg-muted-foreground/50'}`}
                      />
                    </button>
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
