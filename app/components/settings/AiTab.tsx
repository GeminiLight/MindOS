'use client';

import { AlertCircle } from 'lucide-react';
import type { AiSettings, ProviderConfig, SettingsData } from './types';
import { Field, Select, Input, EnvBadge, ApiKeyInput } from './Primitives';

interface AiTabProps {
  data: SettingsData;
  updateAi: (patch: Partial<AiSettings>) => void;
  t: any;
}

export function AiTab({ data, updateAi, t }: AiTabProps) {
  const env = data.envOverrides ?? {};
  const envVal = data.envValues ?? {};
  const provider = data.ai.provider;

  function patchProvider(name: 'anthropic' | 'openai', patch: Partial<ProviderConfig>) {
    updateAi({
      providers: {
        ...data.ai.providers,
        [name]: { ...data.ai.providers?.[name], ...patch },
      },
    });
  }

  const anthropic = data.ai.providers?.anthropic ?? { apiKey: '', model: '' };
  const openai    = data.ai.providers?.openai    ?? { apiKey: '', model: '', baseUrl: '' };

  const activeApiKey = provider === 'anthropic' ? anthropic.apiKey : openai.apiKey;
  const activeEnvKey = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  const missingApiKey = !activeApiKey && !activeEnvKey;

  return (
    <div className="space-y-5">
      <Field label={<>{t.settings.ai.provider} <EnvBadge overridden={env.AI_PROVIDER} /></>}>
        <Select
          value={provider}
          onChange={e => updateAi({ provider: e.target.value as 'anthropic' | 'openai' })}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI / compatible</option>
        </Select>
      </Field>

      {provider === 'anthropic' ? (
        <>
          <Field label={<>{t.settings.ai.model} <EnvBadge overridden={env.ANTHROPIC_MODEL} /></>}>
            <Input
              value={anthropic.model}
              onChange={e => patchProvider('anthropic', { model: e.target.value })}
              placeholder={envVal.ANTHROPIC_MODEL || 'claude-sonnet-4-6'}
            />
          </Field>
          <Field
            label={<>{t.settings.ai.apiKey} <EnvBadge overridden={env.ANTHROPIC_API_KEY} /></>}
            hint={env.ANTHROPIC_API_KEY ? t.settings.ai.envFieldNote('ANTHROPIC_API_KEY') : t.settings.ai.keyHint}
          >
            <ApiKeyInput
              value={anthropic.apiKey}
              onChange={v => patchProvider('anthropic', { apiKey: v })}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={<>{t.settings.ai.model} <EnvBadge overridden={env.OPENAI_MODEL} /></>}>
            <Input
              value={openai.model}
              onChange={e => patchProvider('openai', { model: e.target.value })}
              placeholder={envVal.OPENAI_MODEL || 'gpt-5.4'}
            />
          </Field>
          <Field
            label={<>{t.settings.ai.apiKey} <EnvBadge overridden={env.OPENAI_API_KEY} /></>}
            hint={env.OPENAI_API_KEY ? t.settings.ai.envFieldNote('OPENAI_API_KEY') : t.settings.ai.keyHint}
          >
            <ApiKeyInput
              value={openai.apiKey}
              onChange={v => patchProvider('openai', { apiKey: v })}
            />
          </Field>
          <Field
            label={<>{t.settings.ai.baseUrl} <EnvBadge overridden={env.OPENAI_BASE_URL} /></>}
            hint={t.settings.ai.baseUrlHint}
          >
            <Input
              value={openai.baseUrl ?? ''}
              onChange={e => patchProvider('openai', { baseUrl: e.target.value })}
              placeholder={envVal.OPENAI_BASE_URL || 'https://api.openai.com/v1'}
            />
          </Field>
        </>
      )}

      {missingApiKey && (
        <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2.5">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{t.settings.ai.noApiKey}</span>
        </div>
      )}

      {Object.values(env).some(Boolean) && (
        <div className="flex items-start gap-2 text-xs text-amber-500/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{t.settings.ai.envHint}</span>
        </div>
      )}
    </div>
  );
}
