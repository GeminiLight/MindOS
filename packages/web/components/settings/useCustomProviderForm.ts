'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { type ProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';
import { type Provider, generateProviderId } from '@/lib/custom-endpoints';
import {
  buildDefaultProviderName,
  getProviderDefaultBaseUrl,
} from '@/lib/ai-provider-settings';

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

/**
 * Shared form state + test/save logic for provider forms.
 * Used by the inline provider form in AiTab.
 */
export function useCustomProviderForm({
  onSave,
  locale,
  existingNames,
}: {
  onSave: (provider: Provider) => void;
  locale: string;
  existingNames?: string[];
}): CustomProviderFormState {
  const initialProtocol: ProviderId = 'openai';
  const [name, setNameState] = useState(() => buildDefaultProviderName(initialProtocol, existingNames, undefined, locale));
  const [protocol, setProtocolState] = useState<ProviderId>(initialProtocol);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PROVIDER_PRESETS[initialProtocol].defaultModel);
  const [baseUrl, setBaseUrl] = useState(getProviderDefaultBaseUrl(initialProtocol));
  const [testResult, setTestResult] = useState<TestResult>({ state: 'idle' });
  const [nameTouched, setNameTouched] = useState(false);

  const autoName = useMemo(
    () => buildDefaultProviderName(protocol, existingNames, undefined, locale),
    [protocol, existingNames, locale],
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
    setApiKey('');
    setModel(PROVIDER_PRESETS[value].defaultModel);
    setBaseUrl(getProviderDefaultBaseUrl(value));
    setTestResult({ state: 'idle' });
  }, []);

  const trimmedName = name.trim();
  const effectiveName = trimmedName || autoName;
  const isDuplicateName = !!(effectiveName && existingNames?.some(
    n => n.toLowerCase() === effectiveName.toLowerCase(),
  ));

  const canSave = !!(model.trim() && !isDuplicateName);

  const requiredFieldsMessage = locale === 'zh'
    ? '模型为必填'
    : 'Model is required';

  const duplicateNameMessage = locale === 'zh'
    ? '名称已存在，请使用其他名称'
    : 'Name already exists, please use a different name';

  const handleTest = useCallback(async () => {
    if (isDuplicateName) {
      setTestResult({ state: 'error', error: duplicateNameMessage });
      return;
    }
    if (!model.trim()) {
      setTestResult({ state: 'error', error: requiredFieldsMessage });
      return;
    }
    setTestResult({ state: 'testing' });
    try {
      const preset = PROVIDER_PRESETS[protocol];
      const testApiKey = apiKey || preset?.apiKeyFallback || '';
      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: protocol, apiKey: testApiKey, model, baseUrl, baseProviderId: protocol }),
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
  }, [isDuplicateName, duplicateNameMessage, model, protocol, apiKey, baseUrl, requiredFieldsMessage]);

  const handleSave = useCallback(() => {
    if (isDuplicateName) {
      setTestResult({ state: 'error', error: duplicateNameMessage });
      return;
    }
    if (!model.trim()) {
      setTestResult({ state: 'error', error: requiredFieldsMessage });
      return;
    }
    onSave({
      id: generateProviderId(),
      name: effectiveName,
      protocol,
      apiKey,
      model: model.trim(),
      baseUrl: baseUrl.trim(),
    });
  }, [isDuplicateName, duplicateNameMessage, baseUrl, model, requiredFieldsMessage, onSave, effectiveName, protocol, apiKey]);

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
