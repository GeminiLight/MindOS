// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DiscoverAgentModal from '@/components/agents/DiscoverAgentModal';
import type { RemoteAgent } from '@/lib/a2a/types';

vi.mock('@/lib/stores/locale-store', async () => {
  const { messages } = await import('@/lib/i18n');
  return { useLocale: () => ({ locale: 'en', t: messages.en }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const remoteAgent = {
  id: 'remote-1',
  endpoint: 'https://agent.example.com',
  card: { name: 'Remote Agent', version: '1.0.0', description: 'A remote agent', skills: [] },
} as unknown as RemoteAgent;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('DiscoverAgentModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  function render(props: Partial<React.ComponentProps<typeof DiscoverAgentModal>> = {}) {
    const onClose = vi.fn();
    const onDiscover = vi.fn().mockResolvedValue(null);
    const all = { open: true, onClose, onDiscover, discovering: false, error: null, ...props };
    act(() => { root.render(<DiscoverAgentModal {...all} />); });
    return { onClose, onDiscover, rerender: (next: Partial<typeof all>) => act(() => { root.render(<DiscoverAgentModal {...all} {...next} />); }) };
  }

  it('clears the typed URL when closed via Escape', () => {
    const { onClose, rerender } = render();
    const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
    act(() => { setInputValue(input, 'https://agent.example.com'); });
    expect(input.value).toBe('https://agent.example.com');

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    rerender({ open: true });
    expect(host.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe('');
  });

  it('drops a discovery result that arrives after the modal was closed', async () => {
    let resolveDiscover!: (agent: RemoteAgent | null) => void;
    const onDiscover = vi.fn(() => new Promise<RemoteAgent | null>((resolve) => { resolveDiscover = resolve; }));
    const { rerender } = render({ onDiscover });

    const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
    act(() => { setInputValue(input, 'https://agent.example.com'); });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onDiscover).toHaveBeenCalledWith('https://agent.example.com');

    // Close while the discovery is still in flight.
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(); });
    rerender({ open: false });

    await act(async () => { resolveDiscover(remoteAgent); await Promise.resolve(); });

    rerender({ open: true });
    expect(host.textContent).not.toContain('A remote agent');
    expect(host.textContent).not.toContain('v1.0.0');
  });
});
