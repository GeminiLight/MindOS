// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PiThinkingLevelCapsule, {
  getPersistedPiThinkingLevel,
} from '@/components/ask/PiThinkingLevelCapsule';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderCapsule(input: {
  provider?: string | null;
  model?: string | null;
  value?: string;
  onChange?: ReturnType<typeof vi.fn>;
} = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChange = input.onChange ?? vi.fn();

  act(() => {
    root.render(
      <PiThinkingLevelCapsule
        providerValue={(input.provider ?? 'p_openai') as `p_${string}`}
        modelValue={input.model ?? 'gpt-5.6'}
        value={input.value as never}
        onChange={onChange}
      />,
    );
  });

  return {
    host,
    onChange,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function clickButtonWithText(scope: ParentNode, text: string) {
  const button = Array.from(scope.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement;
  expect(button).toBeTruthy();
  act(() => button.click());
  return button;
}

describe('PiThinkingLevelCapsule', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      provider: 'p_openai',
      model: 'gpt-5.6',
      reasoning: true,
      defaultLevel: 'medium',
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders all model-advertised levels, sends max, and persists it by concrete model', async () => {
    const view = renderCapsule();
    await flushEffects();

    expect(view.host.textContent).toContain('Medium');
    clickButtonWithText(view.host, 'Medium');
    expect(document.body.textContent).toContain('Minimal');
    expect(document.body.textContent).toContain('Extra High');
    expect(document.body.textContent).toContain('Max');

    clickButtonWithText(document.body, 'Max');
    expect(view.onChange).toHaveBeenLastCalledWith('max');
    expect(getPersistedPiThinkingLevel('p_openai', 'gpt-5.6')).toBe('max');
    view.cleanup();
  });

  it('hides the control and clamps the current selection to off for a non-reasoning model', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      provider: 'p_openai',
      model: 'plain-model',
      reasoning: false,
      defaultLevel: 'off',
      levels: ['off'],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const view = renderCapsule({ model: 'plain-model', value: 'high' });
    await flushEffects();

    expect(view.host.querySelector('[data-pi-thinking-level]')).toBeNull();
    expect(view.onChange).toHaveBeenLastCalledWith('off');
    view.cleanup();
  });

  it('reloads a model-scoped preference instead of carrying an unsupported value across models', async () => {
    localStorage.setItem('mindos-pi-thinking-level.v1:p_openai:gpt-5.6', 'xhigh');
    const view = renderCapsule();
    await flushEffects();

    expect(view.onChange).toHaveBeenLastCalledWith('xhigh');
    view.cleanup();
  });
});
