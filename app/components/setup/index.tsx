'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import type { SetupState, PortStatus, AgentEntry, AgentInstallStatus, ProviderSetupConfig, ConnectionMode } from './types';
import { type ProviderId, isProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';
import { TOTAL_STEPS, STEP_KB, STEP_AI, STEP_AGENTS, STEP_REVIEW } from './constants';
import StepKB from './StepKB';
import StepAI from './StepAI';
import StepAgents from './StepAgents';
import StepReview from './StepReview';
import { RestartButton } from './StepReview';
import StepDots from './StepDots';

// ─── Helpers (shared by handleComplete + retryAgent) ─────────────────────────

/** Build a single agent's install payload */
function buildAgentPayload(
  key: string,
  agents: AgentEntry[],
  transport: 'auto' | 'stdio' | 'http',
  scope: 'global' | 'project',
): { key: string; scope: string; transport: string } {
  const agent = agents.find(a => a.key === key);
  const effectiveTransport = transport === 'auto'
    ? (agent?.preferredTransport || 'stdio')
    : transport;
  return { key, scope, transport: effectiveTransport };
}

/** Parse a single install API result into AgentInstallStatus */
function parseInstallResult(
  r: { agent: string; status: string; message?: string; transport?: string; verified?: boolean; verifyError?: string },
): AgentInstallStatus {
  return {
    state: r.status === 'ok' ? 'ok' : 'error',
    message: r.message,
    transport: r.transport,
    verified: r.verified,
    verifyError: r.verifyError,
  };
}

// ─── Phase runners (pure async, no setState — results consumed by caller) ────

/** Phase 1: Save setup config. Returns whether restart is needed. Throws on failure. */
async function saveConfig(state: SetupState): Promise<boolean> {
  // Build providers dict from dynamic providerConfigs
  const providers: Record<string, { apiKey: string; model: string; baseUrl?: string }> = {};
  if (state.provider !== 'skip') {
    for (const [id, cfg] of Object.entries(state.providerConfigs)) {
      if (!cfg) continue;
      providers[id] = {
        apiKey: cfg.apiKey,
        model: cfg.model,
        ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      };
    }
  }

  const payload = {
    mindRoot: state.mindRoot,
    template: state.template || undefined,
    port: state.webPort,
    mcpPort: state.mcpPort,
    authToken: state.authToken,
    webPassword: state.webPassword,
    ai: state.provider === 'skip' ? undefined : {
      provider: state.provider,
      providers,
    },
  };
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return !!data.needsRestart;
}

/** Phase 2: Install selected agents. Returns status map. */
async function installAgents(
  keys: string[],
  agents: AgentEntry[],
  transport: 'auto' | 'stdio' | 'http',
  scope: 'global' | 'project',
  mcpPort: number,
  authToken: string,
): Promise<Record<string, AgentInstallStatus>> {
  const agentsPayload = keys.map(k => buildAgentPayload(k, agents, transport, scope));
  const res = await fetch('/api/mcp/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agents: agentsPayload,
      transport,
      url: `http://localhost:${mcpPort}/mcp`,
      token: authToken || undefined,
    }),
  });
  const data = await res.json();
  const updated: Record<string, AgentInstallStatus> = {};
  if (data.results) {
    for (const r of data.results as Array<{ agent: string; status: string; message?: string; transport?: string; verified?: boolean; verifyError?: string }>) {
      updated[r.agent] = parseInstallResult(r);
    }
  }
  return updated;
}

/** Phase 2.5: Install skills to selected agents. Returns success status. */
async function installSkills(
  skillName: string,
  agentKeys: string[],
): Promise<boolean> {
  if (agentKeys.length === 0) return true;
  
  try {
    const res = await fetch('/api/mcp/install-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: skillName,
        agents: agentKeys,
      }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (e) {
    console.warn('[SetupWizard] Skill installation failed:', e);
    return false;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SetupWizard() {
  const { t } = useLocale();
  const s = t.setup;

  const [step, setStep] = useState(0);
  const [state, setState] = useState<SetupState>({
    mindRoot: '~/MindOS/mind',
    template: 'en',
    provider: 'anthropic',
    providerConfigs: {
      anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
      openai: { apiKey: '', model: 'gpt-5.4', baseUrl: '' },
    },
    webPort: 3456,
    mcpPort: 8781,
    authToken: '',
    webPassword: '',
  });
  const [homeDir, setHomeDir] = useState('~');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);
  const [skillInstallStatus, setSkillInstallStatus] = useState<'pending' | 'installing' | 'ok' | 'error' | 'skipped'>('pending');

  const [webPortStatus, setWebPortStatus] = useState<PortStatus>({ checking: false, available: null, isSelf: false, suggestion: null });
  const [mcpPortStatus, setMcpPortStatus] = useState<PortStatus>({ checking: false, available: null, isSelf: false, suggestion: null });

  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [agentTransport, setAgentTransport] = useState<'auto' | 'stdio' | 'http'>('auto');
  const [agentScope, setAgentScope] = useState<'global' | 'project'>('global');
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentInstallStatus>>({});
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>({ cli: true, mcp: false });
  const [setupPhase, setSetupPhase] = useState<'review' | 'saving' | 'agents' | 'skills' | 'done'>('review');

  // Load existing config as defaults on mount, generate token if none exists
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        if (data.homeDir) setHomeDir(data.homeDir);

        setState(prev => {
          const provConfigs: Partial<Record<ProviderId, ProviderSetupConfig>> = { ...prev.providerConfigs };

          // Load dynamic providers format from server
          if (data.providerConfigs && typeof data.providerConfigs === 'object') {
            for (const [id, cfg] of Object.entries(data.providerConfigs as Record<string, any>)) {
              if (isProviderId(id) && cfg) {
                provConfigs[id] = {
                  apiKey: provConfigs[id]?.apiKey ?? '',
                  model: cfg.model || PROVIDER_PRESETS[id].defaultModel,
                  baseUrl: cfg.baseUrl ?? '',
                  apiKeyMask: cfg.apiKeyMask || '',
                };
              }
            }
          }

          const resolvedProvider = data.provider && isProviderId(data.provider) ? data.provider : prev.provider;

          return {
            ...prev,
            mindRoot: data.mindRoot || prev.mindRoot,
            webPort: typeof data.port === 'number' ? data.port : prev.webPort,
            mcpPort: typeof data.mcpPort === 'number' ? data.mcpPort : prev.mcpPort,
            authToken: data.authToken || prev.authToken,
            webPassword: data.webPassword || prev.webPassword,
            provider: resolvedProvider,
            providerConfigs: provConfigs,
          };
        });
        // Generate a new token only if none exists yet
        if (!data.authToken) {
          fetch('/api/setup/generate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
            .then(r => r.json())
            .then(tokenData => { if (tokenData.token) setState(p => ({ ...p, authToken: tokenData.token })); })
            .catch(e => console.warn('[SetupWizard] Token generation failed:', e));
        }
      })
      .catch(e => {
        console.warn('[SetupWizard] Failed to load config, generating token as fallback:', e);
        // Fallback: generate token on failure
        fetch('/api/setup/generate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(r => r.json())
          .then(data => { if (data.token) setState(prev => ({ ...prev, authToken: data.token })); })
          .catch(e2 => console.warn('[SetupWizard] Fallback token generation also failed:', e2));
      });
  }, []);

  // Auto-check ports when entering AI step — auto-resolve occupied ports
  useEffect(() => {
    if (step === STEP_AI) {
      checkPort(state.webPort, 'web', true);
      checkPort(state.mcpPort, 'mcp', true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Load agents when entering Agents step (exclude builtin — MindOS itself)
  useEffect(() => {
    if (step === STEP_AGENTS && !agentsLoaded && !agentsLoading) {
      setAgentsLoading(true);
      fetch('/api/mcp/agents')
        .then(r => r.json())
        .then(data => {
          if (data.agents) {
            const externalAgents = (data.agents as AgentEntry[]).filter(a => a.scope !== 'builtin');
            setAgents(externalAgents);
            setSelectedAgents(new Set(
              externalAgents.filter(a => a.installed || a.present).map(a => a.key)
            ));
          }
          setAgentsLoaded(true);
        })
        .catch(e => { console.warn('[SetupWizard] Failed to load agents:', e); setAgentsLoaded(true); })
        .finally(() => setAgentsLoading(false));
    }
  }, [step, agentsLoaded, agentsLoading]);

  const update = useCallback(<K extends keyof SetupState>(key: K, val: SetupState[K]) => {
    setState(prev => ({ ...prev, [key]: val }));
  }, []);

  const generateToken = useCallback(async (seed?: string) => {
    try {
      const res = await fetch('/api/setup/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: seed || undefined }),
      });
      const data = await res.json();
      if (data.token) setState(prev => ({ ...prev, authToken: data.token }));
    } catch (e) { console.warn('[SetupWizard] generateToken failed:', e); }
  }, []);

  const copyToken = useCallback(() => {
    copyToClipboard(state.authToken).then((ok) => {
      if (ok) toast.copy();
    });
  }, [state.authToken]);

  const checkPort = useCallback(async (port: number, which: 'web' | 'mcp', autoResolve = false) => {
    if (port < 1024 || port > 65535) return;
    const setStatus = which === 'web' ? setWebPortStatus : setMcpPortStatus;
    setStatus({ checking: true, available: null, isSelf: false, suggestion: null });
    try {
      const res = await fetch('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      const data = await res.json();
      const available = data.available ?? null;
      const suggestion = data.suggestion ?? null;
      setStatus({ checking: false, available, isSelf: !!data.isSelf, suggestion });

      // Auto-resolve: if port is occupied and a suggestion is available, use it silently
      if (autoResolve && available === false && suggestion) {
        const key = which === 'web' ? 'webPort' : 'mcpPort';
        setState(prev => ({ ...prev, [key]: suggestion }));
        // Re-check the suggested port
        setTimeout(() => checkPort(suggestion, which, false), 0);
      }
    } catch (e) {
      console.warn('[SetupWizard] checkPort failed:', e);
      setStatus({ checking: false, available: null, isSelf: false, suggestion: null });
    }
  }, []);

  const portConflict = state.webPort === state.mcpPort;

  const canNext = () => {
    if (step === STEP_KB) {
      // KB path required + password required
      return state.mindRoot.trim().length > 0 && state.webPassword.trim().length > 0;
    }
    if (step === STEP_AI) {
      // Ports validation (only when Advanced is open and ports were modified)
      if (portConflict) return false;
      if (webPortStatus.checking || mcpPortStatus.checking) return false;
      // Allow next if ports haven't been checked yet (user didn't open Advanced)
      if (webPortStatus.available === false || mcpPortStatus.available === false) return false;
      return true;
    }
    if (step === STEP_AGENTS) {
      return connectionMode.cli || connectionMode.mcp;
    }
    return true;
  };

  const handleComplete = async () => {
    setSubmitting(true);
    setError('');
    const agentKeys = Array.from(selectedAgents);

    // Ensure auth token exists before saving (race: token generation may still be in-flight)
    let finalState = state;
    if (!state.authToken) {
      try {
        const res = await fetch('/api/setup/generate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (data.token) {
          finalState = { ...state, authToken: data.token };
          setState(finalState);
        }
      } catch { /* proceed without — server will generate one */ }
    }

    // Phase 1: Save config
    setSetupPhase('saving');
    let restartNeeded = false;
    try {
      restartNeeded = await saveConfig(finalState);
      if (restartNeeded) setNeedsRestart(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSetupPhase('review');
      setSubmitting(false);
      return;
    }

    // Phase 2: Install MCP config to agents (only when MCP mode is enabled)
    if (connectionMode.mcp && agentKeys.length > 0) {
      setSetupPhase('agents');
      const initialStatuses: Record<string, AgentInstallStatus> = {};
      for (const key of agentKeys) initialStatuses[key] = { state: 'installing' };
      setAgentStatuses(initialStatuses);

      try {
        const statuses = await installAgents(agentKeys, agents, agentTransport, agentScope, finalState.mcpPort, finalState.authToken);
        setAgentStatuses(statuses);
      } catch (e) {
        console.warn('[SetupWizard] agent batch install failed:', e);
        const errStatuses: Record<string, AgentInstallStatus> = {};
        for (const key of agentKeys) errStatuses[key] = { state: 'error' };
        setAgentStatuses(errStatuses);
      }
    }

    // Phase 3: Install skills to selected agents ⭐ NEW
    if (agentKeys.length > 0) {
      setSetupPhase('skills');
      setSkillInstallStatus('installing');
      const skillName = finalState.template === 'zh' ? 'mindos-zh' : 'mindos';
      try {
        const skillOk = await installSkills(skillName, agentKeys);
        setSkillInstallStatus(skillOk ? 'ok' : 'error');
      } catch (e) {
        console.warn('[SetupWizard] skill install failed:', e);
        setSkillInstallStatus('error');
      }
    } else {
      setSkillInstallStatus('skipped');
    }

    setSubmitting(false);
    setCompleted(true);
    setSetupPhase('done');
    // Always stay on done page to show health check summary.
    // User navigates away via the "Go to MindOS" button.
  };

  const retryAgent = useCallback(async (key: string) => {
    setAgentStatuses(prev => ({ ...prev, [key]: { state: 'installing' } }));
    try {
      const payload = buildAgentPayload(key, agents, agentTransport, agentScope);
      const res = await fetch('/api/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: [payload],
          transport: agentTransport,
          url: `http://localhost:${state.mcpPort}/mcp`,
          token: state.authToken || undefined,
        }),
      });
      const data = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0] as { agent: string; status: string; message?: string; transport?: string; verified?: boolean; verifyError?: string };
        setAgentStatuses(prev => ({ ...prev, [key]: parseInstallResult(r) }));
      }
    } catch (e) {
      console.warn('[SetupWizard] retryAgent failed:', e);
      setAgentStatuses(prev => ({ ...prev, [key]: { state: 'error' } }));
    }
  }, [agents, agentScope, agentTransport, state.mcpPort, state.authToken]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto"
      role="dialog" aria-modal="true" aria-labelledby="setup-title"
      style={{ background: 'var(--background)' }}>
      {/* Sticky header: logo + step dots */}
      <div className="sticky top-0 z-10 pt-6 pb-3 px-6" style={{ background: 'var(--background)' }}>
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-3">
            <div className="inline-flex items-center gap-2">
              <Sparkles size={18} style={{ color: 'var(--amber)' }} />
              <h1 id="setup-title" className="text-2xl font-semibold tracking-tight font-display" style={{ color: 'var(--foreground)' }}>
                MindOS
              </h1>
            </div>
          </div>
          <div className="flex justify-center">
            <StepDots step={step} setStep={setStep} stepTitles={s.stepTitles} disabled={submitting || completed} numberedSteps={STEP_REVIEW} />
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 w-full max-w-xl mx-auto px-6 pb-8">
        <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--foreground)' }}>
          {step === STEP_REVIEW ? `✓ ${s.stepTitles[step]}` : s.stepTitles[step]}
        </h2>

        {step === 0 && <StepKB state={state} update={update} t={t} homeDir={homeDir} />}
        {step === 1 && (
          <StepAI state={state} update={update} s={s} onCopyToken={copyToken}
            webPortStatus={webPortStatus} mcpPortStatus={mcpPortStatus}
            setWebPortStatus={setWebPortStatus} setMcpPortStatus={setMcpPortStatus}
            checkPort={checkPort} portConflict={portConflict}
          />
        )}
        {step === 2 && (
          <StepAgents
            agents={agents} agentsLoading={agentsLoading}
            selectedAgents={selectedAgents} setSelectedAgents={setSelectedAgents}
            connectionMode={connectionMode} setConnectionMode={setConnectionMode}
            agentTransport={agentTransport} setAgentTransport={setAgentTransport}
            agentScope={agentScope} setAgentScope={setAgentScope}
            agentStatuses={agentStatuses} s={s} settingsMcp={t.settings.mcp}
          />
        )}
        {step === 3 && (
          <StepReview
            state={state} selectedAgents={selectedAgents}
            agentStatuses={agentStatuses} onRetryAgent={retryAgent}
            error={error} needsRestart={needsRestart}
            s={s}
            setupPhase={setupPhase}
            cliEnabled={connectionMode.cli}
            mcpEnabled={connectionMode.mcp}
            skillInstallStatus={skillInstallStatus}
          />
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setStep(step - 1)}
            disabled={step === 0 || submitting || completed}
            className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: 'var(--foreground)' }}>
            <ChevronLeft size={14} /> {s.back}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
              {s.next} <ChevronRight size={14} />
            </button>
          ) : completed ? (
            // After completing: show Restart button or Go link
            needsRestart ? (
              <RestartButton s={s} newPort={state.webPort} webPassword={state.webPassword} />
            ) : (
              <a href="/?welcome=1"
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
                {s.healthGoHome ?? 'Go to MindOS'} &rarr;
              </a>
            )
          ) : (
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="flex items-center gap-1 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? s.completing : s.complete}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
