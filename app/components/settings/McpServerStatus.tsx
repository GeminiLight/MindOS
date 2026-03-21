'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plug, Copy, Check, ChevronDown, Monitor, Globe, Code } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import type { McpStatus, AgentInfo, McpServerStatusProps } from './types';

/* ── Helpers ───────────────────────────────────────────────────── */

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0 relative z-10"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? (copiedLabel ?? 'Copied!') : label}
    </button>
  );
}

/* ── Config Snippet Generator ─────────────────────────────────── */

interface ConfigSnippet {
  /** Snippet with full token — for clipboard copy */
  snippet: string;
  /** Snippet with masked token — for display in UI */
  displaySnippet: string;
  path: string;
}

function generateStdioSnippet(agent: AgentInfo): ConfigSnippet {
  const stdioEntry: Record<string, unknown> = { type: 'stdio', command: 'mindos', args: ['mcp'] };

  if (agent.format === 'toml') {
    const lines = [
      `[${agent.configKey}.mindos]`,
      `command = "mindos"`,
      `args = ["mcp"]`,
      '',
      `[${agent.configKey}.mindos.env]`,
      `MCP_TRANSPORT = "stdio"`,
    ];
    const s = lines.join('\n');
    return { snippet: s, displaySnippet: s, path: agent.globalPath };
  }

  if (agent.globalNestedKey) {
    const s = JSON.stringify({ [agent.configKey]: { mindos: stdioEntry } }, null, 2);
    return { snippet: s, displaySnippet: s, path: agent.projectPath ?? agent.globalPath };
  }

  const s = JSON.stringify({ [agent.configKey]: { mindos: stdioEntry } }, null, 2);
  return { snippet: s, displaySnippet: s, path: agent.globalPath };
}

function generateHttpSnippet(
  agent: AgentInfo,
  endpoint: string,
  token?: string,
  maskedToken?: string,
): ConfigSnippet {
  // Full token for copy
  const httpEntry: Record<string, unknown> = { url: endpoint };
  if (token) httpEntry.headers = { Authorization: `Bearer ${token}` };

  // Masked token for display
  const displayEntry: Record<string, unknown> = { url: endpoint };
  if (maskedToken) displayEntry.headers = { Authorization: `Bearer ${maskedToken}` };

  const buildSnippet = (entry: Record<string, unknown>) => {
    if (agent.format === 'toml') {
      const lines = [
        `[${agent.configKey}.mindos]`,
        `type = "http"`,
        `url = "${endpoint}"`,
      ];
      const authVal = (entry.headers as Record<string, string>)?.Authorization;
      if (authVal) {
        lines.push('');
        lines.push(`[${agent.configKey}.mindos.headers]`);
        lines.push(`Authorization = "${authVal}"`);
      }
      return lines.join('\n');
    }

    if (agent.globalNestedKey) {
      return JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
    }

    return JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
  };

  return {
    snippet: buildSnippet(httpEntry),
    displaySnippet: buildSnippet(token ? displayEntry : httpEntry),
    path: agent.format === 'toml' ? agent.globalPath : (agent.globalNestedKey ? (agent.projectPath ?? agent.globalPath) : agent.globalPath),
  };
}

/* ── MCP Server Status ─────────────────────────────────────────── */

export default function ServerStatus({ status, agents, t }: McpServerStatusProps) {
  const m = t.settings?.mcp;
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [mode, setMode] = useState<'stdio' | 'http'>('stdio');
  const [showSnippet, setShowSnippet] = useState(false);

  useEffect(() => {
    if (agents.length > 0 && !selectedAgent) {
      const first = agents.find(a => a.installed) ?? agents.find(a => a.present) ?? agents[0];
      if (first) setSelectedAgent(first.key);
    }
  }, [agents, selectedAgent]);

  useEffect(() => {
    if (status?.endpoint && !status.endpoint.includes('127.0.0.1') && !status.endpoint.includes('localhost')) {
      setMode('http');
    }
  }, [status?.endpoint]);

  if (!status) return null;

  const currentAgent = agents.find(a => a.key === selectedAgent);

  const snippetResult = useMemo(() => {
    if (!currentAgent) return null;
    if (mode === 'stdio') return generateStdioSnippet(currentAgent);
    return generateHttpSnippet(currentAgent, status.endpoint, status.authToken, status.maskedToken);
  }, [currentAgent, status, mode]);

  const isRemote = status.endpoint && !status.endpoint.includes('127.0.0.1') && !status.endpoint.includes('localhost');

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-3">{m?.serverTitle ?? 'MCP Server'}</h3>

      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
        {/* Status line */}
        <div className="flex items-center gap-2.5 text-xs">
          <Plug size={14} className="text-muted-foreground shrink-0" />
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${status.running ? 'bg-success' : 'bg-muted-foreground'}`} />
          <span className="text-foreground font-medium">
            {status.running ? (m?.running ?? 'Running') : (m?.stopped ?? 'Stopped')}
          </span>
          {status.running && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-muted-foreground">{status.transport.toUpperCase()}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{m?.toolsRegistered ? m.toolsRegistered(status.toolCount) : `${status.toolCount} tools`}</span>
              <span className="text-muted-foreground">·</span>
              <span className={status.authConfigured ? 'text-success' : 'text-muted-foreground'}>
                {status.authConfigured ? (m?.authSet ?? 'Token set') : (m?.authNotSet ?? 'No token')}
              </span>
            </>
          )}
        </div>

        {/* Endpoint + copy */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">{m?.endpoint ?? 'Endpoint'}</span>
          <span className="font-mono text-foreground truncate">{status.endpoint}</span>
          <CopyButton text={status.endpoint} label={m?.copyEndpoint ?? 'Copy'} copiedLabel={m?.copied} />
        </div>

        {/* Quick Setup */}
        {agents.length > 0 && (
          <div className="pt-2 border-t border-border space-y-2.5">
            {/* Agent selector + transport mode toggle */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="text-muted-foreground shrink-0">{m?.configureFor ?? 'Configure for'}</span>
              <select
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {agents.map(a => (
                  <option key={a.key} value={a.key}>
                    {a.name}{a.installed ? ' ✓' : a.present ? ' ·' : ''}
                  </option>
                ))}
              </select>

              <div className="flex items-center rounded-md border border-border overflow-hidden ml-auto">
                <button
                  type="button"
                  onClick={() => setMode('stdio')}
                  className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                    mode === 'stdio'
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={m?.transportLocalHint ?? 'Local — same machine as MindOS server'}
                >
                  <Monitor size={11} />
                  {m?.transportLocal ?? 'Local'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('http')}
                  className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                    mode === 'http'
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={m?.transportRemoteHint ?? 'Remote — connect from another device via HTTP'}
                >
                  <Globe size={11} />
                  {m?.transportRemote ?? 'Remote'}
                </button>
              </div>
            </div>

            {/* Hint for remote mode */}
            {mode === 'http' && (
              <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1">
                <p>
                  {isRemote
                    ? (m?.remoteDetectedHint ?? 'Using your current remote IP.')
                    : (m?.remoteManualHint ?? 'Replace 127.0.0.1 with your server\'s public or LAN IP.')}
                </p>
                <p>
                  {(m?.remoteSteps ?? 'To connect from another device: ① Open port {port} in firewall/security group ② Use the config below in your Agent ③ For public networks, consider SSH tunnel for encryption.')
                    .replace('{port}', String(status.port))}
                </p>
                {!status.authConfigured && (
                  <p className="text-amber-500">{m?.noAuthWarning ?? '⚠ No auth token — set one in Settings → General before enabling remote access.'}</p>
                )}
              </div>
            )}

            {/* Copy config + show JSON toggle */}
            {snippetResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  {/* Copy button uses full token (snippetResult.snippet) */}
                  <CopyButton text={snippetResult.snippet} label={m?.copyConfig ?? 'Copy Config'} copiedLabel={m?.copied} />
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-muted-foreground text-[11px] truncate">{snippetResult.path}</span>
                  <button
                    type="button"
                    onClick={() => setShowSnippet(!showSnippet)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
                  >
                    <Code size={10} />
                    {showSnippet ? (m?.hideJson ?? 'Hide JSON') : (m?.showJson ?? 'Show JSON')}
                    <ChevronDown size={10} className={`transition-transform ${showSnippet ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/* Display snippet uses masked token */}
                {showSnippet && (
                  <pre className="text-xs font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre select-all">
                    {snippetResult.displaySnippet}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
