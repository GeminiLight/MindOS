'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Sparkles, Globe, BookOpen, FileText, Copy, Check, RefreshCw,
  Loader2, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2,
  XCircle, Zap, Brain, SkipForward, Info, ChevronDown,
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
  available: boolean | null;
  isSelf: boolean;
  suggestion: number | null;
}

interface AgentEntry {
  key: string;
  name: string;
  present: boolean;
  installed: boolean;
  hasProjectScope: boolean;
  hasGlobalScope: boolean;
  preferredTransport: 'stdio' | 'http';
}

type AgentInstallState = 'pending' | 'installing' | 'ok' | 'error';
interface AgentInstallStatus {
  state: AgentInstallState;
  message?: string;
  transport?: string;
  verified?: boolean;
  verifyError?: string;
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

// ─── Step 4 (Security) ────────────────────────────────────────────────────────
// Extracted at module level so its local seed/showSeed state survives parent re-renders
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
    authToken: string; authTokenHint: string; authTokenUsage: string; authTokenUsageWhat: string;
    authTokenSeed: string; authTokenSeedHint: string;
    generateToken: string; copyToken: string; copiedToken: string;
    webPassword: string; webPasswordHint: string;
  };
}) {
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
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
      <div className="space-y-1.5">
        <button onClick={() => setShowUsage(!showUsage)} className="text-xs underline"
          style={{ color: 'var(--muted-foreground)' }}>
          {s.authTokenUsageWhat}
        </button>
        {showUsage && (
          <p className="text-xs leading-relaxed px-3 py-2 rounded-lg"
            style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
            {s.authTokenUsage}
          </p>
        )}
      </div>
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

// ─── PortField ────────────────────────────────────────────────────────────────
function PortField({
  label, hint, value, onChange, status, onCheckPort, s,
}: {
  label: string; hint: string; value: number;
  onChange: (v: number) => void;
  status: PortStatus;
  onCheckPort: (port: number) => void;
  s: { portChecking: string; portInUse: (p: number) => string; portSuggest: (p: number) => string; portAvailable: string; portSelf: string };
}) {
  // Debounce auto-check on input change (500ms)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10) || value;
    onChange(v);
    clearTimeout(timerRef.current);
    if (v >= 1024 && v <= 65535) {
      timerRef.current = setTimeout(() => onCheckPort(v), 500);
    }
  };
  const handleBlur = () => {
    // Cancel pending debounce — onBlur fires the check immediately
    clearTimeout(timerRef.current);
    onCheckPort(value);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        <Input
          type="number" min={1024} max={65535} value={value}
          onChange={handleChange}
          onBlur={handleBlur}
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
            <CheckCircle2 size={11} /> {status.isSelf ? s.portSelf : s.portAvailable}
          </p>
        )}
      </div>
    </Field>
  );
}

// Derive parent dir from current input for ls — supports both / and \ separators
function getParentDir(p: string): string {
  if (!p.trim()) return '';
  const trimmed = p.trim();
  // Already a directory (ends with separator)
  if (trimmed.endsWith('/') || trimmed.endsWith('\\')) return trimmed;
  // Find last separator (/ or \)
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : '';
}

// ─── Step 1: Knowledge Base ───────────────────────────────────────────────────
function Step1({
  state, update, t, homeDir,
}: {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  t: ReturnType<typeof useLocale>['t'];
  homeDir: string;
}) {
  const s = t.setup;
  // Build platform-aware placeholder, e.g. /Users/alice/MindOS/mind or C:\Users\alice\MindOS\mind
  // Windows homedir always contains \, e.g. C:\Users\Alice — safe to detect by separator
  const sep = homeDir.includes('\\') ? '\\' : '/';
  const placeholder = homeDir !== '~' ? [homeDir, 'MindOS', 'mind'].join(sep) : s.kbPathDefault;
  const [pathInfo, setPathInfo] = useState<{ exists: boolean; empty: boolean; count: number } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [showTemplatePickerAnyway, setShowTemplatePickerAnyway] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced autocomplete
  useEffect(() => {
    if (!state.mindRoot.trim()) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      const parent = getParentDir(state.mindRoot) || homeDir;
      fetch('/api/setup/ls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: parent }),
      })
        .then(r => r.json())
        .then(d => {
          if (!d.dirs?.length) { setSuggestions([]); return; }
          // Normalize parent to end with a separator (preserve existing / or \)
          const endsWithSep = parent.endsWith('/') || parent.endsWith('\\');
          const localSep = parent.includes('\\') ? '\\' : '/';
          const parentNorm = endsWithSep ? parent : parent + localSep;
          const typed = state.mindRoot.trim();
          const full: string[] = (d.dirs as string[]).map((dir: string) => parentNorm + dir);
          const endsWithAnySep = typed.endsWith('/') || typed.endsWith('\\');
          const filtered = endsWithAnySep ? full : full.filter(f => f.startsWith(typed));
          setSuggestions(filtered.slice(0, 8));
          setShowSuggestions(filtered.length > 0);
          setActiveSuggestion(-1);
        })
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [state.mindRoot, homeDir]);

  // Debounced path check
  useEffect(() => {
    if (!state.mindRoot.trim()) { setPathInfo(null); return; }
    const timer = setTimeout(() => {
      fetch('/api/setup/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.mindRoot }),
      })
        .then(r => r.json())
        .then(d => {
          setPathInfo(d);
          setShowTemplatePickerAnyway(false);
          // Non-empty directory: default to skip template (user can opt-in to merge)
          if (d?.exists && !d.empty) update('template', '');
        })
        .catch(() => setPathInfo(null));
    }, 600);
    return () => clearTimeout(timer);
  }, [state.mindRoot]);

  const hideSuggestions = () => {
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  };

  const selectSuggestion = (val: string) => {
    update('mindRoot', val);
    hideSuggestions();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="space-y-6">
      <Field label={s.kbPath} hint={s.kbPathHint}>
        <div className="relative">
          <input
            ref={inputRef}
            value={state.mindRoot}
            onChange={e => { update('mindRoot', e.target.value); setShowSuggestions(true); }}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => hideSuggestions(), 150)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-sm rounded-lg border outline-none transition-colors"
            style={{
              background: 'var(--input, var(--card))',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border overflow-auto"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                maxHeight: '220px',
              }}>
              {suggestions.map((suggestion, i) => (
                <button
                  key={suggestion}
                  type="button"
                  onMouseDown={() => selectSuggestion(suggestion)}
                  className="w-full text-left px-3 py-2 text-sm font-mono transition-colors"
                  style={{
                    background: i === activeSuggestion ? 'var(--muted)' : 'transparent',
                    color: 'var(--foreground)',
                    borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                  }}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Recommended default — one-click accept */}
        {state.mindRoot !== placeholder && placeholder !== s.kbPathDefault && (
          <button type="button"
            onClick={() => update('mindRoot', placeholder)}
            className="mt-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors hover:bg-muted/50"
            style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
            {s.kbPathUseDefault(placeholder)}
          </button>
        )}
      </Field>
      {/* Template selection — conditional on directory state */}
      {pathInfo && pathInfo.exists && !pathInfo.empty && !showTemplatePickerAnyway ? (
        <div>
          <label className="text-sm text-foreground font-medium mb-3 block">{s.template}</label>
          <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--amber)', background: 'rgba(245,158,11,0.06)' }}>
            <p style={{ color: 'var(--amber)' }}>
              {s.kbPathHasFiles(pathInfo.count)}
            </p>
            <div className="flex gap-2 mt-2">
              <button type="button"
                onClick={() => update('template', '')}
                className="px-2.5 py-1 text-xs rounded-md border transition-colors"
                style={{
                  borderColor: 'var(--amber)',
                  color: state.template === '' ? 'var(--background)' : 'var(--amber)',
                  background: state.template === '' ? 'var(--amber)' : 'transparent',
                }}>
                {state.template === '' ? <>{s.kbTemplateSkip} ✓</> : s.kbTemplateSkip}
              </button>
              <button type="button"
                onClick={() => setShowTemplatePickerAnyway(true)}
                className="px-2.5 py-1 text-xs rounded-md border transition-colors hover:bg-muted/50"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                {s.kbTemplateMerge}
              </button>
            </div>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}

// ─── Step 2: AI Provider ──────────────────────────────────────────────────────
function Step2({
  state, update, s,
}: {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  s: ReturnType<typeof useLocale>['t']['setup'];
}) {
  const providers = [
    { id: 'anthropic' as const, icon: <Brain size={18} />, label: 'Anthropic', desc: 'Claude — claude-sonnet-4-6' },
    { id: 'openai' as const, icon: <Zap size={18} />, label: 'OpenAI', desc: 'GPT or any OpenAI-compatible API' },
    { id: 'skip' as const, icon: <SkipForward size={18} />, label: s.aiSkipTitle, desc: s.aiSkipDesc },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3">
        {providers.map(p => (
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
}

// ─── Step 3: Ports ────────────────────────────────────────────────────────────
function Step3({
  state, update, webPortStatus, mcpPortStatus, setWebPortStatus, setMcpPortStatus, checkPort, portConflict, s,
}: {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  webPortStatus: PortStatus;
  mcpPortStatus: PortStatus;
  setWebPortStatus: (s: PortStatus) => void;
  setMcpPortStatus: (s: PortStatus) => void;
  checkPort: (port: number, which: 'web' | 'mcp') => void;
  portConflict: boolean;
  s: ReturnType<typeof useLocale>['t']['setup'];
}) {
  return (
    <div className="space-y-5">
      <PortField
        label={s.webPort} hint={s.portHint} value={state.webPort}
        onChange={v => { update('webPort', v); setWebPortStatus({ checking: false, available: null, isSelf: false, suggestion: null }); }}
        status={webPortStatus}
        onCheckPort={port => checkPort(port, 'web')}
        s={s}
      />
      <PortField
        label={s.mcpPort} hint={s.portHint} value={state.mcpPort}
        onChange={v => { update('mcpPort', v); setMcpPortStatus({ checking: false, available: null, isSelf: false, suggestion: null }); }}
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
        <Info size={12} /> {s.portRestartWarning}
      </p>
    </div>
  );
}

// ─── Step 5: Agent Tools ──────────────────────────────────────────────────────
function Step5({
  agents, agentsLoading, selectedAgents, setSelectedAgents,
  agentTransport, setAgentTransport, agentScope, setAgentScope,
  agentStatuses, s, settingsMcp, template,
}: {
  agents: AgentEntry[];
  agentsLoading: boolean;
  selectedAgents: Set<string>;
  setSelectedAgents: React.Dispatch<React.SetStateAction<Set<string>>>;
  agentTransport: 'auto' | 'stdio' | 'http';
  setAgentTransport: (v: 'auto' | 'stdio' | 'http') => void;
  agentScope: 'global' | 'project';
  setAgentScope: (v: 'global' | 'project') => void;
  agentStatuses: Record<string, AgentInstallStatus>;
  s: ReturnType<typeof useLocale>['t']['setup'];
  settingsMcp: ReturnType<typeof useLocale>['t']['settings']['mcp'];
  template: Template;
}) {
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
          style={{ background: 'rgba(200,80,80,0.1)', color: 'var(--error)' }}>
          <XCircle size={10} /> {s.agentStatusError}
          {st.message && <span className="ml-1 text-[10px]">({st.message})</span>}
        </span>
      );
    }
    if (agent.installed) return (
      <span className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
        {settingsMcp.installed}
      </span>
    );
    if (agent.present) return (
      <span className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
        {s.agentDetected}
      </span>
    );
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(100,100,120,0.1)', color: 'var(--muted-foreground)' }}>
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
        className="accent-amber-500"
        disabled={agentStatuses[agent.key]?.state === 'installing'}
      />
      <span className="text-sm flex-1" style={{ color: 'var(--foreground)' }}>{agent.name}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
        style={{ background: 'rgba(100,100,120,0.08)', color: 'var(--muted-foreground)' }}>
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
          <div className="flex items-center gap-4 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }} />
              {s.badgeInstalled}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#f59e0b' }} />
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
              style={{ background: 'rgba(100,100,120,0.06)', color: 'var(--muted-foreground)' }}>
              <Brain size={13} className="shrink-0" />
              <span>{s.skillAutoHint(template === 'zh' ? 'mindos-zh' : 'mindos')}</span>
            </div>
          </div>
          {/* Advanced options — collapsed by default */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
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

// ─── Restart Block ────────────────────────────────────────────────────────────
function RestartBlock({ s, newPort }: { s: ReturnType<typeof useLocale>['t']['setup']; newPort: number }) {
  const [restarting, setRestarting] = useState(false);
  const [done, setDone] = useState(false);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await fetch('/api/restart', { method: 'POST' });
      setDone(true);
      const redirect = () => { window.location.href = `http://localhost:${newPort}/?welcome=1`; };
      // Poll the new port until ready, then redirect
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`http://localhost:${newPort}/api/health`);
          if (r.status < 500) { clearInterval(poll); redirect(); return; }
        } catch { /* not ready yet */ }
        if (attempts >= 10) { clearInterval(poll); redirect(); }
      }, 800);
    } catch {
      setRestarting(false);
    }
  };

  if (done) {
    return (
      <div className="p-3 rounded-lg text-sm flex items-center gap-2"
        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
        <CheckCircle2 size={14} /> {s.restartDone}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg text-sm flex items-center gap-2"
        style={{ background: 'rgba(200,135,30,0.1)', color: 'var(--amber)' }}>
        <AlertTriangle size={14} /> {s.restartRequired}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRestart}
          disabled={restarting}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
          style={{ background: 'var(--amber)', color: 'white' }}>
          {restarting ? <Loader2 size={13} className="animate-spin" /> : null}
          {restarting ? s.restarting : s.restartNow}
        </button>
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {s.restartManual} <code className="font-mono">mindos start</code>
        </span>
      </div>
    </div>
  );
}

// ─── Step 6: Review ───────────────────────────────────────────────────────────
function Step6({
  state, selectedAgents, agentStatuses, onRetryAgent, error, needsRestart, s,
  skillInstallResult, setupPhase,
}: {
  state: SetupState;
  selectedAgents: Set<string>;
  agentStatuses: Record<string, AgentInstallStatus>;
  onRetryAgent: (key: string) => void;
  error: string;
  needsRestart: boolean;
  s: ReturnType<typeof useLocale>['t']['setup'];
  skillInstallResult: { ok?: boolean; skill?: string; error?: string } | null;
  setupPhase: 'review' | 'saving' | 'agents' | 'skill' | 'done';
}) {
  const failedAgents = Object.entries(agentStatuses).filter(([, v]) => v.state === 'error');

  // Compact config summary (only key info)
  const summaryRows: [string, string][] = [
    [s.kbPath, state.mindRoot],
    [s.webPort, `${state.webPort} / ${state.mcpPort}`],
    [s.agentToolsTitle, selectedAgents.size > 0 ? s.agentCountSummary(selectedAgents.size) : '—'],
  ];

  // Progress stepper phases
  type Phase = typeof setupPhase;
  const phases: { key: Phase; label: string }[] = [
    { key: 'saving', label: s.phaseSaving },
    { key: 'agents', label: s.phaseAgents },
    { key: 'skill', label: s.phaseSkill },
    { key: 'done', label: s.phaseDone },
  ];
  const phaseOrder: Phase[] = ['saving', 'agents', 'skill', 'done'];
  const currentIdx = phaseOrder.indexOf(setupPhase);

  return (
    <div className="space-y-5">
      {/* Compact config summary */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {summaryRows.map(([label, value], i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm"
            style={{
              background: i % 2 === 0 ? 'var(--card)' : 'transparent',
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
            }}>
            <span style={{ color: 'var(--muted-foreground)' }}>{label}</span>
            <span className="font-mono text-xs truncate ml-4" style={{ color: 'var(--foreground)' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Before submit: review hint */}
      {setupPhase === 'review' && (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{s.reviewHint}</p>
      )}

      {/* Progress stepper — visible during/after setup */}
      {setupPhase !== 'review' && (
        <div className="space-y-2 py-2">
          {phases.map(({ key, label }, i) => {
            const idx = phaseOrder.indexOf(key);
            const isDone = currentIdx > idx || (key === 'done' && setupPhase === 'done');
            const isActive = setupPhase === key && key !== 'done';
            const isPending = currentIdx < idx;
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px]"
                  style={{
                    background: isDone ? 'rgba(34,197,94,0.15)' : isActive ? 'rgba(200,135,30,0.15)' : 'var(--muted)',
                    color: isDone ? '#22c55e' : isActive ? 'var(--amber)' : 'var(--muted-foreground)',
                  }}>
                  {isDone ? <CheckCircle2 size={12} /> : isActive ? <Loader2 size={12} className="animate-spin" /> : (i + 1)}
                </div>
                <span className="text-sm" style={{
                  color: isDone ? '#22c55e' : isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontWeight: isActive ? 500 : 400,
                  opacity: isPending ? 0.5 : 1,
                }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Agent failures — expandable */}
      {failedAgents.length > 0 && setupPhase === 'done' && (
        <div className="p-3 rounded-lg space-y-2" style={{ background: 'rgba(200,80,80,0.08)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--error)' }}>
            {s.agentFailedCount(failedAgents.length)}
          </p>
          {failedAgents.map(([key, st]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-xs flex items-center gap-1" style={{ color: 'var(--error)' }}>
                <XCircle size={11} /> {key}{st.message ? ` — ${st.message}` : ''}
              </span>
              <button
                type="button"
                onClick={() => onRetryAgent(key)}
                disabled={st.state === 'installing'}
                className="text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-40"
                style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
                {st.state === 'installing' ? <Loader2 size={10} className="animate-spin inline" /> : s.retryAgent}
              </button>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{s.agentFailureNote}</p>
        </div>
      )}

      {/* Skill result — compact */}
      {skillInstallResult && setupPhase === 'done' && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{
          background: skillInstallResult.ok ? 'rgba(34,197,94,0.06)' : 'rgba(200,80,80,0.06)',
        }}>
          {skillInstallResult.ok ? (
            <><CheckCircle2 size={11} className="text-green-500 shrink-0" />
            <span style={{ color: 'var(--foreground)' }}>{s.skillInstalled} — {skillInstallResult.skill}</span></>
          ) : (
            <><XCircle size={11} className="text-error shrink-0" />
            <span style={{ color: 'var(--error)' }}>{s.skillFailed}{skillInstallResult.error ? `: ${skillInstallResult.error}` : ''}</span></>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-sm text-error" style={{ background: 'rgba(200,80,80,0.1)' }}>
          {s.completeFailed}: {error}
        </div>
      )}
      {needsRestart && setupPhase === 'done' && <RestartBlock s={s} newPort={state.webPort} />}
    </div>
  );
}

// ─── Step dots ────────────────────────────────────────────────────────────────
function StepDots({ step, setStep, stepTitles, disabled }: {
  step: number;
  setStep: (s: number) => void;
  stepTitles: readonly string[];
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {stepTitles.map((title: string, i: number) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <div className="w-8 h-px" style={{ background: i <= step ? 'var(--amber)' : 'var(--border)' }} />}
          <button onClick={() => !disabled && i < step && setStep(i)} className="flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled || i > step}>
            <div
              className="w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center transition-colors"
              style={{
                background: i <= step ? 'var(--amber)' : 'var(--muted)',
                color: i <= step ? 'white' : 'var(--muted-foreground)',
                opacity: i <= step ? 1 : 0.5,
              }}>
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
}

// ─── Main component ───────────────────────────────────────────────────────────
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
            .catch(() => {});
        }
      })
      .catch(() => {
        // Fallback: generate token on failure
        fetch('/api/setup/generate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(r => r.json())
          .then(data => { if (data.token) setState(prev => ({ ...prev, authToken: data.token })); })
          .catch(() => {});
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
    if (step === STEP_AGENTS && agents.length === 0 && !agentsLoading) {
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
    setStatus({ checking: true, available: null, isSelf: false, suggestion: null });
    try {
      const res = await fetch('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      const data = await res.json();
      setStatus({ checking: false, available: data.available ?? null, isSelf: !!data.isSelf, suggestion: data.suggestion ?? null });
    } catch {
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
    setSetupPhase('saving');
    let restartNeeded = false;

    // 1. Save setup config
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
      restartNeeded = !!data.needsRestart;
      if (restartNeeded) setNeedsRestart(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSetupPhase('review');
      setSubmitting(false);
      return;
    }

    // 2. Install agents after config saved
    setSetupPhase('agents');
    if (selectedAgents.size > 0) {
      const initialStatuses: Record<string, AgentInstallStatus> = {};
      for (const key of selectedAgents) initialStatuses[key] = { state: 'installing' };
      setAgentStatuses(initialStatuses);

      try {
        const agentsPayload = Array.from(selectedAgents).map(key => {
          const agent = agents.find(a => a.key === key);
          const effectiveTransport = agentTransport === 'auto'
            ? (agent?.preferredTransport || 'stdio')
            : agentTransport;
          return { key, scope: agentScope, transport: effectiveTransport };
        });
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
          for (const r of data.results as Array<{ agent: string; status: string; message?: string; transport?: string; verified?: boolean; verifyError?: string }>) {
            updated[r.agent] = {
              state: r.status === 'ok' ? 'ok' : 'error',
              message: r.message,
              transport: r.transport,
              verified: r.verified,
              verifyError: r.verifyError,
            };
          }
          setAgentStatuses(updated);
        }
      } catch {
        const errStatuses: Record<string, AgentInstallStatus> = {};
        for (const key of selectedAgents) errStatuses[key] = { state: 'error' };
        setAgentStatuses(errStatuses);
      }
    }

    // 3. Install skill to agents
    setSetupPhase('skill');
    const skillName = state.template === 'zh' ? 'mindos-zh' : 'mindos';
    try {
      const skillRes = await fetch('/api/mcp/install-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: skillName, agents: Array.from(selectedAgents) }),
      });
      const skillData = await skillRes.json();
      setSkillInstallResult(skillData);
    } catch {
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
      const agent = agents.find(a => a.key === key);
      const effectiveTransport = agentTransport === 'auto'
        ? (agent?.preferredTransport || 'stdio')
        : agentTransport;
      const res = await fetch('/api/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: [{ key, scope: agentScope, transport: effectiveTransport }],
          transport: agentTransport,
          url: `http://localhost:${state.mcpPort}/mcp`,
          token: state.authToken || undefined,
        }),
      });
      const data = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0] as { agent: string; status: string; message?: string; transport?: string; verified?: boolean; verifyError?: string };
        setAgentStatuses(prev => ({
          ...prev,
          [key]: {
            state: r.status === 'ok' ? 'ok' : 'error',
            message: r.message,
            transport: r.transport,
            verified: r.verified,
            verifyError: r.verifyError,
          },
        }));
      }
    } catch {
      setAgentStatuses(prev => ({ ...prev, [key]: { state: 'error' } }));
    }
  }, [agents, agentScope, agentTransport, state.mcpPort, state.authToken]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
      style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-xl mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <Sparkles size={18} style={{ color: 'var(--amber)' }} />
            <h1 className="text-2xl font-semibold tracking-tight font-display" style={{ color: 'var(--foreground)' }}>
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

        {step === 0 && <Step1 state={state} update={update} t={t} homeDir={homeDir} />}
        {step === 1 && <Step2 state={state} update={update} s={s} />}
        {step === 2 && (
          <Step3
            state={state} update={update}
            webPortStatus={webPortStatus} mcpPortStatus={mcpPortStatus}
            setWebPortStatus={setWebPortStatus} setMcpPortStatus={setMcpPortStatus}
            checkPort={checkPort} portConflict={portConflict} s={s}
          />
        )}
        {step === 3 && (
          <Step4Inner
            authToken={state.authToken} tokenCopied={tokenCopied}
            onCopy={copyToken} onGenerate={generateToken}
            webPassword={state.webPassword} onPasswordChange={v => update('webPassword', v)}
            s={s}
          />
        )}
        {step === 4 && (
          <Step5
            agents={agents} agentsLoading={agentsLoading}
            selectedAgents={selectedAgents} setSelectedAgents={setSelectedAgents}
            agentTransport={agentTransport} setAgentTransport={setAgentTransport}
            agentScope={agentScope} setAgentScope={setAgentScope}
            agentStatuses={agentStatuses} s={s} settingsMcp={t.settings.mcp}
            template={state.template}
          />
        )}
        {step === 5 && (
          <Step6
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
              style={{ background: 'var(--amber)', color: 'white' }}>
              {s.next} <ChevronRight size={14} />
            </button>
          ) : completed ? (
            // After completing: show Done link (no restart needed) or nothing (RestartBlock handles it)
            !needsRestart ? (
              <a href="/?welcome=1"
                className="flex items-center gap-1 px-5 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ background: 'var(--amber)', color: 'white' }}>
                {s.completeDone} &rarr;
              </a>
            ) : null
          ) : (
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="flex items-center gap-1 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--amber)', color: 'white' }}>
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? s.completing : s.complete}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
