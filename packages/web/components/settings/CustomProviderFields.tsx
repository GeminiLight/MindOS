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
 * Shared form fields for provider editing.
 * Renders: Name, Protocol, Base URL, API Key, Model.
 */
export default function CustomProviderFields({
  form, t, locale, layout = 'full',
}: CustomProviderFieldsProps) {
  const basePreset = PROVIDER_PRESETS[form.protocol];

  const nameLabel = locale === 'zh' ? '名称' : 'Name';
  const protocolLabel = locale === 'zh' ? '协议' : 'Protocol';
  const namePlaceholder = locale === 'zh' ? '可选，默认使用协议名称' : 'Optional, defaults to protocol name';

  const nameHint = form.isDuplicateName
    ? (locale === 'zh' ? '名称已存在' : 'Name already exists')
    : undefined;

  return (
    <div className="space-y-3">
      {/* Name + Protocol */}
      {layout === 'compact' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={nameLabel} hint={nameHint} hintError={form.isDuplicateName}>
            <Input
              value={form.name}
              onChange={e => form.setName(e.target.value)}
              placeholder={namePlaceholder}
              autoFocus
            />
          </Field>
          <Field label={protocolLabel}>
            <Select
              value={form.protocol}
              onChange={e => form.setProtocol(e.target.value as ProviderId)}
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
          <Field label={nameLabel} hint={nameHint} hintError={form.isDuplicateName}>
            <Input
              value={form.name}
              onChange={e => form.setName(e.target.value)}
              placeholder={namePlaceholder}
            />
          </Field>
          <Field label={protocolLabel}>
            <Select
              value={form.protocol}
              onChange={e => form.setProtocol(e.target.value as ProviderId)}
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
      <Field label="Base URL">
        <Input
          value={form.baseUrl}
          onChange={e => form.setBaseUrl(e.target.value)}
          placeholder={basePreset.fixedBaseUrl || 'https://api.example.com/v1'}
        />
      </Field>

      {/* API Key */}
      <Field
        label={<>API Key <span className="text-muted-foreground/50 font-normal">{locale === 'zh' ? '(可选)' : '(optional)'}</span></>}
      >
        <PasswordInput
          value={form.apiKey}
          onChange={form.setApiKey}
          placeholder="sk-..."
        />
      </Field>

      {/* Model */}
      <Field label={locale === 'zh' ? '模型' : 'Model'}>
        <ModelInput
          value={form.model}
          onChange={form.setModel}
          placeholder={basePreset.defaultModel}
          provider={form.protocol}
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
