'use client';

import type React from 'react';
import { Select, Input, PasswordInput, Field } from './Primitives';
import { PROVIDER_PRESETS, ALL_PROVIDER_IDS, type ProviderId } from '@/lib/agent/providers';
import ModelInput from '@/components/shared/ModelInput';
import type { CustomProviderFormState } from './useCustomProviderForm';
import type { AiTabProps } from './types';

interface CustomProviderFieldsProps {
  form: CustomProviderFormState;
  t: AiTabProps['t'];
  locale: string;
}

function ProviderField({
  label, hint, hintError, children, className = '',
}: {
  label: React.ReactNode;
  hint?: string;
  hintError?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Field label={label} hint={hint} hintError={hintError}>{children}</Field>
    </div>
  );
}

/**
 * Shared form fields for provider editing.
 * Renders: Name, Protocol, Base URL, API Key, Model.
 */
export default function CustomProviderFields({
  form, t, locale,
}: CustomProviderFieldsProps) {
  const basePreset = PROVIDER_PRESETS[form.protocol];

  const nameLabel = locale === 'zh' ? '名称' : 'Name';
  const protocolLabel = locale === 'zh' ? '协议' : 'Protocol';
  const namePlaceholder = locale === 'zh' ? '可选，默认使用协议名称' : 'Optional, defaults to protocol name';

  const nameHint = form.isDuplicateName
    ? (locale === 'zh' ? '名称已存在' : 'Name already exists')
    : undefined;
  const showBaseUrl = basePreset.supportsBaseUrl || !!form.baseUrl.trim();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ProviderField label={nameLabel} hint={nameHint} hintError={form.isDuplicateName}>
          <Input
            value={form.name}
            onChange={e => form.setName(e.target.value)}
            placeholder={namePlaceholder}
            autoFocus
            className="h-9"
          />
        </ProviderField>
        <ProviderField label={protocolLabel}>
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
        </ProviderField>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${showBaseUrl ? 'xl:grid-cols-2' : ''}`}>
        {/* Base URL */}
        {showBaseUrl && (
          <ProviderField label="Base URL">
            <Input
              value={form.baseUrl}
              onChange={e => form.setBaseUrl(e.target.value)}
              placeholder={basePreset.fixedBaseUrl || 'https://api.example.com/v1'}
              className="h-9"
            />
          </ProviderField>
        )}

        {/* API Key */}
        <ProviderField
          label={<>API Key <span className="font-normal text-muted-foreground/55">{locale === 'zh' ? '(可选)' : '(optional)'}</span></>}
        >
          <PasswordInput
            value={form.apiKey}
            onChange={form.setApiKey}
            placeholder="sk-..."
            className="min-h-9"
          />
        </ProviderField>
      </div>

      {/* Model */}
      <ProviderField label={locale === 'zh' ? '模型' : 'Model'}>
        <ModelInput
          value={form.model}
          onChange={form.setModel}
          placeholder={basePreset.defaultModel}
          provider={form.protocol}
          apiKey={form.apiKey}
          baseUrl={form.baseUrl}
          supportsListModels={!!form.baseUrl.trim() || !!basePreset.supportsListModels}
          allowNoKey
          browseLabel={t.settings.ai.listModels}
          noModelsLabel={t.settings.ai.noModelsFound}
        />
      </ProviderField>
    </div>
  );
}
