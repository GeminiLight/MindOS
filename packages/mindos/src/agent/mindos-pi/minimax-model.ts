/** Compatibility for releases newer than the pinned Pi catalog. */
export function applyMiniMaxModelCompatibility<T extends Record<string, unknown>>(model: T, provider: string): T {
  const native = (provider === 'minimax' || provider === 'minimax-cn')
    && (model.id === 'MiniMax-M3.1-Flash' || model.id === 'MiniMax-M3');
  if (!native) {
    const openRouterFlash = provider === 'openrouter'
      && (model.id === 'minimax/minimax-m3.1-flash' || model.id === 'minimax/minimax-m3.1-flash:free')
      && typeof model.baseUrl === 'string' && model.baseUrl.replace(/\/+$/, '') === 'https://openrouter.ai/api/v1';
    return openRouterFlash
      ? { ...model, reasoning: true, thinkingLevelMap: { off: null, minimal: 'low' } }
      : model;
  }
  const flash = model.id === 'MiniMax-M3.1-Flash';
  return {
    ...model,
    contextWindow: 1_000_000,
    ...(flash ? { maxTokens: 524_288 } : {}),
    reasoning: true,
    compat: {
      ...(model.compat && typeof model.compat === 'object' ? model.compat : {}),
      forceAdaptiveThinking: true,
      allowEmptySignature: true,
    },
    thinkingLevelMap: {
      ...(flash ? { off: null } : {}),
      minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
    },
  };
}
