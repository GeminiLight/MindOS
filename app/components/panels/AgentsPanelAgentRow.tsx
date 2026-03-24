'use client';

import { useState, useMemo } from 'react';
import { Loader2, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Copy, Check, Monitor, Globe } from 'lucide-react';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import type { AgentInfo, McpStatus } from '../settings/types';

export type AgentsPanelAgentStatus = 'connected' | 'detected' | 'notFound';

export interface AgentsPanelAgentRowCopy {
  connected: string;
  installing: string;
  install: (name: string) => string;
  copyConfig: string;
  copied: string;
  transportLocal: string;
  transportRemote: string;
  configPath: string;
  notFoundDetail: string;
}

export default function AgentsPanelAgentRow({
  agent,
  agentStatus,
  expanded,
  onToggleExpand,
  onInstallAgent,
  mcpStatus,
  copy,
}: {
  agent: AgentInfo;
  agentStatus: AgentsPanelAgentStatus;
  expanded: boolean;
  onToggleExpand: () => void;
  onInstallAgent: (key: string) => Promise<boolean>;
  mcpStatus: McpStatus | null;
  copy: AgentsPanelAgentRowCopy;
}) {
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [transport, setTransport] = useState<'stdio' | 'http'>(() => agent.preferredTransport);
  const [copied, setCopied] = useState(false);

  const dot =
    agentStatus === 'connected' ? 'bg-emerald-500' : agentStatus === 'detected' ? 'bg-amber-500' : 'bg-zinc-400';

  const snippet = useMemo(() => {
    if (agentStatus === 'notFound') return null;
    return generateSnippet(agent, mcpStatus, transport);
  }, [agent, mcpStatus, transport, agentStatus]);

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setInstalling(true);
    setResult(null);
    const ok = await onInstallAgent(agent.key);
    setResult(
      ok
        ? { type: 'success', text: `${agent.name} ${copy.connected}` }
        : { type: 'error', text: 'Install failed' },
    );
    setInstalling(false);
  };

  const handleCopy = async () => {
    if (!snippet) return;
    const ok = await copyToClipboard(snippet.snippet);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="flex flex-1 min-w-0 items-center gap-2 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="text-xs font-medium text-foreground truncate">{agent.name}</span>
          {agentStatus === 'connected' && agent.transport && (
            <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{agent.transport}</span>
          )}
        </button>

        {agentStatus === 'detected' && (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded-md font-medium text-[var(--amber-foreground)] disabled:opacity-50 transition-colors shrink-0 bg-[var(--amber)]"
          >
            {installing ? <Loader2 size={10} className="animate-spin" /> : null}
            {installing ? copy.installing : copy.install(agent.name)}
          </button>
        )}

        {result && (
          <span
            className={`flex items-center gap-1 text-2xs shrink-0 max-w-[120px] ${result.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
          >
            {result.type === 'success' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
            <span className="truncate">{result.text}</span>
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/40 space-y-2">
          {agentStatus === 'notFound' && <p className="text-2xs text-muted-foreground leading-relaxed pt-2">{copy.notFoundDetail}</p>}

          {agentStatus !== 'notFound' && snippet && (
            <>
              <p className="text-2xs text-muted-foreground pt-2">
                <span className="font-medium text-foreground/80">{copy.configPath}</span>{' '}
                <span className="font-mono break-all">{snippet.path}</span>
              </p>

              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 w-fit">
                <button
                  type="button"
                  onClick={() => setTransport('stdio')}
                  className={`flex items-center gap-1 px-2 py-1 text-2xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    transport === 'stdio' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <Monitor size={11} />
                  {copy.transportLocal}
                </button>
                <button
                  type="button"
                  onClick={() => setTransport('http')}
                  className={`flex items-center gap-1 px-2 py-1 text-2xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    transport === 'http' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <Globe size={11} />
                  {copy.transportRemote}
                </button>
              </div>

              <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-lg p-2 overflow-x-auto whitespace-pre max-h-[160px] overflow-y-auto select-all">
                {snippet.displaySnippet}
              </pre>

              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? copy.copied : copy.copyConfig}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
