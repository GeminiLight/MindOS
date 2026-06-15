'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Clock, Globe, Loader2, RefreshCw, Settings } from 'lucide-react';
import { useMcpData } from '@/lib/stores/mcp-store';
import { useA2aRegistry } from '@/hooks/useA2aRegistry';
import { useLocale } from '@/lib/stores/locale-store';
import PanelHeader from './PanelHeader';
import { AgentsPanelHubNav } from './AgentsPanelHubNav';
import { AgentsPanelAgentGroups } from './AgentsPanelAgentGroups';
import DiscoverAgentModal from '../agents/DiscoverAgentModal';
import IMChannelsView from './IMChannelsView';
import AgentsRuntimeSection from '../agents/AgentsRuntimeSection';

interface AgentsPanelProps {
  active: boolean;
  selectedAgentKey?: string | null;
}

export default function AgentsPanel({
  active,
  selectedAgentKey = null,
}: AgentsPanelProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const localClientsCopy = t.agentsContent.localClients;
  const mcp = useMcpData();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isChannelsTab = pathname === '/agents' && searchParams.get('tab') === 'channels';
  const isAgentTab = pathname === '/agents' && searchParams.get('tab') === 'agent';
  const [refreshing, setRefreshing] = useState(false);
  const [showNotDetected, setShowNotDetected] = useState(false);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const a2a = useA2aRegistry();

  const handleRefresh = async () => {
    setRefreshing(true);
    await mcp.refresh({ force: true });
    setRefreshing(false);
  };

  const openAdvancedConfig = () => {
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'mcp' } }));
  };

  const connected = mcp.agents.filter(a => a.present && a.installed);
  const detected = mcp.agents.filter(a => a.present && !a.installed);
  const notFound = mcp.agents.filter(a => !a.present);

  const installAgentWithRefresh = async (key: string) => {
    const ok = await mcp.installAgent(key);
    if (ok) await mcp.refresh();
    return ok;
  };

  const routeSelectedAgentKey = pathname?.startsWith('/agents/')
    ? decodeURIComponent(pathname.slice('/agents/'.length))
    : null;
  const effectiveSelectedAgentKey = routeSelectedAgentKey ?? selectedAgentKey;

  const listCopy = {
    installing: p.installing,
    install: p.install,
    installSuccess: p.installSuccess,
    installFailed: p.installFailed,
    retryInstall: p.retryInstall,
  };

  const hubCopy = {
    navOverview: p.navOverview,
    navAssistant: p.navAssistant,
    navAgent: p.navAgent,
    navCapabilities: p.navCapabilities,
    navPresets: p.navPresets,
    navMcp: p.navMcp,
    navSkills: p.navSkills,
    navChannels: p.channels,
    navNetwork: p.navNetwork,
    navSessions: p.navSessions,
    navActivity: p.navActivity,
  };

  const hub = (
    <AgentsPanelHubNav
      copy={hubCopy}
      connectedCount={connected.length}
      channelsActive={isChannelsTab}
    />
  );

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={p.title} />

      <div className="flex-1 overflow-y-auto min-h-0">
        {isAgentTab ? (
          <div className="pb-3">
            {hub}
            <div className="mx-4 border-t border-border" />
            <AgentsRuntimeSection
              variant="panel"
            />
            {mcp.loading ? (
              <div className="flex justify-center py-5">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : mcp.agents.length > 0 ? (
              <div className="border-t border-border/60 px-3 py-3">
                <AgentsPanelAgentGroups
                  connected={connected}
                  detected={detected}
                  notFound={notFound}
                  selectedAgentKey={effectiveSelectedAgentKey}
                  listCopy={listCopy}
                  onInstallAgent={installAgentWithRefresh}
                  showNotDetected={showNotDetected}
                  setShowNotDetected={setShowNotDetected}
                  p={{
                    rosterLabel: localClientsCopy.panelTitle,
                    sectionConnected: localClientsCopy.statusConnected,
                    sectionDetected: localClientsCopy.statusDetected,
                    sectionNotDetected: localClientsCopy.statusNotFound,
                    showMore: localClientsCopy.showMore,
                  }}
                />
              </div>
            ) : (
              <div className="border-t border-border/60 px-3 py-4">
                <p className="text-xs text-muted-foreground">{localClientsCopy.emptyTitle}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="pb-3">
            {hub}
            <div className="mx-4 border-t border-border" />
            {isChannelsTab ? (
              <IMChannelsView />
            ) : mcp.loading ? (
              <div className="flex justify-center py-8" aria-busy="true">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : mcp.agents.length === 0 && mcp.skills.length === 0 ? (
              <div className="mx-3 rounded-lg border border-border/40 bg-card/30 px-3 py-5 text-center">
                <p className="text-xs text-muted-foreground/70 mb-1.5">{p.noAgents}</p>
                <p className="text-2xs text-muted-foreground/40 mb-3">{p.skillsEmptyHint}</p>
                <button
                  onClick={handleRefresh}
                  type="button"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw size={11} /> {p.retry}
                </button>
              </div>
            ) : (
              <div className="px-3 py-3 space-y-4">
                <AgentsPanelAgentGroups
                  connected={connected}
                  detected={detected}
                  notFound={notFound}
                  selectedAgentKey={effectiveSelectedAgentKey}
                  listCopy={listCopy}
                  onInstallAgent={installAgentWithRefresh}
                  showNotDetected={showNotDetected}
                  setShowNotDetected={setShowNotDetected}
                  p={{
                    rosterLabel: localClientsCopy.panelTitle,
                    sectionConnected: localClientsCopy.statusConnected,
                    sectionDetected: localClientsCopy.statusDetected,
                    sectionNotDetected: localClientsCopy.statusNotFound,
                    showMore: localClientsCopy.showMore,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border shrink-0 space-y-1">
        <Link
          href="/agents?tab=runs"
          className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <Clock size={11} />
          {p.navActivity ?? p.navRuns}
        </Link>
        <button
          type="button"
          onClick={() => setShowDiscoverModal(true)}
          className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <Globe size={11} />
          {p.a2aDiscover}
        </button>
        <button
          type="button"
          onClick={openAdvancedConfig}
          className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <Settings size={11} />
          {p.advancedConfig}
        </button>
      </div>

      <DiscoverAgentModal
        open={showDiscoverModal}
        onClose={() => setShowDiscoverModal(false)}
        onDiscover={a2a.discover}
        discovering={a2a.discovering}
        error={a2a.error}
      />
    </div>
  );
}
