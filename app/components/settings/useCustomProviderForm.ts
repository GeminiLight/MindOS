'use client';

import { useState, useCallback } from 'react';
import { type ProviderId } from '@/lib/agent/providers';
import { type Provider, generateProviderId } from '@/lib/custom-endpoints';

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
  const [name, setName] = useState(initial?.name ?? '');
  const [protocol, setProtocol] = useState<ProviderId>(initial?.protocol ?? 'openai');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [testResult, setTestResult] = useState<TestResult>({ state: 'idle' });

  // Check for duplicate name (exclude the provider being edited)
  const trimmedName = name.trim();
  const isDuplicateName = !!(trimmedName && existingNames?.some(
    n => n.toLowerCase() === trimmedName.toLowerCase(),
  ));

  const canSave = !!(trimmedName && baseUrl.trim() && model.trim() && !isDuplicateName);

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
            : { protocol, apiKey, model, baseUrl },
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
  }, [canSave, apiKey, model, baseUrl, protocol, locale, initial?.id]);

  const handleSave = useCallback(() => {
    if (isDuplicateName) {
      setTestResult({
        state: 'error',
        error: locale === 'zh' ? '名称已存在，请使用其他名称' : 'Name already exists, please use a different name',
      });
      return;
    }
    if (!canSave) {
      setTestResult({
        state: 'error',
        error: locale === 'zh' ? '名称、接口地址和模型为必填' : 'Name, base URL, and model are required',
      });
      return;
    }
    onSave({
      id: initial?.id || generateProviderId(),
      name: name.trim(),
      protocol,
      apiKey,
      model: model.trim(),
      baseUrl: baseUrl.trim(),
    });
  }, [canSave, isDuplicateName, name, protocol, apiKey, model, baseUrl, initial?.id, onSave, locale]);

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
