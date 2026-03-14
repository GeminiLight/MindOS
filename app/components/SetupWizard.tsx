'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Globe, BookOpen, FileText, Copy, Check, RefreshCw, Loader2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
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

const TEMPLATES: Array<{
  id: Template;
  icon: React.ReactNode;
  dirs: string[];
}> = [
  { id: 'en', icon: <Globe size={18} />, dirs: ['Profile/', 'Connections/', 'Notes/', 'Workflows/', 'Resources/', 'Projects/'] },
  { id: 'zh', icon: <BookOpen size={18} />, dirs: ['画像/', '关系/', '笔记/', '流程/', '资源/', '项目/'] },
  { id: 'empty', icon: <FileText size={18} />, dirs: ['README.md', 'CONFIG.json', 'INSTRUCTION.md'] },
];

const TOTAL_STEPS = 5;

export default function SetupWizard() {
  const { t } = useLocale();
  const router = useRouter();
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

  // Generate token on mount
  useEffect(() => {
    fetch('/api/setup/generate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(data => { if (data.token) setState(prev => ({ ...prev, authToken: data.token })); })
      .catch(() => {});
  }, []);

  const update = useCallback(<K extends keyof SetupState>(key: K, val: SetupState[K]) => {
    setState(prev => ({ ...prev, [key]: val }));
  }, []);

  const generateToken = async (seed?: string) => {
    try {
      const res = await fetch('/api/setup/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: seed || undefined }),
      });
      const data = await res.json();
      if (data.token) update('authToken', data.token);
    } catch { /* ignore */ }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(state.authToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const handleComplete = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        mindRoot: state.mindRoot.startsWith('~')
          ? state.mindRoot  // server will resolve
          : state.mindRoot,
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
      else router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const canNext = () => {
    if (step === 0) return state.mindRoot.trim().length > 0;
    if (step === 2) return state.webPort >= 1024 && state.webPort <= 65535 && state.mcpPort >= 1024 && state.mcpPort <= 65535;
    return true;
  };

  const maskKey = (key: string) => {
    if (!key) return '(not set)';
    if (key.length <= 8) return '•••';
    return key.slice(0, 6) + '•••' + key.slice(-3);
  };

  // Step indicator dots
  const StepDots = () => (
    <div className="flex items-center gap-2 mb-8">
      {s.stepTitles.map((title: string, i: number) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <div className="w-8 h-px" style={{ background: i <= step ? 'var(--amber)' : 'var(--border)' }} />}
          <button
            onClick={() => i < step && setStep(i)}
            className="flex items-center gap-1.5"
            disabled={i > step}
          >
            <div
              className="w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center transition-colors"
              style={{
                background: i === step ? 'var(--amber)' : i < step ? 'var(--amber)' : 'var(--muted)',
                color: i <= step ? 'white' : 'var(--muted-foreground)',
                opacity: i <= step ? 1 : 0.5,
              }}
            >
              {i + 1}
            </div>
            <span
              className="text-xs hidden sm:inline"
              style={{ color: i === step ? 'var(--foreground)' : 'var(--muted-foreground)', opacity: i <= step ? 1 : 0.5 }}
            >
              {title}
            </span>
          </button>
        </div>
      ))}
    </div>
  );

  // Step 1: Knowledge Base
  const Step1 = () => (
    <div className="space-y-6">
      <Field label={s.kbPath} hint={s.kbPathHint}>
        <Input
          value={state.mindRoot}
          onChange={e => update('mindRoot', e.target.value)}
          placeholder={s.kbPathDefault}
        />
      </Field>
      <div>
        <label className="text-sm text-foreground font-medium mb-3 block">{s.template}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => update('template', tpl.id)}
              className="flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all duration-150"
              style={{
                background: state.template === tpl.id ? 'var(--amber-subtle, rgba(200,135,30,0.08))' : 'var(--card)',
                borderColor: state.template === tpl.id ? 'var(--amber)' : 'var(--border)',
              }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--amber)' }}>{tpl.icon}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.onboarding.templates[tpl.id as 'en' | 'zh' | 'empty'].title}
                </span>
              </div>
              <div
                className="w-full rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed font-display"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
              >
                {tpl.dirs.map(d => <div key={d}>{d}</div>)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // Step 2: AI Provider
  const Step2 = () => (
    <div className="space-y-5">
      <Field label={s.aiProvider} hint={s.aiProviderHint}>
        <Select value={state.provider} onChange={e => update('provider', e.target.value as SetupState['provider'])}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="skip">{s.aiSkip}</option>
        </Select>
      </Field>
      {state.provider !== 'skip' && (
        <>
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
              <Input
                value={state.openaiBaseUrl}
                onChange={e => update('openaiBaseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </Field>
          )}
        </>
      )}
    </div>
  );

  // Step 3: Ports
  const Step3 = () => (
    <div className="space-y-5">
      <Field label={s.webPort} hint={s.portHint}>
        <Input
          type="number"
          min={1024}
          max={65535}
          value={state.webPort}
          onChange={e => update('webPort', parseInt(e.target.value, 10) || 3000)}
        />
      </Field>
      <Field label={s.mcpPort} hint={s.portHint}>
        <Input
          type="number"
          min={1024}
          max={65535}
          value={state.mcpPort}
          onChange={e => update('mcpPort', parseInt(e.target.value, 10) || 8787)}
        />
      </Field>
      <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
        <AlertTriangle size={12} />
        {s.portRestartWarning}
      </p>
    </div>
  );

  // Step 4: Security
  const Step4 = () => {
    const [seed, setSeed] = useState('');
    const [showSeed, setShowSeed] = useState(false);

    return (
      <div className="space-y-5">
        <Field label={s.authToken} hint={s.authTokenHint}>
          <div className="flex gap-2">
            <Input value={state.authToken} readOnly className="font-mono text-xs" />
            <button
              onClick={copyToken}
              className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
              style={{ color: 'var(--foreground)' }}
            >
              {tokenCopied ? <Check size={14} /> : <Copy size={14} />}
              {tokenCopied ? s.copiedToken : s.copyToken}
            </button>
            <button
              onClick={() => generateToken()}
              className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
              style={{ color: 'var(--foreground)' }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </Field>

        <div>
          <button
            onClick={() => setShowSeed(!showSeed)}
            className="text-xs underline"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {s.authTokenSeed}
          </button>
          {showSeed && (
            <div className="mt-2 flex gap-2">
              <Input
                value={seed}
                onChange={e => setSeed(e.target.value)}
                placeholder={s.authTokenSeedHint}
              />
              <button
                onClick={() => { if (seed.trim()) generateToken(seed); }}
                className="px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
                style={{ color: 'var(--foreground)' }}
              >
                {s.generateToken}
              </button>
            </div>
          )}
        </div>

        <Field label={s.webPassword} hint={s.webPasswordHint}>
          <Input
            type="password"
            value={state.webPassword}
            onChange={e => update('webPassword', e.target.value)}
            placeholder="(optional)"
          />
        </Field>
      </div>
    );
  };

  // Step 5: Review
  const Step5 = () => {
    const rows: [string, string][] = [
      [s.kbPath, state.mindRoot],
      [s.template, state.template || '—'],
      [s.aiProvider, state.provider],
      ...(state.provider !== 'skip' ? [
        [s.apiKey, maskKey(state.provider === 'anthropic' ? state.anthropicKey : state.openaiKey)] as [string, string],
        [s.model, state.provider === 'anthropic' ? state.anthropicModel : state.openaiModel] as [string, string],
      ] : []),
      [s.webPort, String(state.webPort)],
      [s.mcpPort, String(state.mcpPort)],
      [s.authToken, state.authToken || '—'],
      [s.webPassword, state.webPassword ? '••••••••' : '(none)'],
    ];

    return (
      <div className="space-y-5">
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{s.reviewHint}</p>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {rows.map(([label, value], i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-3 text-sm"
              style={{
                background: i % 2 === 0 ? 'var(--card)' : 'transparent',
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
              }}
            >
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
            <div className="p-3 rounded-lg text-sm flex items-center gap-2" style={{ background: 'rgba(200,135,30,0.1)', color: 'var(--amber)' }}>
              <AlertTriangle size={14} />
              {s.portChanged}
            </div>
            <a
              href="/"
              className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--amber)', color: 'white' }}
            >
              {s.completeDone} &rarr;
            </a>
          </div>
        )}
      </div>
    );
  };

  const steps = [Step1, Step2, Step3, Step4, Step5];
  const CurrentStep = steps[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <Sparkles size={18} style={{ color: 'var(--amber)' }} />
            <h1
              className="text-2xl font-semibold tracking-tight font-display"
              style={{ color: 'var(--foreground)' }}
            >
              MindOS
            </h1>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex justify-center">
          <StepDots />
        </div>

        {/* Step title */}
        <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--foreground)' }}>
          {s.stepTitles[step]}
        </h2>

        {/* Step content */}
        <CurrentStep />

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: 'var(--foreground)' }}
          >
            <ChevronLeft size={14} />
            {s.back}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--amber)', color: 'white' }}
            >
              {s.next}
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={submitting || portChanged}
              className="flex items-center gap-1 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--amber)', color: 'white' }}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? s.completing : portChanged ? s.completeDone : s.complete}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
