'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Lightbulb, Blocks, Zap, LayoutTemplate, User, Download, RefreshCw, Repeat, Rocket, Search, Handshake, ShieldCheck, ChevronDown } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PanelNavRow, ComingSoonBadge } from './PanelNavRow';
import { useLocale } from '@/lib/LocaleContext';
import { useCases } from '@/components/explore/use-cases';
import { openAskModal } from '@/hooks/useAskModal';
import { getPluginRenderers, isRendererEnabled, setRendererEnabled, loadDisabledState } from '@/lib/renderers/registry';
import { Toggle } from '../settings/Primitives';

interface DiscoverPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

/** Compact use case row */
function UseCaseRow({
  icon,
  title,
  prompt,
  tryLabel,
}: {
  icon: React.ReactNode;
  title: string;
  prompt: string;
  tryLabel: string;
}) {
  return (
    <div className="group flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50 transition-colors rounded-sm mx-1">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs text-foreground truncate flex-1">{title}</span>
      <button
        onClick={() => openAskModal(prompt, 'user')}
        className="opacity-0 group-hover:opacity-100 text-2xs px-2 py-0.5 rounded text-[var(--amber-text)] bg-[var(--amber-dim)] hover:opacity-80 transition-all duration-150 shrink-0"
      >
        {tryLabel}
      </button>
    </div>
  );
}

/** Map use case id → lucide icon */
const useCaseIcons: Record<string, React.ReactNode> = {
  c1: <User size={12} />,          // Inject Identity
  c2: <Download size={12} />,      // Save Information
  c3: <RefreshCw size={12} />,     // Cross-Agent Handoff
  c4: <Repeat size={12} />,        // Experience → SOP
  c5: <Lightbulb size={12} />,     // Capture Ideas
  c6: <Rocket size={12} />,        // Project Cold Start
  c7: <Search size={12} />,        // Research & Archive
  c8: <Handshake size={12} />,     // Network Management
  c9: <ShieldCheck size={12} />,   // Audit & Correct
};

export default function DiscoverPanel({ active, maximized, onMaximize }: DiscoverPanelProps) {
  const { t } = useLocale();
  const d = t.panels.discover;
  const e = t.explore;
  const p = t.panels.plugins;
  const router = useRouter();

  const [pluginsMounted, setPluginsMounted] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [, forceUpdate] = useState(0);
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set());
  const fetchedRef = useRef(false);

  useEffect(() => {
    loadDisabledState();
    setPluginsMounted(true);
  }, []);

  useEffect(() => {
    if (!pluginsMounted || fetchedRef.current) return;
    fetchedRef.current = true;
    const entryPaths = getPluginRenderers().map(r => r.entryPath).filter((ep): ep is string => !!ep);
    if (entryPaths.length === 0) return;
    fetch('/api/files')
      .then(r => r.ok ? r.json() : [])
      .then((allPaths: string[]) => {
        const pathSet = new Set(allPaths);
        setExistingFiles(new Set(entryPaths.filter(ep => pathSet.has(ep))));
      })
      .catch(() => {});
  }, [pluginsMounted]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setRendererEnabled(id, enabled);
    forceUpdate(n => n + 1);
    window.dispatchEvent(new Event('renderer-state-changed'));
  }, []);

  const handleOpenPlugin = useCallback((entryPath: string) => {
    router.push(`/view/${entryPath.split('/').map(encodeURIComponent).join('/')}`);
  }, [router]);

  const getUseCaseText = (id: string): { title: string; prompt: string } | undefined => {
    const map: Record<string, { title: string; desc: string; prompt: string }> = {
      c1: e.c1, c2: e.c2, c3: e.c3, c4: e.c4, c5: e.c5,
      c6: e.c6, c7: e.c7, c8: e.c8, c9: e.c9,
    };
    return map[id];
  };

  const renderers = pluginsMounted ? getPluginRenderers() : [];
  const enabledCount = pluginsMounted ? renderers.filter(r => isRendererEnabled(r.id)).length : 0;

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={d.title} maximized={maximized} onMaximize={onMaximize} />
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Navigation entries */}
        <div className="py-2">
          <PanelNavRow
            icon={<Lightbulb size={14} className="text-[var(--amber)]" />}
            title={d.useCases}
            badge={<span className="text-2xs tabular-nums text-muted-foreground">{useCases.length}</span>}
            href="/explore"
          />
          <PanelNavRow
            icon={<Blocks size={14} className="text-muted-foreground" />}
            title={d.pluginMarket}
            badge={<ComingSoonBadge label={d.comingSoon} />}
          />
          <PanelNavRow
            icon={<Zap size={14} className="text-muted-foreground" />}
            title={d.skillMarket}
            badge={<ComingSoonBadge label={d.comingSoon} />}
          />
          <PanelNavRow
            icon={<LayoutTemplate size={14} className="text-muted-foreground" />}
            title={d.spaceTemplates}
            badge={<ComingSoonBadge label={d.comingSoon} />}
          />
        </div>

        <div className="mx-4 border-t border-border" />

        {/* Installed extensions (merged from Plugins panel) */}
        <div className="py-2">
          <button
            type="button"
            onClick={() => setShowPlugins(v => !v)}
            className="w-full flex items-center gap-1.5 px-4 py-1.5 text-left"
          >
            <ChevronDown size={11} className={`text-muted-foreground transition-transform duration-150 ${showPlugins ? '' : '-rotate-90'}`} />
            <Blocks size={13} className="text-muted-foreground shrink-0" />
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider flex-1">
              {p.title}
            </span>
            <span className="text-2xs text-muted-foreground tabular-nums">{enabledCount}/{renderers.length}</span>
          </button>
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${showPlugins ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden" {...(!showPlugins && { inert: true } as React.HTMLAttributes<HTMLDivElement>)}>
              {renderers.map(r => {
                const enabled = isRendererEnabled(r.id);
                const fileExists = r.entryPath ? existingFiles.has(r.entryPath) : false;
                const canOpen = enabled && r.entryPath && fileExists;
                return (
                  <div
                    key={r.id}
                    className={`flex items-center gap-2 px-4 py-1.5 mx-1 rounded-sm transition-colors ${canOpen ? 'cursor-pointer hover:bg-muted/50' : ''} ${!enabled ? 'opacity-50' : ''}`}
                    onClick={canOpen ? () => handleOpenPlugin(r.entryPath!) : undefined}
                    role={canOpen ? 'link' : undefined}
                    tabIndex={canOpen ? 0 : undefined}
                    onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenPlugin(r.entryPath!); } } : undefined}
                  >
                    <span className="text-sm shrink-0" suppressHydrationWarning>{r.icon}</span>
                    <span className="text-xs text-foreground truncate flex-1">{r.name}</span>
                    {r.core ? (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{p.core}</span>
                    ) : (
                      <div onClick={e => e.stopPropagation()}>
                        <Toggle checked={enabled} onChange={v => handleToggle(r.id, v)} size="sm" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mx-4 border-t border-border" />

        {/* Quick try — use case list */}
        <div className="py-2">
          <div className="px-4 py-1.5">
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{d.useCases}</span>
          </div>
          {useCases.map(uc => {
            const data = getUseCaseText(uc.id);
            if (!data) return null;
            return (
              <UseCaseRow
                key={uc.id}
                icon={useCaseIcons[uc.id] || <Lightbulb size={12} />}
                title={data.title}
                prompt={data.prompt}
                tryLabel={d.tryIt}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
