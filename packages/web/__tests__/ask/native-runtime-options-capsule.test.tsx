// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NativeRuntimeOptionsCapsule, {
  getPersistedNativeRuntimeOptions,
  persistNativeRuntimeOptions,
} from '@/components/ask/NativeRuntimeOptionsCapsule';
import type { AgentRuntimeKind, NativeRuntimeOptions } from '@/lib/types';

const codexModels = {
  data: [
    {
      id: 'gpt-5.6-sol',
      model: 'gpt-5.6-sol',
      displayName: 'GPT-5.6 Sol',
      description: 'Fast coding model',
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Low effort' },
        { reasoningEffort: 'medium', description: 'Medium effort' },
        { reasoningEffort: 'high', description: 'High effort' },
        { reasoningEffort: 'xhigh', description: 'Extra high effort' },
        { reasoningEffort: 'max', description: 'Max effort' },
        { reasoningEffort: 'ultra', description: 'Ultra effort with delegation' },
      ],
      defaultReasoningEffort: 'low',
    },
    {
      id: 'gpt-5.6-luna',
      model: 'gpt-5.6-luna',
      displayName: 'GPT-5.6 Luna',
      description: 'General coding model',
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Low effort' },
        { reasoningEffort: 'medium', description: 'Medium effort' },
        { reasoningEffort: 'high', description: 'High effort' },
        { reasoningEffort: 'xhigh', description: 'Extra high effort' },
        { reasoningEffort: 'max', description: 'Max effort' },
      ],
      defaultReasoningEffort: 'medium',
    },
  ],
  nextCursor: null,
};

function renderCapsule(input: {
  runtimeKind?: Extract<AgentRuntimeKind, 'codex' | 'claude'>;
  value?: NativeRuntimeOptions;
  onChange?: ReturnType<typeof vi.fn>;
} = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChange = input.onChange ?? vi.fn();

  act(() => {
    root.render(
      <NativeRuntimeOptionsCapsule
        runtimeKind={input.runtimeKind ?? 'codex'}
        value={input.value ?? {}}
        onChange={onChange}
      />,
    );
  });

  return {
    host,
    onChange,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickButtonWithText(scope: ParentNode, text: string) {
  const button = Array.from(scope.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement;
  expect(button).toBeTruthy();
  act(() => button.click());
  return button;
}

describe('NativeRuntimeOptionsCapsule', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(codexModels), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('shows the Codex model default without sending it and exposes Sol max and ultra efforts', async () => {
    const view = renderCapsule();
    await flushEffects();

    expect(view.host.textContent).toContain('Default');
    expect(view.host.textContent).toContain('Low (Default)');
    expect(view.onChange).not.toHaveBeenCalled();

    clickButtonWithText(view.host, 'Low (Default)');

    expect(document.body.textContent).toContain('Extra High');
    expect(document.body.textContent).toContain('Max');
    expect(document.body.textContent).toContain('Ultra');
    clickButtonWithText(document.body, 'Ultra');
    expect(view.onChange).toHaveBeenLastCalledWith({ reasoningEffort: 'ultra' });

    view.cleanup();
  });

  it('uses the selected model capability list and omits unsupported Ultra effort', async () => {
    const view = renderCapsule({ value: { modelOverride: 'gpt-5.6-luna' } });
    await flushEffects();

    expect(view.host.textContent).toContain('Medium (Default)');
    clickButtonWithText(view.host, 'Medium (Default)');
    expect(document.body.textContent).toContain('Max');
    expect(document.body.textContent).not.toContain('Ultra');

    view.cleanup();
  });

  it('keeps Claude on its own fixed effort options', async () => {
    const view = renderCapsule({ runtimeKind: 'claude' });
    await flushEffects();

    const effortButton = view.host.querySelectorAll('button')[1] as HTMLButtonElement;
    act(() => effortButton.click());
    expect(document.body.textContent).toContain('Extra High');
    const optionLabels = Array.from(document.body.querySelectorAll('[role="option"]'))
      .map((option) => option.querySelector('.font-medium')?.textContent);
    expect(optionLabels).not.toContain('Max');
    expect(optionLabels).not.toContain('Ultra');
    expect(fetch).not.toHaveBeenCalled();

    view.cleanup();
  });

  it('persists model-advertised effort values across reloads', () => {
    persistNativeRuntimeOptions('codex', {
      modelOverride: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    });

    expect(getPersistedNativeRuntimeOptions('codex')).toEqual({
      modelOverride: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    });
  });

  it('keeps the model override control behavior', async () => {
    const view = renderCapsule();
    await flushEffects();
    clickButtonWithText(view.host, 'Default');

    const input = document.body.querySelector('input[placeholder="gpt-5.4-codex"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'gpt-5.6-sol');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickButtonWithText(document.body, 'Apply');

    expect(view.onChange).toHaveBeenLastCalledWith({ modelOverride: 'gpt-5.6-sol' });
    view.cleanup();
  });
});
