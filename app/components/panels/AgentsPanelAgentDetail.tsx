'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, Loader2, CheckCircle2, AlertCircle, Copy, Check, Monitor, Globe } from 'lucide-react';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import type { AgentInfo, McpStatus } from '../settings/types';

export type AgentsPanelAgentDetailStatus = 'connected' | 'detected' | 'notFound';

export interface AgentsPanelAgentDetailCopy {
  connected: string;
  installing: string;
  install: (name: string) => string;
  copyConfig: string;
  copied: string;
  transportLocal: string;
  transportRemote: string;
  configPath: string;
  notFoundDetail: string;
  backToList: string;
  agentDetailTransport: string;
  agentDetailSnippet: string;
}

export default function AgentsPanelAgentDetail({
  agent,
  agentStatus,
  mcpStatus,
  onBack,
  onInstallAgent,
  copy,
}: {
  agent: AgentInfo;
  agentStatus: AgentsPanelAgentDetailStatus;
  mcpStatus: McpStatus | null;
  onBack: () => void;
  onInstallAgent: (key: string) => Promise<boolean>;
  copy: AgentsPanelAgentDetailCopy;
}) {
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [transport, setTransport] = useState<'stdio' | 'http'>(() => agent.preferredTransport);
  const [copied, setCopied] = useState(false);

  const snippet = useMemo(() => {
    if (agentStatus === 'notFound') return null;
    return generateSnippet(agent, mcpStatus, transport);
  }, [agent, mcpStatus, transport, agentStatus]);

  const handleInstall = async () => {
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

  const dot =
    agentStatus === 'connected' ? 'bg-emerald-500' : agentStatus === 'detected' ? 'bg-amber-500' : 'bg-zinc-400';

  return (
    <div className="flex flex-col min-h-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
        >
          <ChevronLeft size={16} />
          {copy.backToList}
        </button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
      </div>

      <div className="px-3 py-4 space-y-4 flex-1">
        {agentStatus === 'detected' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg font-medium text-[var(--amber-foreground)] disabled:opacity-50 bg-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {installing ? <Loader2 size={14} className="animate-spin" /> : null}
              {installing ? copy.installing : copy.install(agent.name)}
            </button>
            {result && (
              <span
                className={`flex items-center gap-1 text-2xs ${result.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
              >
                {result.type === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {result.text}
              </span>
            )}
          </div>
        )}

        {agentStatus === 'notFound' && (
          <p className="text-sm text-muted-foreground leading-relaxed">{copy.notFoundDetail}</p>
        )}

        {agentStatus !== 'notFound' && snippet && (
          <>
            <div>
              <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{copy.configPath}</p>
              <p className="text-xs font-mono text-foreground break-all">{snippet.path}</p>
            </div>

            <div>
              <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{copy.agentDetailTransport}</p>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 w-fit">
                <button
                  type="button"
                  onClick={() => setTransport('stdio')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    transport === 'stdio' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <Monitor size={13} />
                  {copy.transportLocal}
                </button>
                <button
                  type="button"
                  onClick={() => setTransport('http')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    transport === 'http' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <Globe size={13} />
                  {copy.transportRemote}
                </button>
              </div>
            </div>

            <div>
              <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{copy.agentDetailSnippet}</p>
              <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre max-h-[min(320px,50vh)] overflow-y-auto select-all">
                {snippet.displaySnippet}
              </pre>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? copy.copied : copy.copyConfig}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
