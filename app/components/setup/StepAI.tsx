'use client';

import { Brain, Zap, SkipForward, CheckCircle2 } from 'lucide-react';
import { Field, Input, ApiKeyInput } from '@/components/settings/Primitives';
import type { SetupState, SetupMessages } from './types';

export interface StepAIProps {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  s: SetupMessages;
}

export default function StepAI({ state, update, s }: StepAIProps) {
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
              background: state.provider === p.id ? 'var(--amber-dim)' : 'var(--card)',
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
