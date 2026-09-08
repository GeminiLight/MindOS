// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: {
      settings: {
        uninstall: {
          title: 'Uninstall MindOS',
          descCli: 'Remove MindOS CLI and background services from this machine. Configuration cleanup is optional below.',
          descDesktop: 'Remove MindOS Desktop and background services from this machine. Configuration cleanup is optional below.',
          stopServices: 'Stop services & remove daemon',
          stopServicesDesc: 'Stop all running MindOS processes and remove the background daemon.',
          removeConfig: 'Remove configuration',
          removeConfigDesc: 'Delete ~/.mindos/ directory (config, logs, PID files).',
          removeNpm: 'Uninstall CLI package',
          removeNpmDesc: 'Run npm uninstall -g @geminilight/mindos.',
          removeApp: 'Move Desktop app to Trash',
          removeAppDesc: 'Move MindOS.app to Trash. You can restore it later if needed.',
          confirmTitle: 'Confirm Uninstall',
          confirmButton: 'Uninstall',
          cancelButton: 'Cancel',
          requiredLabel: 'Always included',
          reviewOptions: 'Review options',
          running: 'Uninstalling...',
          success: 'The uninstall request has been submitted. Please verify the result afterwards.',
          successDesktop: 'The uninstall request has been submitted. The app will quit now.',
          error: 'Uninstall failed. You can run `mindos uninstall` in terminal manually.',
          nothingSelected: 'Select at least one item to uninstall.',
          kbSafe: 'Your knowledge base files are always safe — they are never deleted by this action.',
        },
      },
    },
  }),
}));

describe('UninstallTab', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    delete (window as unknown as { mindos?: unknown }).mindos;
    mockApiFetch.mockResolvedValue({ ok: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (window as unknown as { mindos?: unknown }).mindos;
  });

  it('keeps configuration removal unchecked by default', async () => {
    const { UninstallTab } = await import('@/components/settings/UninstallTab');

    await act(async () => {
      root.render(<UninstallTab />);
    });

    const checkboxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const removeConfig = checkboxes.find(input => input.closest('label')?.textContent?.includes('Remove configuration'));
    expect(removeConfig).toBeTruthy();
    expect(removeConfig?.checked).toBe(false);

    const firstUninstall = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Uninstall'));
    await act(async () => {
      firstUninstall?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const confirmUninstall = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Uninstall');
    await act(async () => {
      confirmUninstall?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/uninstall', expect.objectContaining({
      body: JSON.stringify({ removeConfig: false }),
    }));
  });

  it('sends removeConfig true only after the user explicitly selects configuration removal', async () => {
    const { UninstallTab } = await import('@/components/settings/UninstallTab');

    await act(async () => {
      root.render(<UninstallTab />);
    });

    const checkboxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const removeConfig = checkboxes.find(input => input.closest('label')?.textContent?.includes('Remove configuration'));
    expect(removeConfig).toBeTruthy();

    await act(async () => {
      removeConfig?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(removeConfig?.checked).toBe(true);

    const firstUninstall = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Uninstall'));
    await act(async () => {
      firstUninstall?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const confirmUninstall = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Uninstall');
    await act(async () => {
      confirmUninstall?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/uninstall', expect.objectContaining({
      body: JSON.stringify({ removeConfig: true }),
    }));
  });

  const button = (label: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label)!;
  async function mount() { const { UninstallTab } = await import('@/components/settings/UninstallTab'); await act(async () => root.render(<UninstallTab />)); }
  async function click(label: string) { await act(async () => button(label).click()); }
  function configOption() { return Array.from(host.querySelectorAll<HTMLInputElement>('input')).find(input => input.closest('label')?.textContent?.includes('Remove configuration'))!; }

  it('keeps keyboard focus on an option after changing its value', async () => {
    await mount(); const input = configOption(); input.focus();
    await act(async () => input.click());
    expect(document.activeElement).toBe(configOption());
    expect(configOption().checked).toBe(true);
  });

  it('explains mandatory steps without fading their consequences', async () => {
    await mount();
    const mandatory = Array.from(host.querySelectorAll<HTMLInputElement>('input:disabled'));
    expect(mandatory).toHaveLength(2);
    for (const input of mandatory) {
      expect(input.checked).toBe(true);
      expect(input.closest('label')?.textContent).toContain('Always included');
      expect(input.closest('label')?.className).not.toContain('opacity-');
    }
  });

  it('focuses cancel on confirmation and Escape returns without uninstalling or losing options', async () => {
    await mount(); await act(async () => configOption().click()); await click('Uninstall');
    expect(document.activeElement).toBe(button('Cancel'));
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBeTruthy();
    await act(async () => button('Cancel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.textContent).not.toContain('Confirm Uninstall');
    expect(document.activeElement).toBe(button('Uninstall'));
    expect(configOption().checked).toBe(true);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('returns focus after clicking cancel without making any request', async () => {
    await mount(); await click('Uninstall'); await click('Cancel');
    expect(document.activeElement).toBe(button('Uninstall'));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('lets Escape cancel confirmation after revisiting an option too', async () => {
    await mount(); await click('Uninstall'); configOption().focus();
    await act(async () => configOption().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.textContent).not.toContain('Confirm Uninstall');
    expect(document.activeElement).toBe(button('Uninstall'));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('keeps Desktop removal optional and never calls its bridge when unchecked', async () => {
    const uninstallApp = vi.fn(); Object.assign(window, { mindos: { uninstallApp } });
    await mount();
    const appOption = Array.from(host.querySelectorAll<HTMLInputElement>('input')).find(input => input.closest('label')?.textContent?.includes('Move Desktop app'))!;
    expect(appOption.checked).toBe(true);
    expect(host.querySelectorAll('input:disabled')).toHaveLength(1);
    appOption.focus(); await act(async () => appOption.click()); expect(document.activeElement).toBe(appOption);
    await click('Uninstall'); await click('Uninstall');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(uninstallApp).not.toHaveBeenCalled();
  });

  it('does not remove the Desktop app if server cleanup fails', async () => {
    const uninstallApp = vi.fn(); Object.assign(window, { mindos: { uninstallApp } });
    mockApiFetch.mockRejectedValue(new Error('Server cleanup failed'));
    await mount(); await click('Uninstall'); await click('Uninstall');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Uninstall failed');
    expect(uninstallApp).not.toHaveBeenCalled();
  });

  it('announces a pending uninstall and refuses duplicate confirmation', async () => {
    let resolve!: (value: unknown) => void;
    mockApiFetch.mockImplementation(() => new Promise(done => { resolve = done; }));
    await mount(); await click('Uninstall'); const confirm = button('Uninstall');
    await act(async () => { confirm.click(); confirm.click(); });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Uninstalling');
    await act(async () => resolve({ ok: true }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('request has been submitted');
  });

  it('announces a failure and lets the user review retained options before retrying', async () => {
    mockApiFetch.mockRejectedValue(new Error('Service unavailable'));
    await mount(); await act(async () => configOption().click()); await click('Uninstall'); await click('Uninstall');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Uninstall failed');
    await click('Review options');
    expect(configOption().checked).toBe(true);
    expect(document.activeElement).toBe(button('Uninstall'));
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
