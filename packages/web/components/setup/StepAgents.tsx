'use client';

import { useState, useMemo } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Brain, ChevronDown, Terminal, Plug,
} from 'lucide-react';
import { Field, Select } from '@/components/settings/Primitives';
import type { SetupMessages, McpMessages, AgentEntry, AgentInstallStatus, ConnectionMode } from './types';

const AGENT_INSTALL_URLS: Record<string, string> = {
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code/overview',
  'cursor': 'https://www.cursor.com/',
  'windsurf': 'https://codeium.com/windsurf',
  'cline': 'https://github.com/cline/cline',
  'trae': 'https://www.trae.ai/',
  'gemini-cli': 'https://github.com/google-gemini/gemini-cli',
  'augment': 'https://www.augmentcode.com/',
};

export interface StepAgentsProps {
  agents: AgentEntry[];
  agentsLoading: boolean;
  selectedAgents: Set<string>;
  setSelectedAgents: React.Dispatch<React.SetStateAction<Set<string>>>;
  connectionMode: ConnectionMode;
  setConnectionMode: React.Dispatch<React.SetStateAction<ConnectionMode>>;
  agentTransport: 'auto' | 'stdio' | 'http';
  setAgentTransport: (v: 'auto' | 'stdio' | 'http') => void;
  agentScope: 'global' | 'project';
  setAgentScope: (v: 'global' | 'project') => void;
  agentStatuses: Record<string, AgentInstallStatus>;
  s: SetupMessages;
  settingsMcp: McpMessages;
}

export default function StepAgents({
  agents, agentsLoading, selectedAgents, setSelectedAgents,
  connectionMode, setConnectionMode,
  agentTransport, setAgentTransport, agentScope, setAgentScope,
  agentStatuses, s, settingsMcp,
}: StepAgentsProps) {
  const toggleAgent = (key: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const [showOtherAgents, setShowOtherAgents] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const getEffectiveTransport = (agent: AgentEntry) => {
    if (agentTransport === 'auto') return agent.preferredTransport;
    return agentTransport;
  };

  const getStatusBadge = (key: string, agent: AgentEntry) => {
    const st = agentStatuses[key];
    if (st) {
      if (st.state === 'installing') return (
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <Loader2 size={10} className="animate-spin" /> {s.agentInstalling}
        </span>
      );
      if (st.state === 'ok') return (
        <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
          style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>
          <CheckCircle2 size={10} /> {s.agentStatusOk}
        </span>
      );
      if (st.state === 'error') return (
        <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
          style={{ background: 'color-mix(in srgb, var(--error) 10%, transparent)', color: 'var(--error)' }}>
          <XCircle size={10} /> {s.agentStatusError}
          {st.message && <span className="ml-1 text-2xs">({st.message})</span>}
        </span>
      );
    }
    if (agent.installed) return (
      <span className="text-xs px-1.5 py-0.5 rounded"
        style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>
        {settingsMcp.installed}
      </span>
    );
    if (agent.present) return (
      <span className="text-xs px-1.5 py-0.5 rounded"
        style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>
        {s.agentDetected}
      </span>
    );
    const installUrl = AGENT_INSTALL_URLS[key];
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)', color: 'var(--muted-foreground)' }}>
          {s.agentNotFound}
        </span>
        {installUrl && (
          <a href={installUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-2xs hover:underline"
            style={{ color: 'var(--amber)' }}>
            {s.agentGetIt}
          </a>
        )}
      </span>
    );
  };

  const { detected, other } = useMemo(() => ({
    detected: agents.filter(a => a.installed || a.present),
    other: agents.filter(a => !a.installed && !a.present),
  }), [agents]);

  const renderAgentRow = (agent: AgentEntry, i: number) => (
    <label key={agent.key}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
      style={{
        background: i % 2 === 0 ? 'var(--card)' : 'transparent',
        borderTop: i > 0 ? '1px solid var(--border)' : undefined,
      }}>
      <input
        type="checkbox"
        checked={selectedAgents.has(agent.key)}
        onChange={() => toggleAgent(agent.key)}
        className="form-check"
        disabled={agentStatuses[agent.key]?.state === 'installing'}
      />
      <span className="text-sm flex-1" style={{ color: 'var(--foreground)' }}>{agent.name}</span>
      {connectionMode.mcp && (
        <span className="text-2xs px-1.5 py-0.5 rounded font-mono"
          style={{ background: 'color-mix(in srgb, var(--muted-foreground) 8%, transparent)', color: 'var(--muted-foreground)' }}>
          {getEffectiveTransport(agent)}
        </span>
      )}
      {getStatusBadge(agent.key, agent)}
    </label>
  );

  return (
    <div className="space-y-5">
      {/* Connection Mode Toggle */}
      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
          {s.connectionModeTitle}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label
            className="flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all"
            style={{
              borderColor: connectionMode.cli ? 'var(--amber)' : 'var(--border)',
              background: connectionMode.cli ? 'color-mix(in srgb, var(--amber) 6%, transparent)' : 'transparent',
            }}>
            <input
              type="checkbox"
              checked={connectionMode.cli}
              onChange={() => setConnectionMode(prev => ({ ...prev, cli: !prev.cli }))}
              className="form-check mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                <Terminal size={13} className="shrink-0" /> CLI
              </div>
              <p className="text-2xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                {s.connectionModeCliHint}
              </p>
            </div>
          </label>
          <label
            className="flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all"
            style={{
              borderColor: connectionMode.mcp ? 'var(--amber)' : 'var(--border)',
              background: connectionMode.mcp ? 'color-mix(in srgb, var(--amber) 6%, transparent)' : 'transparent',
            }}>
            <input
              type="checkbox"
              checked={connectionMode.mcp}
              onChange={() => setConnectionMode(prev => ({ ...prev, mcp: !prev.mcp }))}
              className="form-check mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                <Plug size={13} className="shrink-0" /> MCP
              </div>
              <p className="text-2xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                {s.connectionModeMcpHint}
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Hint — contextual based on connection mode */}
      {!connectionMode.cli && !connectionMode.mcp ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs"
          style={{ background: 'color-mix(in srgb, var(--amber) 8%, transparent)', color: 'var(--amber)' }}>
          <Brain size={13} className="shrink-0" />
          <span>{s.agentToolsHintNone}</span>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {!connectionMode.mcp && connectionMode.cli ? s.agentToolsHintCliOnly : s.agentToolsHint}
        </p>
      )}

      {agentsLoading ? (
        <div className="flex items-center gap-2 py-4" style={{ color: 'var(--muted-foreground)' }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">{s.agentToolsLoading}</span>
        </div>
      ) : agents.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--muted-foreground)' }}>
          {s.agentToolsEmpty}
        </p>
      ) : (
        <>
          {/* Badge legend */}
          <div className="flex items-center gap-4 text-2xs" style={{ color: 'var(--muted-foreground)' }}>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
              {s.badgeInstalled}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--amber)' }} />
              {s.badgeDetected}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--muted-foreground)' }} />
              {s.badgeNotFound}
            </span>
          </div>

          {/* Detected agents — always visible */}
          {detected.length > 0 ? (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {detected.map((agent, i) => renderAgentRow(agent, i))}
            </div>
          ) : (
            <p className="text-xs py-2" style={{ color: 'var(--muted-foreground)' }}>
              {s.agentNoneDetected}
            </p>
          )}
          {/* Other agents — collapsed by default */}
          {other.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowOtherAgents(!showOtherAgents)}
                aria-expanded={showOtherAgents}
                className="flex items-center gap-1.5 text-xs py-1.5 transition-colors"
                style={{ color: 'var(--muted-foreground)' }}>
                <ChevronDown size={12} className={`transition-transform ${showOtherAgents ? 'rotate-180' : ''}`} />
                {s.agentShowMore(other.length)}
              </button>
              {showOtherAgents && (
                <div className="rounded-xl border overflow-hidden mt-1" style={{ borderColor: 'var(--border)' }}>
                  {other.map((agent, i) => renderAgentRow(agent, i))}
                </div>
              )}
            </div>
          )}
          {/* Hint when no agents selected — only relevant for MCP mode */}
          {connectionMode.mcp && selectedAgents.size === 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs"
              style={{ background: 'color-mix(in srgb, var(--amber) 8%, transparent)', color: 'var(--amber)' }}>
              <Brain size={13} className="shrink-0" />
              <span>{s.agentNoneSelected}</span>
            </div>
          )}
          {/* Advanced options — only when MCP is enabled */}
          {connectionMode.mcp && (
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                aria-expanded={showAdvanced}
                className="flex items-center gap-1.5 text-xs py-1.5 transition-colors"
                style={{ color: 'var(--muted-foreground)' }}>
                <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                {s.agentAdvanced}
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <Field label={s.agentTransport}>
                    <Select value={agentTransport} onChange={e => setAgentTransport(e.target.value as 'auto' | 'stdio' | 'http')}>
                      <option value="auto">{s.agentTransportAuto}</option>
                      <option value="stdio">{settingsMcp.transportStdio}</option>
                      <option value="http">{settingsMcp.transportHttp}</option>
                    </Select>
                  </Field>
                  <Field label={s.agentScope}>
                    <Select value={agentScope} onChange={e => setAgentScope(e.target.value as 'global' | 'project')}>
                      <option value="global">{s.agentScopeGlobal}</option>
                      <option value="project">{s.agentScopeProject}</option>
                    </Select>
                  </Field>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setSelectedAgents(new Set(
                agents.filter(a => a.installed || a.present).map(a => a.key)
              ))}
              className="text-xs px-2.5 py-1 rounded-md border transition-colors hover:bg-muted/50"
              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
              {s.agentSelectDetected}
            </button>
            <button
              type="button"
              onClick={() => setSelectedAgents(new Set())}
              className="text-xs px-2.5 py-1 rounded-md border transition-colors hover:bg-muted/50"
              style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
              {s.agentSkipLater}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
