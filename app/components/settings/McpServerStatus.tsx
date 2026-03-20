'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plug, Copy, Check, ChevronDown } from 'lucide-react';
import type { McpStatus, AgentInfo, McpServerStatusProps } from './types';

/* ── Helpers ───────────────────────────────────────────────────── */

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? (copiedLabel ?? 'Copied!') : label}
    </button>
  );
}

/* ── Config Snippet Generator ─────────────────────────────────── */

function generateConfigSnippet(
  agent: AgentInfo,
  status: McpStatus,
  token?: string,
): { snippet: string; path: string } {
  const isRunning = status.running;

  // Determine entry (stdio vs http)
  const stdioEntry: Record<string, unknown> = { type: 'stdio', command: 'mindos', args: ['mcp'] };
  const httpEntry: Record<string, unknown> = { url: status.endpoint };
  if (token) httpEntry.headers = { Authorization: `Bearer ${token}` };
  const entry = isRunning ? httpEntry : stdioEntry;

  // TOML format (Codex)
  if (agent.format === 'toml') {
    const lines: string[] = [`[${agent.configKey}.mindos]`];
    if (isRunning) {
      lines.push(`type = "http"`);
      lines.push(`url = "${status.endpoint}"`);
      if (token) {
        lines.push('');
        lines.push(`[${agent.configKey}.mindos.headers]`);
        lines.push(`Authorization = "Bearer ${token}"`);
      }
    } else {
      lines.push(`command = "mindos"`);
      lines.push(`args = ["mcp"]`);
      lines.push('');
      lines.push(`[${agent.configKey}.mindos.env]`);
      lines.push(`MCP_TRANSPORT = "stdio"`);
    }
    return { snippet: lines.join('\n'), path: agent.globalPath };
  }

  // JSON with globalNestedKey (VS Code project-level uses flat key)
  if (agent.globalNestedKey) {
    // project-level: flat key structure
    const projectSnippet = JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
    return { snippet: projectSnippet, path: agent.projectPath ?? agent.globalPath };
  }

  // Standard JSON
  const snippet = JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
  return { snippet, path: agent.globalPath };
}

/* ── MCP Server Status ─────────────────────────────────────────── */

export default function ServerStatus({ status, agents, t }: McpServerStatusProps) {
  const m = t.settings?.mcp;
  const [expanded, setExpanded] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('');

  // Auto-select first installed or first detected agent
  useEffect(() => {
    if (agents.length > 0 && !selectedAgent) {
      const first = agents.find(a => a.installed) ?? agents.find(a => a.present) ?? agents[0];
      if (first) setSelectedAgent(first.key);
    }
  }, [agents, selectedAgent]);

  if (!status) return null;

  const currentAgent = agents.find(a => a.key === selectedAgent);
  // 🟡 MINOR #9: Memoize snippet generation to avoid recomputing on every render
  const snippetResult = useMemo(() => currentAgent ? generateConfigSnippet(currentAgent, status) : null, [currentAgent, status]);

  return (
    <div>
      {/* Summary line — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 text-xs"
      >
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
        <ChevronDown size={12} className={`ml-auto text-muted-foreground transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="pt-3 mt-3 border-t border-border space-y-3">
          {/* Endpoint + copy */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground shrink-0">{m?.endpoint ?? 'Endpoint'}</span>
            <span className="font-mono text-foreground truncate">{status.endpoint}</span>
            <CopyButton text={status.endpoint} label={m?.copyEndpoint ?? 'Copy'} copiedLabel={m?.copied} />
          </div>

          {/* Quick Setup */}
          {agents.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs">
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
              </div>

              {snippetResult && (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0">{m?.configPath ?? 'Config path'}</span>
                    <span className="font-mono text-foreground text-2xs">{snippetResult.path}</span>
                  </div>
                  <pre className="text-xs font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre">
                    {snippetResult.snippet}
                  </pre>
                  <CopyButton text={snippetResult.snippet} label={m?.copyConfig ?? 'Copy Config'} copiedLabel={m?.copied} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
