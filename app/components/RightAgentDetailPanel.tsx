'use client';

import { useMemo, useEffect } from 'react';
import { useMcpData } from '@/hooks/useMcpData';
import { useLocale } from '@/lib/LocaleContext';
import { useResizeDrag } from '@/hooks/useResizeDrag';
import AgentsPanelAgentDetail from '@/components/panels/AgentsPanelAgentDetail';
import { resolveAgentDetailStatus } from '@/components/panels/agents-panel-resolve-status';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH_ABS = 640;
const MAX_WIDTH_RATIO = 0.42;

interface RightAgentDetailPanelProps {
  open: boolean;
  agentKey: string | null;
  onClose: () => void;
  /** Right offset in px when Ask panel is open (stack panels side-by-side). */
  rightOffset: number;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit: (w: number) => void;
}

export default function RightAgentDetailPanel({
  open,
  agentKey,
  onClose,
  rightOffset,
  width,
  onWidthChange,
  onWidthCommit,
}: RightAgentDetailPanelProps) {
  const mcp = useMcpData();
  const { t } = useLocale();
  const p = t.panels.agents;

  const connected = mcp.agents.filter(a => a.present && a.installed);
  const detected = mcp.agents.filter(a => a.present && !a.installed);
  const notFound = mcp.agents.filter(a => !a.present);

  const resolved = useMemo(() => {
    if (!agentKey) return null;
    const agent = mcp.agents.find(a => a.key === agentKey);
    if (!agent) return null;
    const status = resolveAgentDetailStatus(agentKey, connected, detected, notFound);
    if (!status) return null;
    return { agent, status };
  }, [agentKey, mcp.agents, connected, detected, notFound]);

  useEffect(() => {
    if (agentKey && !resolved) {
      const id = requestAnimationFrame(() => onClose());
      return () => cancelAnimationFrame(id);
    }
  }, [agentKey, resolved, onClose]);

  const handleMouseDown = useResizeDrag({
    width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH_ABS,
    maxWidthRatio: MAX_WIDTH_RATIO,
    direction: 'left',
    onResize: onWidthChange,
    onResizeEnd: onWidthCommit,
  });

  const detailCopy = {
    connected: p.connected,
    installing: p.installing,
    install: p.install,
    installFailed: p.installFailed,
    copyConfig: p.copyConfig,
    copied: p.copied,
    transportLocal: p.transportLocal,
    transportRemote: p.transportRemote,
    configPath: p.configPath,
    notFoundDetail: p.notFoundDetail,
    backToList: p.backToList,
    closeDetail: p.closeAgentDetail,
    agentDetailTransport: p.agentDetailTransport,
    agentDetailSnippet: p.agentDetailSnippet,
  };

  return (
    <aside
      className={`
        hidden md:flex fixed top-0 h-screen z-[31] flex-col bg-card border-l border-border shadow-sm
        transition-transform duration-200 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}
      style={{ width: `${width}px`, right: `${rightOffset}px` }}
      role="complementary"
      aria-label={p.agentDetailPanelAria}
      aria-hidden={!open || !resolved}
    >
      {resolved && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <AgentsPanelAgentDetail
            agent={resolved.agent}
            agentStatus={resolved.status}
            mcpStatus={mcp.status}
            onBack={onClose}
            onInstallAgent={mcp.installAgent}
            copy={detailCopy}
            headerVariant="dock"
          />
        </div>
      )}

      <div
        className="absolute top-0 -left-[3px] w-[6px] h-full cursor-col-resize z-40 group hidden md:block"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute left-[2px] top-0 w-[2px] h-full opacity-0 group-hover:opacity-100 bg-[var(--amber)]/50 transition-opacity" />
      </div>
    </aside>
  );
}

export { DEFAULT_WIDTH as RIGHT_AGENT_DETAIL_DEFAULT_WIDTH, MIN_WIDTH as RIGHT_AGENT_DETAIL_MIN_WIDTH, MAX_WIDTH_ABS as RIGHT_AGENT_DETAIL_MAX_WIDTH };
