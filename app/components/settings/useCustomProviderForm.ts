'use client';

import { useState, useCallback } from 'react';
import { type ProviderId } from '@/lib/agent/providers';
import { type CustomProvider, generateCustomProviderId } from '@/lib/custom-endpoints';

export type TestState = 'idle' | 'testing' | 'ok' | 'error';
export type ErrorCode = 'auth_error' | 'model_not_found' | 'rate_limited' | 'network_error' | 'unknown';

export interface TestResult {
  state: TestState;
  latency?: number;
  error?: string;
  code?: ErrorCode;
}

export interface CustomProviderFormState {
  name: string;
  setName: (v: string) => void;
  baseProviderId: ProviderId;
  setBaseProviderId: (v: ProviderId) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  testResult: TestResult;
  canSave: boolean;
  handleTest: () => Promise<void>;
  handleSave: () => void;
}

/**
 * Shared form state + test/save logic for custom provider forms.
 * Used by both the inline form (AiTab) and the modal (ProviderModal).
 */
export function useCustomProviderForm({
  initial,
  onSave,
  locale,
}: {
  initial?: CustomProvider;
  onSave: (provider: CustomProvider) => void;
  locale: string;
}): CustomProviderFormState {
  const [name, setName] = useState(initial?.name ?? '');
  const [baseProviderId, setBaseProviderId] = useState<ProviderId>(initial?.baseProviderId ?? 'openai');
  const [apiKey, setApiKey] = useState(initial?.apiKey === '***set***' ? '' : initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [testResult, setTestResult] = useState<TestResult>({ state: 'idle' });

  const canSave = !!(name.trim() && baseUrl.trim() && model.trim());

  const handleTest = useCallback(async () => {
    if (!canSave) {
      setTestResult({
        state: 'error',
        error: locale === 'zh' ? '名称、接口地址和模型为必填' : 'Name, base URL, and model are required',
      });
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
            : { baseProviderId, apiKey, model, baseUrl },
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
  }, [canSave, apiKey, model, baseUrl, baseProviderId, locale, initial?.id]);

  const handleSave = useCallback(() => {
    if (!canSave) {
      setTestResult({
        state: 'error',
        error: locale === 'zh' ? '名称、接口地址和模型为必填' : 'Name, base URL, and model are required',
      });
      return;
    }
    onSave({
      id: initial?.id || generateCustomProviderId(),
      name: name.trim(),
      baseProviderId,
      apiKey,
      model: model.trim(),
      baseUrl: baseUrl.trim(),
    });
  }, [canSave, name, baseProviderId, apiKey, model, baseUrl, initial?.id, onSave, locale]);

  return {
    name, setName,
    baseProviderId, setBaseProviderId,
    apiKey, setApiKey,
    model, setModel,
    baseUrl, setBaseUrl,
    testResult,
    canSave,
    handleTest,
    handleSave,
  };
}
