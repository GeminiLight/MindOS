'use client';

import { useState, useRef, useCallback } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { useMcpData } from '@/hooks/useMcpData';
import { useLocale } from '@/lib/LocaleContext';
import { Toggle } from '../settings/Primitives';
import type { SkillInfo } from '../settings/types';
import PanelHeader from './PanelHeader';
import { AgentsPanelHubNav } from './AgentsPanelHubNav';
import { AgentsPanelAgentGroups } from './AgentsPanelAgentGroups';

interface AgentsPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function AgentsPanel({ active, maximized, onMaximize }: AgentsPanelProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const d = t.panels.discover;
  const mcp = useMcpData();
  const [refreshing, setRefreshing] = useState(false);
  const [showNotDetected, setShowNotDetected] = useState(false);
  const [showBuiltinSkills, setShowBuiltinSkills] = useState(false);
  const [openAgentKey, setOpenAgentKey] = useState<string | null>(null);

  const overviewRef = useRef<HTMLDivElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    await mcp.refresh();
    setRefreshing(false);
  };

  const scrollTo = useCallback((el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const openAdvancedConfig = () => {
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'mcp' } }));
  };

  const connected = mcp.agents.filter(a => a.present && a.installed);
  const detected = mcp.agents.filter(a => a.present && !a.installed);
  const notFound = mcp.agents.filter(a => !a.present);

  const customSkills = mcp.skills.filter(s => s.source === 'user');
  const builtinSkills = mcp.skills.filter(s => s.source === 'builtin');
  const activeSkillCount = mcp.skills.filter(s => s.enabled).length;

  const agentCopy = {
    connected: p.connected,
    installing: p.installing,
    install: p.install,
    copyConfig: p.copyConfig,
    copied: p.copied,
    transportLocal: p.transportLocal,
    transportRemote: p.transportRemote,
    configPath: p.configPath,
    notFoundDetail: p.notFoundDetail,
  };

  const toggleAgentRow = (key: string) => {
    setOpenAgentKey(prev => (prev === key ? null : key));
  };

  const hubCopy = {
    navOverview: p.navOverview,
    navMcp: p.navMcp,
    navSkills: p.navSkills,
    navUsage: p.navUsage,
    navInsights: p.navInsights,
  };

  const hub = (
    <AgentsPanelHubNav
      copy={hubCopy}
      comingSoon={d.comingSoon}
      connectedCount={connected.length}
      overviewRef={overviewRef}
      skillsRef={skillsRef}
      scrollTo={scrollTo}
      openAdvancedConfig={openAdvancedConfig}
    />
  );

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={p.title} maximized={maximized} onMaximize={onMaximize}>
        <div className="flex items-center gap-1.5">
          {!mcp.loading && (
            <span className="text-2xs text-muted-foreground">
              {connected.length} {p.connected}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={p.refresh}
            title={p.refresh}
            type="button"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        {mcp.loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : mcp.agents.length === 0 && mcp.skills.length === 0 ? (
          <div className="flex flex-col gap-2 py-4 px-0">
            {hub}
            <div className="mx-4 border-t border-border" />
            <div ref={overviewRef} className="mx-3 rounded-lg border border-border bg-card/50 px-3 py-2.5 flex items-center justify-between scroll-mt-2">
              <span className="text-xs font-medium text-foreground">{p.mcpServer}</span>
              {mcp.status?.running ? (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="text-emerald-600 dark:text-emerald-400">:{mcp.status.port}</span>
                  <span className="text-muted-foreground">· {mcp.status.toolCount} tools</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
                  <span className="text-muted-foreground">{p.stopped}</span>
                </span>
              )}
            </div>
            <div ref={skillsRef} className="mx-3 scroll-mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-center">
              <p className="text-xs text-muted-foreground mb-2">{p.noAgents}</p>
              <p className="text-2xs text-muted-foreground mb-3">{p.skillsEmptyHint}</p>
              <button
                onClick={handleRefresh}
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw size={11} /> {p.retry}
              </button>
            </div>
          </div>
        ) : (
          <div className="pb-3">
            {hub}

            <div className="mx-4 border-t border-border" />

            <div className="px-3 py-3 space-y-4">
              <div ref={overviewRef} className="rounded-lg border border-border bg-card/50 px-3 py-2.5 flex items-center justify-between scroll-mt-2">
                <span className="text-xs font-medium text-foreground">{p.mcpServer}</span>
                {mcp.status?.running ? (
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    <span className="text-emerald-600 dark:text-emerald-400">:{mcp.status.port}</span>
                    <span className="text-muted-foreground">· {mcp.status.toolCount} tools</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
                    <span className="text-muted-foreground">{p.stopped}</span>
                  </span>
                )}
              </div>

              <AgentsPanelAgentGroups
                connected={connected}
                detected={detected}
                notFound={notFound}
                openAgentKey={openAgentKey}
                toggleAgentRow={toggleAgentRow}
                mcp={mcp}
                agentCopy={agentCopy}
                showNotDetected={showNotDetected}
                setShowNotDetected={setShowNotDetected}
                p={{
                  rosterLabel: p.rosterLabel,
                  sectionConnected: p.sectionConnected,
                  sectionDetected: p.sectionDetected,
                  sectionNotDetected: p.sectionNotDetected,
                }}
              />

              <section ref={skillsRef} className="scroll-mt-2">
                {mcp.skills.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        {p.skillsTitle} <span className="normal-case font-normal">{activeSkillCount} {p.skillsActive}</span>
                      </h3>
                      <button
                        type="button"
                        onClick={openAdvancedConfig}
                        className="text-2xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {p.newSkill}
                      </button>
                    </div>

                    {customSkills.length > 0 && (
                      <div className="space-y-0.5 mb-2">
                        {customSkills.map(skill => (
                          <SkillRow key={skill.name} skill={skill} onToggle={mcp.toggleSkill} />
                        ))}
                      </div>
                    )}

                    {builtinSkills.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowBuiltinSkills(!showBuiltinSkills)}
                          className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors mb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        >
                          {showBuiltinSkills ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          {p.builtinSkills} ({builtinSkills.length})
                        </button>
                        {showBuiltinSkills && (
                          <div className="space-y-0.5">
                            {builtinSkills.map(skill => (
                              <SkillRow key={skill.name} skill={skill} onToggle={mcp.toggleSkill} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-2xs text-muted-foreground py-1">{p.skillsEmptyHint}</p>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border shrink-0">
        <button
          type="button"
          onClick={openAdvancedConfig}
          className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <Settings size={11} />
          {p.advancedConfig}
        </button>
      </div>
    </div>
  );
}

function SkillRow({ skill, onToggle }: { skill: SkillInfo; onToggle: (name: string, enabled: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors">
      <span className="text-xs text-foreground truncate">{skill.name}</span>
      <Toggle size="sm" checked={skill.enabled} onChange={v => onToggle(skill.name, v)} />
    </div>
  );
}
