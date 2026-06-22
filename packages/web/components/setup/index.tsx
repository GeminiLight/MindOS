'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import Logo from '@/components/Logo';
import { useLocale } from '@/lib/stores/locale-store';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import type { AgentEntry, AgentInstallStatus, ConnectionMode, SetupState, SetupProvider, PortStatus } from './types';
import type { ProviderId } from '@/lib/agent/providers';
import { TOTAL_STEPS, STEP_MIND_SPACE, STEP_AI, STEP_REVIEW } from './constants';
import StepMindSpace from './StepMindSpace';
import StepAI from './StepAI';
import StepReview from './StepReview';
import { RestartButton } from './StepReview';
import StepDots from './StepDots';
import { resolveSetupAgentTargets } from './installTargets';

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

/** Phase 1: Save setup config. Returns whether restart is needed. Throws on failure. */
async function saveConfig(state: SetupState, connectionMode?: { cli: boolean; mcp: boolean }): Promise<boolean> {
  const isSkip = state.activeProvider === 'skip' || state.providers.length === 0;

  // Strip apiKeyMask (UI-only field) before sending to server
  const cleanProviders = state.providers.map(({ apiKeyMask, ...rest }) => rest);

  const payload = {
    mindRoot: state.mindRoot,
    template: state.template || undefined,
    initialSpaces: state.initialSpaces,
    initialSpaceLocale: state.initialSpaceLocale,
    port: state.webPort,
    mcpPort: state.mcpPort,
    authToken: state.authToken,
    webPassword: state.webPassword,
    ai: isSkip ? undefined : {
      activeProvider: state.activeProvider,
      providers: cleanProviders,
    },
    connectionMode: connectionMode ?? { cli: true, mcp: false },
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

async function fetchSetupAgents(): Promise<AgentEntry[]> {
  const res = await fetch('/api/mcp/agents');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return Array.isArray(data.agents)
    ? (data.agents as AgentEntry[]).filter(a => a.scope !== 'builtin')
    : [];
}

function defaultSelectedAgents(agents: AgentEntry[]): Set<string> {
  return new Set(
    agents.filter(a => a.installed || a.present).map(a => a.key),
  );
}

async function requestSetupToken(): Promise<string> {
  const res = await fetch('/api/setup/generate-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json();
  return typeof data.token === 'string' ? data.token : '';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SetupWizard() {
  const { t, locale } = useLocale();
  const s = t.setup;

  const [step, setStep] = useState(0);
  const [state, setState] = useState<SetupState>({
    mindRoot: '~/Documents/MindOS/mind',
    template: '',
    initialSpaces: ['life', 'social', 'learning'],
    initialSpaceLocale: locale === 'zh' ? 'zh' : 'en',
    activeProvider: 'skip',
    providers: [],
    webPort: 3456,
    mcpPort: 8781,
    authToken: '',
    webPassword: '',
  });
  const [homeDir, setHomeDir] = useState('~');
  const [platformName, setPlatformName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);
  const [skillInstallStatus, setSkillInstallStatus] = useState<'pending' | 'installing' | 'ok' | 'error' | 'skipped'>('pending');

  const [webPortStatus, setWebPortStatus] = useState<PortStatus>({ checking: false, available: null, isSelf: false, suggestion: null });
  const [mcpPortStatus, setMcpPortStatus] = useState<PortStatus>({ checking: false, available: null, isSelf: false, suggestion: null });
  const [pathUnsafe, setPathUnsafe] = useState(false); // Track if mindRoot is in a dangerous location
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
        if (data.platform) setPlatformName(data.platform);

        setState(prev => {
          // Load providers from server (new unified Provider[] format)
          let loadedProviders: SetupProvider[] = prev.providers;
          if (Array.isArray(data.providerConfigs) && data.providerConfigs.length > 0) {
            loadedProviders = data.providerConfigs.map((p: any) => ({
              id: p.id,
              name: p.name || '',
              protocol: p.protocol as ProviderId,
              apiKey: '',         // Never sent from server; user re-enters or leaves blank to keep existing
              model: p.model || '',
              baseUrl: p.baseUrl || '',
              apiKeyMask: p.apiKeyMask || '',
            }));
          }

          const resolvedActive = data.activeProvider || prev.activeProvider;

          return {
            ...prev,
            mindRoot: data.mindRoot || prev.mindRoot,
            webPort: typeof data.port === 'number' ? data.port : prev.webPort,
            mcpPort: typeof data.mcpPort === 'number' ? data.mcpPort : prev.mcpPort,
            authToken: data.authToken || prev.authToken,
            webPassword: data.webPassword || prev.webPassword,
            activeProvider: resolvedActive,
            providers: loadedProviders,
          };
        });
        if (!data.authToken) {
          requestSetupToken()
            .then((authToken) => {
              setState(prev => ({
                ...prev,
                authToken: authToken || prev.authToken,
              }));
            })
            .catch(e => console.warn('[SetupWizard] Token generation failed:', e));
        }
      })
      .catch(e => {
        console.warn('[SetupWizard] Failed to load config, generating token as fallback:', e);
        requestSetupToken()
          .then((authToken) => setState(prev => ({ ...prev, authToken })))
          .catch(e2 => console.warn('[SetupWizard] Fallback secret generation also failed:', e2));
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

  // Load agents when entering the AI step advanced section can expose MCP setup.
  useEffect(() => {
    if (step === STEP_AI && !agentsLoaded && !agentsLoading) {
      setAgentsLoading(true);
      fetchSetupAgents()
        .then(externalAgents => {
          setAgents(externalAgents);
          setSelectedAgents(defaultSelectedAgents(externalAgents));
          setAgentsLoaded(true);
        })
        .catch(e => { console.warn('[SetupWizard] Failed to load agents:', e); setAgentsLoaded(true); })
        .finally(() => setAgentsLoading(false));
    }
  }, [step, agentsLoaded, agentsLoading]);

  // Check path safety when mindRoot changes
  useEffect(() => {
    if (!state.mindRoot.trim()) { setPathUnsafe(false); return; }
    const timer = setTimeout(() => {
      fetch('/api/setup/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.mindRoot }),
      })
        .then(r => r.json())
        .then(d => setPathUnsafe(!!d.unsafe))
        .catch(() => setPathUnsafe(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [state.mindRoot]);

  const update = useCallback(<K extends keyof SetupState>(key: K, val: SetupState[K]) => {
    setState(prev => ({ ...prev, [key]: val }));
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
        signal: AbortSignal.timeout(5000),
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
    if (step === STEP_MIND_SPACE) {
      if (pathUnsafe) return false;
      return state.mindRoot.trim().length > 0;
    }
    if (step === STEP_AI) {
      // Port validation should not stall the main flow while hidden background checks run.
      if (portConflict) return false;
      // Allow next if ports haven't been checked yet (user didn't open Advanced)
      if (webPortStatus.available === false || mcpPortStatus.available === false) return false;
      if (!connectionMode.cli && !connectionMode.mcp) return false;
      return true;
    }
    return true;
  };

  const handleComplete = async () => {
    setSubmitting(true);
    setError('');
    let effectiveAgents = agents;
    let effectiveSelectedAgents = selectedAgents;
    if (!agentsLoaded) {
      try {
        effectiveAgents = await fetchSetupAgents();
        const detectedAgents = defaultSelectedAgents(effectiveAgents);
        effectiveSelectedAgents = selectedAgents.size > 0 ? selectedAgents : detectedAgents;
        setAgents(effectiveAgents);
        setSelectedAgents(effectiveSelectedAgents);
        setAgentsLoaded(true);
      } catch (e) {
        console.warn('[SetupWizard] final agent detection failed:', e);
      }
    }
    const { skillAgentKeys, mcpAgentKeys } = resolveSetupAgentTargets({
      agents: effectiveAgents,
      selectedAgents: effectiveSelectedAgents,
      mcpEnabled: connectionMode.mcp,
    });

    // Ensure auth token exists before saving. Web Password is optional.
    let finalState = state;
    const secretPatch: Partial<SetupState> = {};
    try {
      if (!finalState.authToken) secretPatch.authToken = await requestSetupToken();
      if (secretPatch.authToken) {
        finalState = { ...finalState, ...secretPatch };
        setState(finalState);
      }
    } catch {
      // Server-side setup still validates and writes the config; surface any
      // final failure from saveConfig instead of blocking here.
    }

    setSetupPhase('saving');
    let restartNeeded = false;
    try {
      restartNeeded = await saveConfig(finalState, connectionMode);
      if (restartNeeded) setNeedsRestart(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSetupPhase('review');
      setSubmitting(false);
      return;
    }

    if (mcpAgentKeys.length > 0) {
      setSetupPhase('agents');
      const initialStatuses: Record<string, AgentInstallStatus> = {};
      for (const key of mcpAgentKeys) initialStatuses[key] = { state: 'installing' };
      setAgentStatuses(initialStatuses);

      try {
        const statuses = await installAgents(mcpAgentKeys, agents, agentTransport, agentScope, finalState.mcpPort, finalState.authToken);
        setAgentStatuses(statuses);
      } catch (e) {
        console.warn('[SetupWizard] agent batch install failed:', e);
        const errStatuses: Record<string, AgentInstallStatus> = {};
        for (const key of mcpAgentKeys) errStatuses[key] = { state: 'error' };
        setAgentStatuses(errStatuses);
      }
    }

    if (skillAgentKeys.length > 0) {
      setSetupPhase('skills');
      setSkillInstallStatus('installing');
      const skillName = finalState.initialSpaceLocale === 'zh' ? 'mindos-zh' : 'mindos';
      try {
        const skillOk = await installSkills(skillName, skillAgentKeys);
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
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background"
      role="dialog" aria-modal="true" aria-labelledby="setup-title"
    >
      {/* Sticky header: logo + step dots */}
      <div className="sticky top-0 z-10 border-b border-border/40 bg-background/95 px-6 pb-3 pt-6 shadow-sm backdrop-blur">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-3">
            <div className="inline-flex items-center gap-2">
              <Logo id="setup" className="h-5 w-10" />
              <h1 id="setup-title" className="text-2xl font-brand text-foreground">
                MindOS
              </h1>
            </div>
          </div>
          <div className="flex justify-center">
            <StepDots step={step} setStep={setStep} stepTitles={s.stepTitles} disabled={submitting || completed} numberedSteps={TOTAL_STEPS} />
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 pb-8 pt-7">
        <h2 className="text-lg font-semibold mb-5 text-foreground">
          {s.stepTitles[step]}
        </h2>

        {step === STEP_MIND_SPACE && (
          <StepMindSpace
            state={state}
            update={update}
            t={t}
            homeDir={homeDir}
            platformName={platformName}
            webPortStatus={webPortStatus}
            setWebPortStatus={setWebPortStatus}
            checkPort={checkPort}
          />
        )}
        {step === STEP_AI && (
          <StepAI state={state} update={update} s={s} onCopyToken={copyToken}
            webPortStatus={webPortStatus} mcpPortStatus={mcpPortStatus}
            setWebPortStatus={setWebPortStatus} setMcpPortStatus={setMcpPortStatus}
            checkPort={checkPort} portConflict={portConflict}
            agents={agents} agentsLoading={agentsLoading}
            selectedAgents={selectedAgents} setSelectedAgents={setSelectedAgents}
            connectionMode={connectionMode} setConnectionMode={setConnectionMode}
            agentTransport={agentTransport} setAgentTransport={setAgentTransport}
            agentScope={agentScope} setAgentScope={setAgentScope}
            agentStatuses={agentStatuses}
            settingsMcp={t.settings.mcp}
          />
        )}
        {step === STEP_REVIEW && (
          <StepReview
            state={state}
            selectedAgents={selectedAgents}
            agentStatuses={agentStatuses}
            onRetryAgent={retryAgent}
            error={error} needsRestart={needsRestart}
            s={s}
            setupPhase={setupPhase}
            cliEnabled={connectionMode.cli}
            mcpEnabled={connectionMode.mcp}
            skillInstallStatus={skillInstallStatus}
          />
        )}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={step === 0 || submitting || completed}
            className="flex items-center gap-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronLeft size={14} /> {s.back}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="flex items-center gap-1 rounded-lg bg-[var(--amber)] px-4 py-2 text-sm text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {s.next} <ChevronRight size={14} />
            </button>
          ) : completed ? (
            // After completing: show Restart button or Go link
            needsRestart ? (
              <RestartButton s={s} newPort={state.webPort} webPassword={state.webPassword} />
            ) : (
              <a href="/"
                className="flex items-center gap-1.5 rounded-lg bg-[var(--amber)] px-5 py-2 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {s.healthGoHome ?? 'Go to MindOS'} &rarr;
              </a>
            )
          ) : (
            <button
              type="button"
              onClick={handleComplete}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-[var(--amber)] px-5 py-2 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? s.completing : s.complete}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
