import type { AskModeApi } from '@/lib/types';

export function resolveAskCompatMode(input: {
  askMode: AskModeApi;
  provider: string;
  baseUrl?: string;
  cachedMode?: string;
}): 'non-streaming' | undefined {
  if (input.cachedMode === 'non-streaming') return 'non-streaming';
  if (input.askMode === 'organize' && input.provider === 'openai' && Boolean(input.baseUrl)) {
    return 'non-streaming';
  }
  return undefined;
}
