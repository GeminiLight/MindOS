'use client';

import { AlertCircle, Loader2, Check, Zap } from 'lucide-react';
import type { TestResult, ErrorCode } from './useCustomProviderForm';
import type { AiTabProps } from './types';

function errorMessage(t: AiTabProps['t'], code?: ErrorCode): string {
  switch (code) {
    case 'auth_error': return t.settings.ai.testKeyAuthError;
    case 'model_not_found': return t.settings.ai.testKeyModelNotFound;
    case 'endpoint_error': return t.settings.ai.testKeyEndpointError;
    case 'rate_limited': return t.settings.ai.testKeyRateLimited;
    case 'network_error': return t.settings.ai.testKeyNetworkError;
    default: return t.settings.ai.testKeyUnknown;
  }
}

/**
 * Shared test-connection button used by both built-in and custom provider forms.
 * Shows contextual icon + text based on test result state (idle/testing/ok/error).
 */
export function TestButton({
  result, disabled, onTest, t,
}: {
  result: TestResult;
  disabled: boolean;
  onTest: () => void;
  t: AiTabProps['t'];
}) {
  const isTesting = result.state === 'testing';
  const isOk = result.state === 'ok';
  const isError = result.state === 'error';

  return (
    <button
      type="button"
      disabled={disabled || isTesting}
      onClick={onTest}
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 disabled:cursor-not-allowed ${
        isOk
          ? 'bg-success/10 text-success border border-success/20'
          : isError
            ? 'bg-destructive/8 text-destructive border border-destructive/20 hover:bg-destructive/12'
            : 'border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40'
      }`}
    >
      {isTesting ? (
        <Loader2 size={13} className="animate-spin" />
      ) : isOk ? (
        <Check size={13} />
      ) : isError ? (
        <AlertCircle size={13} />
      ) : (
        <Zap size={13} />
      )}
      {isTesting
        ? t.settings.ai.testKeyTesting
        : isOk && result.latency != null
          ? t.settings.ai.testKeyOk(result.latency)
          : isError
            ? errorMessage(t, result.code)
            : t.settings.ai.testKey}
    </button>
  );
}
