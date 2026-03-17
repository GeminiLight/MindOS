'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { SetupState, PortStatus, AgentEntry, AgentInstallStatus } from './types';
import { TOTAL_STEPS, STEP_KB, STEP_PORTS, STEP_AGENTS } from './constants';
import StepKB from './StepKB';
import StepAI from './StepAI';
import StepPorts from './StepPorts';
import StepSecurity from './StepSecurity';
import StepAgents from './StepAgents';
import StepReview from './StepReview';
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
  const payload = {
    mindRoot: state.mindRoot,
    template: state.template || undefined,
    port: state.webPort,
    mcpPort: state.mcpPort,
    authToken: state.authToken,
    webPassword: state.webPassword,
    ai: state.provider === 'skip' ? undefined : {
      provider: state.provider,
      providers: {
        anthropic: { apiKey: state.anthropicKey, model: state.anthropicModel },
        openai: { apiKey: state.openaiKey, model: state.openaiModel, baseUrl: state.openaiBaseUrl },
      },
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

/** Phase 3: Install skill to agents. Returns result. */
async function installSkill(
  template: string,
  agentKeys: string[],
): Promise<{ ok?: boolean; skill?: string; error?: string }> {
  const skillName = template === 'zh' ? 'mindos-zh' : 'mindos';
  const res = await fetch('/api/mcp/install-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: skillName, agents: agentKeys }),
  });
  return await res.json();
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
    anthropicKey: '',
    anthropicModel: 'claude-sonnet-4-6',
    openaiKey: '',
    openaiModel: 'gpt-5.4',
    openaiBaseUrl: '',
    webPort: 3000,
    mcpPort: 8787,
    authToken: '',
    webPassword: '',
  });
  const [homeDir, setHomeDir] = useState('~');
  const [tokenCopied, setTokenCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);

  const [webPortStatus, setWebPortStatus] = useState<PortStatus>({ checking: false, available: null, isSelf: false, suggestion: null });
  const [mcpPortStatus, setMcpPortStatus] = useState<PortStatus>({ checking: false, available: null, isSelf: false, suggestion: null });

  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [agentTransport, setAgentTransport] = useState<'auto' | 'stdio' | 'http'>('auto');
  const [agentScope, setAgentScope] = useState<'global' | 'project'>('global');
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentInstallStatus>>({});
  const [skillInstallResult, setSkillInstallResult] = useState<{ ok?: boolean; skill?: string; error?: string } | null>(null);
  const [setupPhase, setSetupPhase] = useState<'review' | 'saving' | 'agents' | 'skill' | 'done'>('review');

  // Load existing config as defaults on mount, generate token if none exists
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        if (data.homeDir) setHomeDir(data.homeDir);
        setState(prev => ({
          ...prev,
          mindRoot: data.mindRoot || prev.mindRoot,
          webPort: typeof data.port === 'number' ? data.port : prev.webPort,
          mcpPort: typeof data.mcpPort === 'number' ? data.mcpPort : prev.mcpPort,
          authToken: data.authToken || prev.authToken,
          webPassword: data.webPassword || prev.webPassword,
          provider: (data.provider === 'anthropic' || data.provider === 'openai') ? data.provider : prev.provider,
          anthropicModel: data.anthropicModel || prev.anthropicModel,
          openaiModel: data.openaiModel || prev.openaiModel,
          openaiBaseUrl: data.openaiBaseUrl ?? prev.openaiBaseUrl,
        }));
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

  // Auto-check ports when entering Step 3
  useEffect(() => {
    if (step === STEP_PORTS) {
      checkPort(state.webPort, 'web');
      checkPort(state.mcpPort, 'mcp');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Load agents when entering Step 5
  useEffect(() => {
    if (step === STEP_AGENTS && !agentsLoaded && !agentsLoading) {
      setAgentsLoading(true);
      fetch('/api/mcp/agents')
        .then(r => r.json())
        .then(data => {
          if (data.agents) {
            setAgents(data.agents);
            setSelectedAgents(new Set(
              (data.agents as AgentEntry[]).filter(a => a.installed || a.present).map(a => a.key)
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
    navigator.clipboard.writeText(state.authToken).catch(() => { /* clipboard unavailable in insecure context */ });
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }, [state.authToken]);

  const checkPort = useCallback(async (port: number, which: 'web' | 'mcp') => {
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
      setStatus({ checking: false, available: data.available ?? null, isSelf: !!data.isSelf, suggestion: data.suggestion ?? null });
    } catch (e) {
      console.warn('[SetupWizard] checkPort failed:', e);
      setStatus({ checking: false, available: null, isSelf: false, suggestion: null });
    }
  }, []);

  const portConflict = state.webPort === state.mcpPort;

  const canNext = () => {
    if (step === STEP_KB) return state.mindRoot.trim().length > 0;
    if (step === STEP_PORTS) {
      if (portConflict) return false;
      if (webPortStatus.checking || mcpPortStatus.checking) return false;
      if (webPortStatus.available !== true || mcpPortStatus.available !== true) return false;
      return (
        state.webPort >= 1024 && state.webPort <= 65535 &&
        state.mcpPort >= 1024 && state.mcpPort <= 65535
      );
    }
    return true;
  };

  const handleComplete = async () => {
    setSubmitting(true);
    setError('');
    const agentKeys = Array.from(selectedAgents);

    // Phase 1: Save config
    setSetupPhase('saving');
    let restartNeeded = false;
    try {
      restartNeeded = await saveConfig(state);
      if (restartNeeded) setNeedsRestart(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSetupPhase('review');
      setSubmitting(false);
      return;
    }

    // Phase 2: Install agents
    setSetupPhase('agents');
    if (agentKeys.length > 0) {
      const initialStatuses: Record<string, AgentInstallStatus> = {};
      for (const key of agentKeys) initialStatuses[key] = { state: 'installing' };
      setAgentStatuses(initialStatuses);

      try {
        const statuses = await installAgents(agentKeys, agents, agentTransport, agentScope, state.mcpPort, state.authToken);
        setAgentStatuses(statuses);
      } catch (e) {
        console.warn('[SetupWizard] agent batch install failed:', e);
        const errStatuses: Record<string, AgentInstallStatus> = {};
        for (const key of agentKeys) errStatuses[key] = { state: 'error' };
        setAgentStatuses(errStatuses);
      }
    }

    // Phase 3: Install skill
    setSetupPhase('skill');
    try {
      const skillData = await installSkill(state.template, agentKeys);
      setSkillInstallResult(skillData);
    } catch (e) {
      console.warn('[SetupWizard] skill install failed:', e);
      setSkillInstallResult({ error: 'Failed to install skill' });
    }

    setSubmitting(false);
    setCompleted(true);
    setSetupPhase('done');

    if (restartNeeded) {
      // Config changed requiring restart — stay on page, show restart block
      return;
    }
    window.location.href = '/?welcome=1';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
      role="dialog" aria-modal="true" aria-labelledby="setup-title"
      style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-xl mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <Sparkles size={18} style={{ color: 'var(--amber)' }} />
            <h1 id="setup-title" className="text-2xl font-semibold tracking-tight font-display" style={{ color: 'var(--foreground)' }}>
              MindOS
            </h1>
          </div>
        </div>

        <div className="flex justify-center">
          <StepDots step={step} setStep={setStep} stepTitles={s.stepTitles} disabled={submitting || completed} />
        </div>

        <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--foreground)' }}>
          {s.stepTitles[step]}
        </h2>

        {step === 0 && <StepKB state={state} update={update} t={t} homeDir={homeDir} />}
        {step === 1 && <StepAI state={state} update={update} s={s} />}
        {step === 2 && (
          <StepPorts
            state={state} update={update}
            webPortStatus={webPortStatus} mcpPortStatus={mcpPortStatus}
            setWebPortStatus={setWebPortStatus} setMcpPortStatus={setMcpPortStatus}
            checkPort={checkPort} portConflict={portConflict} s={s}
          />
        )}
        {step === 3 && (
          <StepSecurity
            authToken={state.authToken} tokenCopied={tokenCopied}
            onCopy={copyToken} onGenerate={generateToken}
            webPassword={state.webPassword} onPasswordChange={v => update('webPassword', v)}
            s={s}
          />
        )}
        {step === 4 && (
          <StepAgents
            agents={agents} agentsLoading={agentsLoading}
            selectedAgents={selectedAgents} setSelectedAgents={setSelectedAgents}
            agentTransport={agentTransport} setAgentTransport={setAgentTransport}
            agentScope={agentScope} setAgentScope={setAgentScope}
            agentStatuses={agentStatuses} s={s} settingsMcp={t.settings.mcp}
            template={state.template}
          />
        )}
        {step === 5 && (
          <StepReview
            state={state} selectedAgents={selectedAgents}
            agentStatuses={agentStatuses} onRetryAgent={retryAgent}
            error={error} needsRestart={needsRestart}
            s={s}
            skillInstallResult={skillInstallResult}
            setupPhase={setupPhase}
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
            // After completing: show Done link (no restart needed) or nothing (RestartBlock handles it)
            !needsRestart ? (
              <a href="/?welcome=1"
                className="flex items-center gap-1 px-5 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}>
                {s.completeDone} &rarr;
              </a>
            ) : null
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
