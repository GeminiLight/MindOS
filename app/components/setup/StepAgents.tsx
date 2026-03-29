'use client';

import { useState, useMemo } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Brain, ChevronDown,
} from 'lucide-react';
import { Field, Select } from '@/components/settings/Primitives';
import type { SetupMessages, McpMessages, Template, AgentEntry, AgentInstallStatus } from './types';

export interface StepAgentsProps {
  agents: AgentEntry[];
  agentsLoading: boolean;
  selectedAgents: Set<string>;
  setSelectedAgents: React.Dispatch<React.SetStateAction<Set<string>>>;
  agentTransport: 'auto' | 'stdio' | 'http';
  setAgentTransport: (v: 'auto' | 'stdio' | 'http') => void;
  agentScope: 'global' | 'project';
  setAgentScope: (v: 'global' | 'project') => void;
  agentStatuses: Record<string, AgentInstallStatus>;
  s: SetupMessages;
  settingsMcp: McpMessages;
  template: Template;
}

export default function StepAgents({
  agents, agentsLoading, selectedAgents, setSelectedAgents,
  agentTransport, setAgentTransport, agentScope, setAgentScope,
  agentStatuses, s, settingsMcp, template,
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
    return (
      <span className="text-xs px-1.5 py-0.5 rounded"
        style={{ background: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)', color: 'var(--muted-foreground)' }}>
        {s.agentNotFound}
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
      <span className="text-2xs px-1.5 py-0.5 rounded font-mono"
        style={{ background: 'color-mix(in srgb, var(--muted-foreground) 8%, transparent)', color: 'var(--muted-foreground)' }}>
        {getEffectiveTransport(agent)}
      </span>
      {getStatusBadge(agent.key, agent)}
    </label>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{s.agentToolsHint}</p>
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
          {/* Skill context + auto-install hint */}
          <div className="space-y-1.5">
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {s.skillWhat}
            </p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'color-mix(in srgb, var(--muted-foreground) 6%, transparent)', color: 'var(--muted-foreground)' }}>
              <Brain size={13} className="shrink-0" />
              <span>{s.skillAutoHint(template === 'zh' ? 'mindos-zh' : 'mindos')}</span>
            </div>
          </div>
          {/* Advanced options — collapsed by default */}
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
