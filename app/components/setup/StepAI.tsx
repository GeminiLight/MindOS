'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { Field, Input, ApiKeyInput } from '@/components/settings/Primitives';
import type { SetupState, SetupMessages, PortStatus, ProviderSetupConfig } from './types';
import type { ProviderId } from '@/lib/agent/providers';
import { PROVIDER_PRESETS, isProviderId } from '@/lib/agent/providers';
import ProviderSelect from '@/components/shared/ProviderSelect';
import StepPorts from './StepPorts';
import { useLocale } from '@/lib/LocaleContext';

export interface StepAIProps {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  s: SetupMessages;
  onCopyToken: () => void;
  webPortStatus: PortStatus;
  mcpPortStatus: PortStatus;
  setWebPortStatus: (s: PortStatus) => void;
  setMcpPortStatus: (s: PortStatus) => void;
  checkPort: (port: number, which: 'web' | 'mcp') => void;
  portConflict: boolean;
}

export default function StepAI({ state, update, s, onCopyToken, webPortStatus, mcpPortStatus, setWebPortStatus, setMcpPortStatus, checkPort, portConflict }: StepAIProps) {
  const { locale } = useLocale();
  const [portsOpen, setPortsOpen] = useState(false);

  useEffect(() => {
    if (!portsOpen && (webPortStatus.available === false || mcpPortStatus.available === false || portConflict)) {
      setPortsOpen(true);
    }
  }, [webPortStatus.available, mcpPortStatus.available, portConflict, portsOpen]);

  const currentProvider = state.provider !== 'skip' && isProviderId(state.provider) ? state.provider : null;
  const currentPreset = currentProvider ? PROVIDER_PRESETS[currentProvider] : null;
  const currentConfig = currentProvider ? (state.providerConfigs[currentProvider] ?? { apiKey: '', model: currentPreset?.defaultModel ?? '' }) : null;

  const patchConfig = (patch: Partial<ProviderSetupConfig>) => {
    if (!currentProvider) return;
    const prev = state.providerConfigs[currentProvider] ?? { apiKey: '', model: currentPreset?.defaultModel ?? '' };
    update('providerConfigs', {
      ...state.providerConfigs,
      [currentProvider]: { ...prev, ...patch },
    });
  };

  const configuredProviders = new Set(
    Object.entries(state.providerConfigs)
      .filter(([, cfg]) => cfg && (cfg.apiKey || cfg.apiKeyMask))
      .map(([id]) => id as ProviderId),
  );

  return (
    <div className="space-y-5">
      <ProviderSelect
        value={state.provider}
        onChange={id => update('provider', id)}
        showSkip
        configuredProviders={configuredProviders}
      />

      {currentProvider && currentPreset && currentConfig && (
        <div className="space-y-4 pt-2">
          {/* API Key */}
          <Field label={s.apiKey}>
            <ApiKeyInput
              value={currentConfig.apiKey}
              onChange={v => patchConfig({ apiKey: v })}
              placeholder={currentConfig.apiKeyMask || `${currentPreset.apiKeyEnvVar ?? 'API Key'}...`}
            />
            {currentConfig.apiKeyMask && !currentConfig.apiKey && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                {s.apiKeyExisting ?? 'Existing key configured. Leave blank to keep it.'}
              </p>
            )}
            {currentPreset.signupUrl && !currentConfig.apiKey && !currentConfig.apiKeyMask && (
              <a
                href={currentPreset.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs mt-1.5 hover:underline"
                style={{ color: 'var(--amber)' }}
              >
                <ExternalLink size={10} />
                {locale === 'zh' ? `获取 ${currentPreset.nameZh} API Key` : `Get ${currentPreset.name} API Key`}
              </a>
            )}
          </Field>

          {/* Model */}
          <Field label={s.model}>
            <Input
              value={currentConfig.model}
              onChange={e => patchConfig({ model: e.target.value })}
              placeholder={currentPreset.defaultModel}
            />
          </Field>

          {/* Base URL — only for providers that support it */}
          {currentPreset.supportsBaseUrl && (
            <Field label={s.baseUrl} hint={s.baseUrlHint}>
              <Input
                value={currentConfig.baseUrl ?? ''}
                onChange={e => patchConfig({ baseUrl: e.target.value })}
                placeholder={currentPreset.defaultBaseUrl || 'https://api.openai.com/v1'}
              />
            </Field>
          )}
        </div>
      )}

      {/* Advanced: Port Settings */}
      <div className="pt-3 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          onClick={() => setPortsOpen(!portsOpen)}
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--muted-foreground)' }}>
          {portsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {s.advancedPorts}
        </button>
        {portsOpen && (
          <div className="mt-3 space-y-5">
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                🔑 {s.tokenSectionTitle}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs font-mono px-3 py-2 rounded-lg"
                  style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                  {state.authToken}
                </code>
                <button type="button" onClick={onCopyToken}
                  className="flex items-center gap-1 px-2.5 py-2 text-xs rounded-lg border transition-colors hover:bg-muted shrink-0"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                  <Copy size={12} /> {s.copyToken}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {s.tokenSectionHint}
              </p>
            </div>

            <StepPorts
              state={state} update={update}
              webPortStatus={webPortStatus} mcpPortStatus={mcpPortStatus}
              setWebPortStatus={setWebPortStatus} setMcpPortStatus={setMcpPortStatus}
              checkPort={checkPort} portConflict={portConflict} s={s}
            />
          </div>
        )}
      </div>
    </div>
  );
}
