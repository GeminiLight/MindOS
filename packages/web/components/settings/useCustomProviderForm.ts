'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { type ProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';
import { type Provider, generateProviderId } from '@/lib/custom-endpoints';

export type TestState = 'idle' | 'testing' | 'ok' | 'error';
export type ErrorCode = 'auth_error' | 'model_not_found' | 'endpoint_error' | 'rate_limited' | 'network_error' | 'unknown';

export interface TestResult {
  state: TestState;
  latency?: number;
  error?: string;
  code?: ErrorCode;
}

export interface CustomProviderFormState {
  name: string;
  setName: (v: string) => void;
  protocol: ProviderId;
  setProtocol: (v: ProviderId) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  testResult: TestResult;
  canSave: boolean;
  isDuplicateName: boolean;
  handleTest: () => Promise<void>;
  handleSave: () => void;
}

export function buildDefaultProviderName(
  protocol: ProviderId,
  existingNames: string[] = [],
  excludeName?: string,
  locale?: string,
): string {
  const preset = PROVIDER_PRESETS[protocol];
  const baseName = locale === 'zh' ? preset.nameZh : preset.name;
  const normalizedExisting = new Set(
    existingNames
      .filter((name) => name && name !== excludeName)
      .map((name) => name.trim().toLowerCase()),
  );

  if (!normalizedExisting.has(baseName.trim().toLowerCase())) return baseName;

  let index = 2;
  while (normalizedExisting.has(`${baseName} ${index}`.toLowerCase())) {
    index++;
  }
  return `${baseName} ${index}`;
}

/**
 * Shared form state + test/save logic for provider forms.
 * Used by both the inline form (AiTab) and the modal (ProviderModal).
 */
export function useCustomProviderForm({
  initial,
  onSave,
  locale,
  existingNames,
}: {
  initial?: Provider;
  onSave: (provider: Provider) => void;
  locale: string;
  existingNames?: string[];
}): CustomProviderFormState {
  const initialName = useMemo(
    () => initial?.name ?? buildDefaultProviderName(initial?.protocol ?? 'openai', existingNames, initial?.name, locale),
    [initial?.name, initial?.protocol, existingNames, locale],
  );

  const [name, setNameState] = useState(initialName);
  const [protocol, setProtocolState] = useState<ProviderId>(initial?.protocol ?? 'openai');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [testResult, setTestResult] = useState<TestResult>({ state: 'idle' });
  const [nameTouched, setNameTouched] = useState(!!initial?.name);

  const autoName = useMemo(
    () => buildDefaultProviderName(protocol, existingNames, initial?.name, locale),
    [protocol, existingNames, initial?.name, locale],
  );

  useEffect(() => {
    if (!nameTouched) {
      setNameState(autoName);
    }
  }, [autoName, nameTouched]);

  const setName = useCallback((value: string) => {
    setNameTouched(true);
    setNameState(value);
  }, []);

  const setProtocol = useCallback((value: ProviderId) => {
    setProtocolState(value);
    setTestResult({ state: 'idle' });
  }, []);

  // Check for duplicate name (exclude the provider being edited)
  const trimmedName = name.trim();
  const effectiveName = trimmedName || autoName;
  const isDuplicateName = !!(effectiveName && existingNames?.some(
    n => n !== initial?.name && n.toLowerCase() === effectiveName.toLowerCase(),
  ));

  const canSave = !!(baseUrl.trim() && model.trim() && !isDuplicateName);

  const requiredFieldsMessage = locale === 'zh'
    ? '接口地址和模型为必填'
    : 'Base URL and model are required';

  const duplicateNameMessage = locale === 'zh'
    ? '名称已存在，请使用其他名称'
    : 'Name already exists, please use a different name';

  const handleTest = useCallback(async () => {
    if (isDuplicateName) {
      setTestResult({ state: 'error', error: duplicateNameMessage });
      return;
    }
    if (!baseUrl.trim() || !model.trim()) {
      setTestResult({ state: 'error', error: requiredFieldsMessage });
      return;
    }
    setTestResult({ state: 'testing' });
    try {
      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          initial?.id
            ? { provider: initial.id, apiKey, model, baseUrl }
            : { provider: protocol, apiKey, model, baseUrl, baseProviderId: protocol },
        ),
      });
      const json = await res.json();
      if (json.ok) {
        setTestResult({ state: 'ok', latency: json.latency });
      } else {
        setTestResult({ state: 'error', error: json.error || 'Test failed', code: json.code });
      }
    } catch {
      setTestResult({ state: 'error', code: 'network_error', error: 'Network error' });
    }
  }, [isDuplicateName, duplicateNameMessage, baseUrl, model, initial?.id, apiKey, protocol, requiredFieldsMessage]);

  const handleSave = useCallback(() => {
    if (isDuplicateName) {
      setTestResult({ state: 'error', error: duplicateNameMessage });
      return;
    }
    if (!baseUrl.trim() || !model.trim()) {
      setTestResult({ state: 'error', error: requiredFieldsMessage });
      return;
    }
    onSave({
      id: initial?.id || generateProviderId(),
      name: effectiveName,
      protocol,
      apiKey,
      model: model.trim(),
      baseUrl: baseUrl.trim(),
    });
  }, [isDuplicateName, duplicateNameMessage, baseUrl, model, requiredFieldsMessage, onSave, initial?.id, effectiveName, protocol, apiKey]);

  return {
    name, setName,
    protocol, setProtocol,
    apiKey, setApiKey,
    model, setModel,
    baseUrl, setBaseUrl,
    testResult,
    canSave,
    isDuplicateName,
    handleTest,
    handleSave,
  };
}
