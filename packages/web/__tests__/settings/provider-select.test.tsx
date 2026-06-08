// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProviderSelect from '@/components/shared/ProviderSelect';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProviderSelect settings mode', () => {
  it('shows unconfigured provider templates so users can switch after choosing one provider', async () => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ProviderSelect
          value="p_openai01"
          onChange={onChange}
          compact
          providerEntries={[
            { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
          ]}
          onAdd={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain('OpenAI');
    expect(host.textContent).toContain('Anthropic');

    const anthropicButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Anthropic'));
    expect(anthropicButton).toBeDefined();

    await act(async () => {
      anthropicButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onChange).toHaveBeenCalledWith('anthropic');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('keeps setup mode protocol selection separate from provider entry mode', async () => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ProviderSelect
          value="openai"
          onChange={onChange}
          compact
          showSkip
          configuredProviders={new Set(['openai'])}
        />,
      );
    });

    expect(host.textContent).toContain('OpenAI');
    expect(host.textContent).toContain('Skip for now');

    const anthropicButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Anthropic'));
    expect(anthropicButton).toBeDefined();

    await act(async () => {
      anthropicButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onChange).toHaveBeenCalledWith('anthropic');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
