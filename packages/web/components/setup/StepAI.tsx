'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { Field, Input, PasswordInput } from '@/components/settings/Primitives';
import type { SetupState, SetupProvider, SetupMessages, PortStatus } from './types';
import type { ProviderId } from '@/lib/agent/providers';
import { PROVIDER_PRESETS, isProviderId, getApiKeyEnvVar, getDefaultBaseUrl } from '@/lib/agent/providers';
import { generateProviderId } from '@/lib/custom-endpoints';
import ProviderSelect from '@/components/shared/ProviderSelect';
import ModelInput from '@/components/shared/ModelInput';
import StepPorts from './StepPorts';
import { useLocale } from '@/lib/stores/locale-store';

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

  // Only auto-open Advanced if there's an unresolved port issue the user needs to see
  useEffect(() => {
    if (!portsOpen && portConflict) {
      setPortsOpen(true);
    }
  }, [portConflict, portsOpen]);

  // ── Current provider from unified Provider[] ──
  const isSkip = state.activeProvider === 'skip';
  const current = !isSkip ? state.providers.find(p => p.id === state.activeProvider) : null;
  const currentPreset = current ? PROVIDER_PRESETS[current.protocol] : null;

  // ── Patch a field on the current provider ──
  const patchProvider = useCallback((patch: Partial<SetupProvider>) => {
    if (!current) return;
    update('providers', state.providers.map(p =>
      p.id === current.id ? { ...p, ...patch } : p
    ));
  }, [current, state.providers, update]);

  // ── Handle provider selection from ProviderSelect ──
  // When user picks a protocol (e.g. "anthropic"), we find-or-create a Provider for it.
  const handleSelectProvider = useCallback((selectedId: string) => {
    if (selectedId === 'skip') {
      update('activeProvider', 'skip');
      return;
    }

    // Check if the selected value is an existing provider ID (p_xxx)
    const existing = state.providers.find(p => p.id === selectedId);
    if (existing) {
      update('activeProvider', existing.id);
      return;
    }

    // It's a protocol ID (e.g., "anthropic") — find existing provider with that protocol,
    // or create a new one
    if (isProviderId(selectedId)) {
      const byProtocol = state.providers.find(p => p.protocol === selectedId);
      if (byProtocol) {
        update('activeProvider', byProtocol.id);
        return;
      }

      // Create new provider for this protocol
      const preset = PROVIDER_PRESETS[selectedId];
      const newProvider: SetupProvider = {
        id: generateProviderId(),
        name: locale === 'zh' ? preset.nameZh : preset.name,
        protocol: selectedId,
        apiKey: '',
        model: preset.defaultModel,
        baseUrl: preset.fixedBaseUrl ?? '',
      };

      // Add to providers array and set as active
      const newProviders = [...state.providers, newProvider];
      update('providers', newProviders);
      update('activeProvider', newProvider.id);
    }
  }, [state.providers, update, locale]);

  // ── Build configuredProviders set for the ProviderSelect UI ──
  // Shows green checkmark for providers that have been configured (have apiKey or apiKeyMask or fallback)
  const configuredProviders = new Set(
    state.providers
      .filter(p => p.apiKey || p.apiKeyMask || PROVIDER_PRESETS[p.protocol]?.apiKeyFallback)
      .map(p => p.protocol),
  );

  // ── Map activeProvider ID to protocol ID for ProviderSelect value ──
  // ProviderSelect expects a ProviderId string or 'skip'
  const selectValue = isSkip ? 'skip' : (current?.protocol ?? 'skip');

  return (
    <div className="space-y-5">
      <ProviderSelect
        value={selectValue}
        onChange={handleSelectProvider}
        showSkip
        compact
        configuredProviders={configuredProviders}
      />

      {current && currentPreset && (
        <div className="space-y-4 pt-2">
          {/* API Key */}
          <Field label={s.apiKey}>
            <PasswordInput
              value={current.apiKey}
              onChange={v => patchProvider({ apiKey: v })}
              placeholder={current.apiKeyMask || `${getApiKeyEnvVar(current.protocol) ?? 'API Key'}...`}
            />
            {current.apiKeyMask && !current.apiKey && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                {s.apiKeyExisting ?? 'Existing key configured. Leave blank to keep it.'}
              </p>
            )}
            {currentPreset.signupUrl && !current.apiKey && !current.apiKeyMask && (
              <a
                href={currentPreset.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs mt-1.5 hover:underline"
                style={{ color: 'var(--amber)' }}
              >
                <ExternalLink size={10} />
                {currentPreset.apiKeyFallback
                  ? (locale === 'zh' ? `下载 ${currentPreset.nameZh}` : `Download ${currentPreset.name}`)
                  : (locale === 'zh' ? `获取 ${currentPreset.nameZh} API Key` : `Get ${currentPreset.name} API Key`)}
              </a>
            )}
          </Field>

          {/* Base URL — before Model so defaults are correct when listing models */}
          {currentPreset.supportsBaseUrl && (
            <Field label={s.baseUrl} hint={s.baseUrlHint}>
              <Input
                value={current.baseUrl ?? ''}
                onChange={e => patchProvider({ baseUrl: e.target.value })}
                placeholder={currentPreset.fixedBaseUrl || getDefaultBaseUrl(current.protocol) || 'https://api.openai.com/v1'}
              />
            </Field>
          )}

          {/* Model */}
          <Field label={s.model}>
            <ModelInput
              value={current.model}
              onChange={v => patchProvider({ model: v })}
              placeholder={currentPreset.defaultModel}
              provider={current.protocol}
              apiKey={current.apiKey}
              baseUrl={current.baseUrl}
              supportsListModels={currentPreset.supportsListModels}
              browseLabel={s.listModels}
              noModelsLabel={s.noModelsFound}
            />
          </Field>
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
                {s.tokenSectionTitle}
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
