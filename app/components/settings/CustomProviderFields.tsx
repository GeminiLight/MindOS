'use client';

import { Field, Select, Input, PasswordInput } from './Primitives';
import { PROVIDER_PRESETS, ALL_PROVIDER_IDS, type ProviderId } from '@/lib/agent/providers';
import ModelInput from '@/components/shared/ModelInput';
import type { CustomProviderFormState } from './useCustomProviderForm';
import type { AiTabProps } from './types';

interface CustomProviderFieldsProps {
  form: CustomProviderFormState;
  t: AiTabProps['t'];
  locale: string;
  /** "compact" = inline in AiTab (name+protocol side by side), "full" = modal layout */
  layout?: 'compact' | 'full';
}

/**
 * Shared form fields for custom provider editing.
 * Renders: Name, Protocol, Base URL, API Key, Model.
 * Used by both the inline form (AiTab) and the modal (ProviderModal).
 */
export default function CustomProviderFields({
  form, t, locale, layout = 'full',
}: CustomProviderFieldsProps) {
  const basePreset = PROVIDER_PRESETS[form.baseProviderId];

  return (
    <div className="space-y-3">
      {/* Name + Protocol */}
      {layout === 'compact' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.settings?.customProviders?.modal?.fieldName ?? 'Name'}>
            <Input
              value={form.name}
              onChange={e => form.setName(e.target.value)}
              placeholder={locale === 'zh' ? '公司 GPT-4' : 'Company GPT-4'}
              autoFocus
            />
          </Field>
          <Field label={t.settings?.customProviders?.modal?.fieldProtocol ?? 'Protocol'}>
            <Select
              value={form.baseProviderId}
              onChange={e => form.setBaseProviderId(e.target.value as ProviderId)}
            >
              {ALL_PROVIDER_IDS.map(id => (
                <option key={id} value={id}>
                  {locale === 'zh' ? PROVIDER_PRESETS[id].nameZh : PROVIDER_PRESETS[id].name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <>
          <Field
            label={t.settings?.customProviders?.modal?.fieldName ?? 'Name'}
            hint={t.settings?.customProviders?.modal?.fieldNameHint}
          >
            <Input
              value={form.name}
              onChange={e => form.setName(e.target.value)}
              placeholder={locale === 'zh' ? '公司 GPT-4' : 'Company GPT-4'}
            />
          </Field>
          <Field label={t.settings?.customProviders?.modal?.fieldProtocol ?? 'Protocol'}>
            <Select
              value={form.baseProviderId}
              onChange={e => form.setBaseProviderId(e.target.value as ProviderId)}
            >
              {ALL_PROVIDER_IDS.map(id => (
                <option key={id} value={id}>
                  {locale === 'zh' ? PROVIDER_PRESETS[id].nameZh : PROVIDER_PRESETS[id].name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      {/* Base URL */}
      <Field
        label={t.settings?.customProviders?.modal?.fieldBaseUrl ?? 'Base URL'}
        hint={t.settings?.customProviders?.modal?.fieldBaseUrlHint}
      >
        <Input
          value={form.baseUrl}
          onChange={e => form.setBaseUrl(e.target.value)}
          placeholder={basePreset.fixedBaseUrl || 'https://api.example.com/v1'}
        />
      </Field>

      {/* API Key */}
      <Field
        label={<>{t.settings?.customProviders?.modal?.fieldApiKey ?? 'API Key'} <span className="text-muted-foreground/50 font-normal">{locale === 'zh' ? '(可选)' : '(optional)'}</span></>}
        hint={t.settings?.customProviders?.modal?.fieldApiKeyHint}
      >
        <PasswordInput
          value={form.apiKey}
          onChange={form.setApiKey}
          placeholder="sk-..."
        />
      </Field>

      {/* Model */}
      <Field
        label={t.settings?.customProviders?.modal?.fieldModel ?? 'Model'}
        hint={t.settings?.customProviders?.modal?.fieldModelHint}
      >
        <ModelInput
          value={form.model}
          onChange={form.setModel}
          placeholder={basePreset.defaultModel}
          provider={form.baseProviderId}
          apiKey={form.apiKey}
          baseUrl={form.baseUrl}
          supportsListModels={!!form.baseUrl.trim()}
          allowNoKey
          browseLabel={t.settings.ai.listModels}
          noModelsLabel={t.settings.ai.noModelsFound}
        />
      </Field>
    </div>
  );
}
