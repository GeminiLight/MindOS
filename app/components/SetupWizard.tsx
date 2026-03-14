'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Globe, BookOpen, FileText, Copy, Check, RefreshCw,
  Loader2, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2,
  XCircle, Zap, Brain, SkipForward,
} from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { Field, Input, Select, ApiKeyInput } from '@/components/settings/Primitives';

type Template = 'en' | 'zh' | 'empty' | '';

interface SetupState {
  mindRoot: string;
  template: Template;
  provider: 'anthropic' | 'openai' | 'skip';
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  webPort: number;
  mcpPort: number;
  authToken: string;
  webPassword: string;
}

interface PortStatus {
  checking: boolean;
  available: boolean | null;  // null = not yet checked
  suggestion: number | null;
}

interface AgentEntry {
  key: string;
  name: string;
  installed: boolean;
  hasProjectScope: boolean;
  hasGlobalScope: boolean;
}

// Per-agent install tracking (live, in Step 5)
type AgentInstallState = 'pending' | 'installing' | 'ok' | 'error';
interface AgentInstallStatus {
  state: AgentInstallState;
  message?: string;
}

const TEMPLATES: Array<{ id: Template; icon: React.ReactNode; dirs: string[] }> = [
  { id: 'en', icon: <Globe size={18} />, dirs: ['Profile/', 'Connections/', 'Notes/', 'Workflows/', 'Resources/', 'Projects/'] },
  { id: 'zh', icon: <BookOpen size={18} />, dirs: ['画像/', '关系/', '笔记/', '流程/', '资源/', '项目/'] },
  { id: 'empty', icon: <FileText size={18} />, dirs: ['README.md', 'CONFIG.json', 'INSTRUCTION.md'] },
];

const TOTAL_STEPS = 6;
const STEP_KB = 0;
const STEP_PORTS = 2;
const STEP_AGENTS = 4;

// -------------------------------------------------------------------
// Step4Inner — extracted so its local seed/showSeed state survives
// parent re-renders (declaring inside SetupWizard would remount it)
// -------------------------------------------------------------------
function Step4Inner({
  authToken, tokenCopied, onCopy, onGenerate, webPassword, onPasswordChange, s,
}: {
  authToken: string;
  tokenCopied: boolean;
  onCopy: () => void;
  onGenerate: (seed?: string) => void;
  webPassword: string;
  onPasswordChange: (v: string) => void;
  s: {
    authToken: string; authTokenHint: string; authTokenSeed: string; authTokenSeedHint: string;
    generateToken: string; copyToken: string; copiedToken: string;
    webPassword: string; webPasswordHint: string;
  };
}) {
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  return (
    <div className="space-y-5">
      <Field label={s.authToken} hint={s.authTokenHint}>
        <div className="flex gap-2">
          <Input value={authToken} readOnly className="font-mono text-xs" />
          <button onClick={onCopy}
            className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
            style={{ color: 'var(--foreground)' }}>
            {tokenCopied ? <Check size={14} /> : <Copy size={14} />}
            {tokenCopied ? s.copiedToken : s.copyToken}
          </button>
          <button onClick={() => onGenerate()}
            className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
            style={{ color: 'var(--foreground)' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </Field>
      <div>
        <button onClick={() => setShowSeed(!showSeed)} className="text-xs underline"
          style={{ color: 'var(--muted-foreground)' }}>
          {s.authTokenSeed}
        </button>
        {showSeed && (
          <div className="mt-2 flex gap-2">
            <Input value={seed} onChange={e => setSeed(e.target.value)} placeholder={s.authTokenSeedHint} />
            <button onClick={() => { if (seed.trim()) onGenerate(seed); }}
              className="px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
              style={{ color: 'var(--foreground)' }}>
              {s.generateToken}
            </button>
          </div>
        )}
      </div>
      <Field label={s.webPassword} hint={s.webPasswordHint}>
        <Input type="password" value={webPassword} onChange={e => onPasswordChange(e.target.value)} placeholder="(optional)" />
      </Field>
    </div>
  );
}

// -------------------------------------------------------------------
// PortField — input + inline availability badge + suggestion button
// -------------------------------------------------------------------
function PortField({
  label, hint, value, onChange, status, onCheckPort, s,
}: {
  label: string; hint: string; value: number;
  onChange: (v: number) => void;
  status: PortStatus;
  onCheckPort: (port: number) => void;
  s: { portChecking: string; portInUse: (p: number) => string; portSuggest: (p: number) => string; portAvailable: string };
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        <Input
          type="number" min={1024} max={65535} value={value}
          onChange={e => onChange(parseInt(e.target.value, 10) || value)}
          onBlur={() => onCheckPort(value)}
        />
        {status.checking && (
          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--muted-foreground)' }}>
            <Loader2 size={11} className="animate-spin" /> {s.portChecking}
          </p>
        )}
        {!status.checking && status.available === false && (
          <div className="flex items-center gap-2">
            <p className="text-xs flex items-center gap-1" style={{ color: 'var(--amber)' }}>
              <AlertTriangle size={11} /> {s.portInUse(value)}
            </p>
            {status.suggestion !== null && (
              <button type="button"
                onClick={() => {
                  onChange(status.suggestion!);
                  setTimeout(() => onCheckPort(status.suggestion!), 0);
                }}
                className="text-xs px-2 py-0.5 rounded border transition-colors"
                style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                {s.portSuggest(status.suggestion)}
              </button>
            )}
          </div>
        )}
        {!status.checking && status.available === true && (
          <p className="text-xs flex items-center gap-1" style={{ color: '#22c55e' }}>
            <CheckCircle2 size={11} /> {s.portAvailable}
          </p>
        )}
      </div>
    </Field>
  );
}

// -------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------
export default function SetupWizard() {
  const { t } = useLocale();
  const s = t.setup;

  const [step, setStep] = useState(0);
  const [state, setState] = useState<SetupState>({
    mindRoot: '~/MindOS',
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
  const [tokenCopied, setTokenCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [portChanged, setPortChanged] = useState(false);

  // Port availability
  const [webPortStatus, setWebPortStatus] = useState<PortStatus>({ checking: false, available: null, suggestion: null });
  const [mcpPortStatus, setMcpPortStatus] = useState<PortStatus>({ checking: false, available: null, suggestion: null });

  // Agent Tools
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [agentTransport, setAgentTransport] = useState<'stdio' | 'http'>('stdio');
  const [agentScope, setAgentScope] = useState<'global' | 'project'>('global');
  // Live per-agent install status (shown inline in Step 5 during/after submit)
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentInstallStatus>>({});

  // Generate token on mount
  useEffect(() => {
    fetch('/api/setup/generate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(data => { if (data.token) setState(prev => ({ ...prev, authToken: data.token })); })
      .catch(() => {});
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
    if (step === STEP_AGENTS && agents.length === 0 && !agentsLoading) {
      setAgentsLoading(true);
      fetch('/api/mcp/agents')
        .then(r => r.json())
        .then(data => {
          if (data.agents) {
            setAgents(data.agents);
            setSelectedAgents(new Set(
              (data.agents as AgentEntry[]).filter(a => a.installed).map(a => a.key)
            ));
          }
        })
        .catch(() => {})
        .finally(() => setAgentsLoading(false));
    }
  }, [step, agents.length, agentsLoading]);

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
    } catch { /* ignore */ }
  }, []);

  const copyToken = useCallback(() => {
    setState(prev => { navigator.clipboard.writeText(prev.authToken); return prev; });
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }, []);

  const checkPort = useCallback(async (port: number, which: 'web' | 'mcp') => {
    if (port < 1024 || port > 65535) return;
    const setStatus = which === 'web' ? setWebPortStatus : setMcpPortStatus;
    setStatus({ checking: true, available: null, suggestion: null });
    try {
      const res = await fetch('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      const data = await res.json();
      setStatus({ checking: false, available: data.available ?? null, suggestion: data.suggestion ?? null });
    } catch {
      setStatus({ checking: false, available: null, suggestion: null });
    }
  }, []);

  const handleComplete = async () => {
    setSubmitting(true);
    setError('');

    // 1. Save setup config first
    try {
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
      if (data.portChanged) setPortChanged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
      return;
    }

    // 2. Install agents after config saved — update statuses live
    if (selectedAgents.size > 0) {
      // Mark all selected as "installing"
      const initialStatuses: Record<string, AgentInstallStatus> = {};
      for (const key of selectedAgents) initialStatuses[key] = { state: 'installing' };
      setAgentStatuses(initialStatuses);

      try {
        const agentsPayload = Array.from(selectedAgents).map(key => ({ key, scope: agentScope }));
        const res = await fetch('/api/mcp/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agents: agentsPayload,
            transport: agentTransport,
            url: `http://localhost:${state.mcpPort}/mcp`,
            token: state.authToken || undefined,
          }),
        });
        const data = await res.json();
        if (data.results) {
          const updated: Record<string, AgentInstallStatus> = {};
          for (const r of data.results as Array<{ agent: string; status: string; message?: string }>) {
            updated[r.agent] = {
              state: r.status === 'ok' ? 'ok' : 'error',
              message: r.message,
            };
          }
          setAgentStatuses(updated);
        }
      } catch {
        // Mark all as error
        const errStatuses: Record<string, AgentInstallStatus> = {};
        for (const key of selectedAgents) errStatuses[key] = { state: 'error' };
        setAgentStatuses(errStatuses);
      }
    }

    setSubmitting(false);
    if (!portChanged) window.location.href = '/';
  };

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

  const maskKey = (key: string) => {
    if (!key) return '(not set)';
    if (key.length <= 8) return '•••';
    return key.slice(0, 6) + '•••' + key.slice(-3);
  };

  // ----------------------------------------------------------------
  // Step dots
  // ----------------------------------------------------------------
  const StepDots = () => (
    <div className="flex items-center gap-2 mb-8">
      {s.stepTitles.map((title: string, i: number) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <div className="w-8 h-px" style={{ background: i <= step ? 'var(--amber)' : 'var(--border)' }} />}
          <button onClick={() => i < step && setStep(i)} className="flex items-center gap-1.5" disabled={i > step}>
            <div
              className="w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center transition-colors"
              style={{
                background: i <= step ? 'var(--amber)' : 'var(--muted)',
                color: i <= step ? 'white' : 'var(--muted-foreground)',
                opacity: i <= step ? 1 : 0.5,
              }}
            >
              {i + 1}
            </div>
            <span className="text-xs hidden sm:inline"
              style={{ color: i === step ? 'var(--foreground)' : 'var(--muted-foreground)', opacity: i <= step ? 1 : 0.5 }}>
              {title}
            </span>
          </button>
        </div>
      ))}
    </div>
  );

  // ----------------------------------------------------------------
  // Step 1: Knowledge Base
  // ----------------------------------------------------------------
  const Step1 = () => (
    <div className="space-y-6">
      <Field label={s.kbPath} hint={s.kbPathHint}>
        <Input value={state.mindRoot} onChange={e => update('mindRoot', e.target.value)} placeholder={s.kbPathDefault} />
      </Field>
      <div>
        <label className="text-sm text-foreground font-medium mb-3 block">{s.template}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TEMPLATES.map(tpl => (
            <button key={tpl.id} onClick={() => update('template', tpl.id)}
              className="flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all duration-150"
              style={{
                background: state.template === tpl.id ? 'var(--amber-subtle, rgba(200,135,30,0.08))' : 'var(--card)',
                borderColor: state.template === tpl.id ? 'var(--amber)' : 'var(--border)',
              }}>
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--amber)' }}>{tpl.icon}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.onboarding.templates[tpl.id as 'en' | 'zh' | 'empty'].title}
                </span>
              </div>
              <div className="w-full rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed font-display"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                {tpl.dirs.map(d => <div key={d}>{d}</div>)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ----------------------------------------------------------------
  // Step 2: AI Provider — card-based selection including skip
  // ----------------------------------------------------------------
  const PROVIDERS = [
    {
      id: 'anthropic' as const,
      icon: <Brain size={18} />,
      label: 'Anthropic',
      desc: 'Claude — claude-sonnet-4-6',
    },
    {
      id: 'openai' as const,
      icon: <Zap size={18} />,
      label: 'OpenAI',
      desc: 'GPT or any OpenAI-compatible API',
    },
    {
      id: 'skip' as const,
      icon: <SkipForward size={18} />,
      label: s.aiSkipTitle,
      desc: s.aiSkipDesc,
    },
  ];

  const Step2 = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3">
        {PROVIDERS.map(p => (
          <button key={p.id} onClick={() => update('provider', p.id)}
            className="flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150"
            style={{
              background: state.provider === p.id ? 'var(--amber-subtle, rgba(200,135,30,0.08))' : 'var(--card)',
              borderColor: state.provider === p.id ? 'var(--amber)' : 'var(--border)',
            }}>
            <span className="mt-0.5" style={{ color: state.provider === p.id ? 'var(--amber)' : 'var(--muted-foreground)' }}>
              {p.icon}
            </span>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{p.label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{p.desc}</p>
            </div>
            {state.provider === p.id && (
              <CheckCircle2 size={16} className="ml-auto mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
            )}
          </button>
        ))}
      </div>

      {state.provider !== 'skip' && (
        <div className="space-y-4 pt-2">
          <Field label={s.apiKey}>
            <ApiKeyInput
              value={state.provider === 'anthropic' ? state.anthropicKey : state.openaiKey}
              onChange={v => update(state.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey', v)}
              placeholder={state.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            />
          </Field>
          <Field label={s.model}>
            <Input
              value={state.provider === 'anthropic' ? state.anthropicModel : state.openaiModel}
              onChange={e => update(state.provider === 'anthropic' ? 'anthropicModel' : 'openaiModel', e.target.value)}
            />
          </Field>
          {state.provider === 'openai' && (
            <Field label={s.baseUrl} hint={s.baseUrlHint}>
              <Input value={state.openaiBaseUrl} onChange={e => update('openaiBaseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1" />
            </Field>
          )}
        </div>
      )}
    </div>
  );

  // ----------------------------------------------------------------
  // Step 3: Ports
  // ----------------------------------------------------------------
  const Step3 = () => (
    <div className="space-y-5">
      <PortField
        label={s.webPort} hint={s.portHint} value={state.webPort}
        onChange={v => { update('webPort', v); setWebPortStatus({ checking: false, available: null, suggestion: null }); }}
        status={webPortStatus}
        onCheckPort={port => checkPort(port, 'web')}
        s={s}
      />
      <PortField
        label={s.mcpPort} hint={s.portHint} value={state.mcpPort}
        onChange={v => { update('mcpPort', v); setMcpPortStatus({ checking: false, available: null, suggestion: null }); }}
        status={mcpPortStatus}
        onCheckPort={port => checkPort(port, 'mcp')}
        s={s}
      />
      {portConflict && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--amber)' }}>
          <AlertTriangle size={12} /> {s.portConflict}
        </p>
      )}
      {!portConflict && (webPortStatus.available === null || mcpPortStatus.available === null) && !webPortStatus.checking && !mcpPortStatus.checking && (
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{s.portVerifyHint}</p>
      )}
      <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
        <AlertTriangle size={12} /> {s.portRestartWarning}
      </p>
    </div>
  );

  // ----------------------------------------------------------------
  // Step 5: Agent Tools
  // ----------------------------------------------------------------
  const Step5 = () => {
    const toggleAgent = (key: string) => {
      setSelectedAgents(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
    };

    const getStatusBadge = (key: string, installed: boolean) => {
      const st = agentStatuses[key];

      // Show install result if we've run setup
      if (st) {
        if (st.state === 'installing') return (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
            <Loader2 size={10} className="animate-spin" /> {s.agentInstalling}
          </span>
        );
        if (st.state === 'ok') return (
          <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
            <CheckCircle2 size={10} /> {s.agentStatusOk}
          </span>
        );
        if (st.state === 'error') return (
          <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            <XCircle size={10} /> {s.agentStatusError}
            {st.message && <span className="ml-1 text-[10px]">({st.message})</span>}
          </span>
        );
      }

      // Show app install status (before setup runs)
      if (installed) return (
        <span className="text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
          {t.settings.mcp.installed}
        </span>
      );
      return (
        <span className="text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(100,100,120,0.1)', color: 'var(--muted-foreground)' }}>
          {s.agentNotInstalled}
        </span>
      );
    };

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
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {agents.map((agent, i) => (
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
                    className="accent-amber-500"
                    disabled={agentStatuses[agent.key]?.state === 'installing'}
                  />
                  <span className="text-sm flex-1" style={{ color: 'var(--foreground)' }}>{agent.name}</span>
                  {getStatusBadge(agent.key, agent.installed)}
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label={s.agentTransport}>
                <Select value={agentTransport} onChange={e => setAgentTransport(e.target.value as 'stdio' | 'http')}>
                  <option value="stdio">{t.settings.mcp.transportStdio}</option>
                  <option value="http">{t.settings.mcp.transportHttp}</option>
                </Select>
              </Field>
              <Field label={s.agentScope}>
                <Select value={agentScope} onChange={e => setAgentScope(e.target.value as 'global' | 'project')}>
                  <option value="global">{t.settings.mcp.global}</option>
                  <option value="project">{t.settings.mcp.project}</option>
                </Select>
              </Field>
            </div>

            {selectedAgents.size === 0 && (
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{s.agentNoneSelected}</p>
            )}
          </>
        )}
      </div>
    );
  };

  // ----------------------------------------------------------------
  // Step 6: Review
  // ----------------------------------------------------------------
  const Step6 = () => {
    const rows: [string, string][] = [
      [s.kbPath, state.mindRoot],
      [s.template, state.template || '—'],
      [s.aiProvider, state.provider === 'skip' ? s.aiSkipTitle : state.provider],
      ...(state.provider !== 'skip' ? [
        [s.apiKey, maskKey(state.provider === 'anthropic' ? state.anthropicKey : state.openaiKey)] as [string, string],
        [s.model, state.provider === 'anthropic' ? state.anthropicModel : state.openaiModel] as [string, string],
      ] : []),
      [s.webPort, String(state.webPort)],
      [s.mcpPort, String(state.mcpPort)],
      [s.authToken, state.authToken || '—'],
      [s.webPassword, state.webPassword ? '••••••••' : '(none)'],
      [s.agentToolsTitle, selectedAgents.size > 0 ? Array.from(selectedAgents).join(', ') : '—'],
    ];

    return (
      <div className="space-y-5">
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{s.reviewHint}</p>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {rows.map(([label, value], i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 text-sm"
              style={{
                background: i % 2 === 0 ? 'var(--card)' : 'transparent',
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
              }}>
              <span style={{ color: 'var(--muted-foreground)' }}>{label}</span>
              <span className="font-mono text-xs" style={{ color: 'var(--foreground)' }}>{value}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-lg text-sm text-red-500" style={{ background: 'rgba(239,68,68,0.1)' }}>
            {s.completeFailed}: {error}
          </div>
        )}

        {portChanged && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg text-sm flex items-center gap-2"
              style={{ background: 'rgba(200,135,30,0.1)', color: 'var(--amber)' }}>
              <AlertTriangle size={14} /> {s.portChanged}
            </div>
            <a href="/" className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--amber)', color: 'white' }}>
              {s.completeDone} &rarr;
            </a>
          </div>
        )}
      </div>
    );
  };

  const steps = [
    Step1,
    Step2,
    Step3,
    () => (
      <Step4Inner
        authToken={state.authToken}
        tokenCopied={tokenCopied}
        onCopy={copyToken}
        onGenerate={generateToken}
        webPassword={state.webPassword}
        onPasswordChange={v => update('webPassword', v)}
        s={s}
      />
    ),
    Step5,
    Step6,
  ];
  const CurrentStep = steps[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
      style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <Sparkles size={18} style={{ color: 'var(--amber)' }} />
            <h1 className="text-2xl font-semibold tracking-tight font-display" style={{ color: 'var(--foreground)' }}>
              MindOS
            </h1>
          </div>
        </div>

        <div className="flex justify-center">
          <StepDots />
        </div>

        <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--foreground)' }}>
          {s.stepTitles[step]}
        </h2>

        <CurrentStep />

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: 'var(--foreground)' }}>
            <ChevronLeft size={14} /> {s.back}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--amber)', color: 'white' }}>
              {s.next} <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={submitting || portChanged}
              className="flex items-center gap-1 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--amber)', color: 'white' }}>
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? s.completing : portChanged ? s.completeDone : s.complete}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
