// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { messages } from '@/lib/i18n';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null, value: string) {
  if (!input) return;
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input?.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SyncTab UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('leads with a plain-language health summary before Git details', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: new Date().toISOString(),
      unpushed: '0',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('All notes are backed up');
    expect(host.textContent).toContain('Next: keep writing');
    expect(host.textContent).toContain('Repository');
    expect(host.textContent).toContain('Automation');
    expect(host.textContent).toContain('Save changes every');
    expect(host.textContent).toContain('Check for updates every');
    expect(host.textContent?.match(/Sync Now/g)).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('turns conflicts into an explicit recovery workflow', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: null,
      unpushed: '2',
      conflicts: [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Resolve conflicts to finish sync');
    expect(host.textContent).toContain('Review each file below');
    expect(host.textContent).toContain('Choose which version to keep');
    expect(host.textContent).toContain('notes/today.md');
    expect(host.textContent).not.toContain('Sync Now');
    expect((Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep local')) as HTMLButtonElement | undefined)?.disabled).toBe(true);
    expect((Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep remote')) as HTMLButtonElement | undefined)?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it('does not report a clean repository with no recorded sync as backed up', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: true,
      configured: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: null,
      unpushed: '0',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync is ready');
    expect(host.textContent).toContain('Run Sync Now to create the first backup');
    expect(host.textContent).not.toContain('All notes are backed up');
    expect(host.textContent).not.toContain('Last sync: never');

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces recovery guidance for sync errors', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: null,
      unpushed: '0',
      conflicts: [],
      lastError: 'Permission denied (publickey)',
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync needs attention');
    expect(host.textContent).toContain('SSH key may not be configured');
    expect(host.textContent).toContain('Next: fix the issue, then sync again');
    expect(host.textContent?.match(/SSH key may not be configured/g)).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('explains the first-time setup path before asking for credentials', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: false,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Start with a private Git repository');
    expect(host.textContent).toContain('Paste a remote URL to continue');
    expect(host.textContent).toContain('HTTPS needs a token for private repos');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows a recoverable paused state instead of the first-time setup form', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: false,
      configured: true,
      remote: 'https://github.com/me/mind.git',
      branch: 'main',
      lastSync: '2026-06-05T10:00:00.000Z',
      unpushed: '0',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Paused');
    expect(host.textContent).toContain('Enable Auto-sync');
    expect(host.textContent).toContain('Reset & Re-configure');
    expect(host.textContent).not.toContain('Connect & Start Sync');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps conflicts visible when auto-sync is paused', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: false,
      configured: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: null,
      unpushed: '0',
      conflicts: [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Paused');
    expect(host.textContent).toContain('Resolve conflicts to finish sync');
    expect(host.textContent).toContain('notes/today.md');
    expect(host.textContent).not.toContain('Connect & Start Sync');

    await act(async () => {
      root.unmount();
    });
  });

  it('uses paused language when local changes exist while auto-sync is disabled', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: false,
      configured: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: '2026-06-05T10:00:00.000Z',
      unpushed: '2',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('2 local changes are waiting');
    expect(host.textContent).toContain('Auto-sync is paused');
    expect(host.textContent).toContain('Intervals apply when auto-sync is enabled');
    expect(host.textContent).toContain('Sync Now');
    expect(host.textContent).not.toContain('MindOS will push them automatically');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps manual sync available when auto-sync is paused with no pending local changes', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'now') return { ok: true };
      return {
        enabled: false,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: '2026-06-05T10:00:00.000Z',
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync is paused');
    expect(host.textContent).toContain('run Sync Now manually');
    const syncButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Sync Now')) as HTMLButtonElement | undefined;
    expect(syncButton).toBeDefined();

    await act(async () => {
      syncButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'now' }),
    }));

    await act(async () => {
      root.unmount();
    });
  });

  it('uses paused language when local change status is unknown while auto-sync is disabled', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: false,
      configured: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: '2026-06-05T10:00:00.000Z',
      unpushed: '?',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync status unknown');
    expect(host.textContent).toContain('Auto-sync is paused');
    expect(host.textContent).toContain('Unknown');
    expect(host.textContent).not.toContain('? changes');
    expect(host.textContent).not.toContain('retry sync or check the remote repository');

    await act(async () => {
      root.unmount();
    });
  });

  it('localizes paused local-change guidance in Chinese', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: false,
      configured: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: '2026-06-05T10:00:00.000Z',
      unpushed: '2',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.zh} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('2 个本地改动等待处理');
    expect(host.textContent).toContain('自动同步已暂停');
    expect(host.textContent).not.toContain('Auto-sync is paused');
    expect(host.textContent).not.toContain('local changes are waiting');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not report unknown unpushed status as backed up', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValue({
      enabled: true,
      configured: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: null,
      unpushed: '?',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync status unknown');
    expect(host.textContent).not.toContain('All notes are backed up');

    await act(async () => {
      root.unmount();
    });
  });

  it('accepts ssh:// git remote URLs in first-time setup', async () => {
    const SyncEmptyState = (await import('@/components/settings/SyncEmptyState')).default;
    mockApiFetch.mockResolvedValue({ success: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncEmptyState t={messages.en} onInitComplete={vi.fn()} />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement | null;
    await act(async () => {
      setInputValue(input, 'ssh://git@example.com/mind/repo.git');
      await Promise.resolve();
    });

    const connectButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Connect & Start Sync')) as HTMLButtonElement | undefined;
    expect(connectButton?.disabled).toBe(false);
    expect(host.textContent).not.toContain('Invalid Git URL');

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: expect.stringContaining('ssh://git@example.com/mind/repo.git'),
    }));

    await act(async () => {
      root.unmount();
    });
  });

  it('rejects branch names that Git will reject before starting setup', async () => {
    const SyncEmptyState = (await import('@/components/settings/SyncEmptyState')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncEmptyState t={messages.en} onInitComplete={vi.fn()} />);
      await Promise.resolve();
    });

    const inputs = Array.from(host.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
    const remoteInput = inputs[0];
    const branchInput = inputs.find(input => input.value === 'main') ?? inputs[1];

    await act(async () => {
      setInputValue(remoteInput, 'git@example.com:mind/repo.git');
      await Promise.resolve();
    });

    for (const invalidBranch of ['/main', 'main/', 'foo.lock', 'foo@{bar}']) {
      await act(async () => {
        setInputValue(branchInput, invalidBranch);
        await Promise.resolve();
      });
      const connectButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Connect & Start Sync')) as HTMLButtonElement | undefined;
      expect(connectButton?.disabled).toBe(true);
      expect(host.textContent).toContain('Use a valid Git branch name');
      expect(host.textContent).toContain('Branch names must be valid Git refs');
    }

    expect(mockApiFetch).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('hides setup progress without enabling a second init request', async () => {
    const SyncEmptyState = (await import('@/components/settings/SyncEmptyState')).default;
    let resolveInit!: () => void;
    mockApiFetch.mockReturnValue(new Promise(resolve => {
      resolveInit = () => resolve({ success: true });
    }));
    const onInitComplete = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncEmptyState t={messages.en} onInitComplete={onInitComplete} />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement | null;
    await act(async () => {
      setInputValue(input, 'git@example.com:mind/repo.git');
      await Promise.resolve();
    });

    const connectButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Connect & Start Sync'));
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    const hideButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Hide progress'));
    await act(async () => {
      hideButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync setup is still running');
    expect(host.textContent).toContain('git@example.com:mind/repo.git');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('Connect & Start Sync'))).toBe(false);
    expect(input?.disabled).toBe(true);
    const branchInput = Array.from(host.querySelectorAll('input'))
      .find(candidate => candidate.value === 'main') as HTMLInputElement | undefined;
    expect(branchInput?.disabled).toBe(true);

    await act(async () => {
      resolveInit();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps setup locked after hidden progress is remounted', async () => {
    const SyncEmptyState = (await import('@/components/settings/SyncEmptyState')).default;
    let resolveInit!: () => void;
    mockApiFetch.mockReturnValue(new Promise(resolve => {
      resolveInit = () => resolve({ success: true });
    }));
    const onInitComplete = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncEmptyState t={messages.en} onInitComplete={onInitComplete} />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement | null;
    await act(async () => {
      setInputValue(input, 'git@example.com:mind/repo.git');
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Connect & Start Sync'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Hide progress'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      root.unmount();
    });

    const remountRoot = createRoot(host);
    await act(async () => {
      remountRoot.render(<SyncEmptyState t={messages.en} onInitComplete={onInitComplete} />);
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync setup is still running');
    expect(host.textContent).toContain('git@example.com:mind/repo.git');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('Connect & Start Sync'))).toBe(false);
    expect((host.querySelector('input[type="text"]') as HTMLInputElement | null)?.disabled).toBe(true);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInit();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onInitComplete).toHaveBeenCalled();

    await act(async () => {
      remountRoot.unmount();
    });
  });

  it('keeps a hidden setup failure visible after remounting settings', async () => {
    const SyncEmptyState = (await import('@/components/settings/SyncEmptyState')).default;
    let rejectInit!: (error: Error) => void;
    mockApiFetch.mockReturnValue(new Promise((_resolve, reject) => {
      rejectInit = reject;
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncEmptyState t={messages.en} onInitComplete={vi.fn()} />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement | null;
    await act(async () => {
      setInputValue(input, 'git@example.com:mind/repo.git');
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Connect & Start Sync'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Hide progress'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      root.unmount();
    });

    await act(async () => {
      rejectInit(new Error('Permission denied (publickey)'));
      await Promise.resolve();
      await Promise.resolve();
    });

    const remountRoot = createRoot(host);
    await act(async () => {
      remountRoot.render(<SyncEmptyState t={messages.en} onInitComplete={vi.fn()} />);
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Permission denied (publickey)');
    expect(host.textContent).toContain('SSH key may not be configured');
    expect((host.querySelector('input[type="text"]') as HTMLInputElement | null)?.value).toBe('git@example.com:mind/repo.git');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('Connect & Start Sync'))).toBe(true);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      remountRoot.unmount();
    });
  });

  it('requires confirmation before resetting a paused sync configuration', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'reset') return { ok: true, enabled: false };
      return {
        enabled: false,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const resetButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Reset & Re-configure'));
    expect(resetButton).toBeTruthy();

    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockApiFetch).not.toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'reset' }),
    }));
    expect(host.textContent).toContain('Confirm reset?');

    const confirmButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Confirm reset?'));
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'reset' }),
    }));

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces reset failures when sync configuration is broken', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'reset') throw new Error('reset denied');
      return {
        enabled: true,
        needsSetup: true,
        remote: '(not configured)',
        branch: 'main',
        lastSync: null,
        unpushed: '?',
        conflicts: [],
        lastError: 'Remote not configured. Please re-configure sync.',
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const resetButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Reset & Re-configure'));
    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const confirmButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Confirm reset?'));
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('reset denied');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not show first-time setup when status loading fails', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockRejectedValue(new Error('server unavailable'));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Could not load sync status');
    expect(host.textContent).toContain('server unavailable');
    expect(host.textContent).not.toContain('Connect & Start Sync');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not report a stale cached status as backed up when refresh fails', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    const healthyStatus = {
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: new Date().toISOString(),
      unpushed: '0',
      conflicts: [],
      lastError: null,
      autoCommitInterval: 30,
      autoPullInterval: 300,
    };
    mockApiFetch.mockResolvedValueOnce(healthyStatus);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('All notes are backed up');

    mockApiFetch.mockRejectedValueOnce(new Error('server unavailable'));
    await act(async () => {
      root.render(<SyncTab t={messages.en} visible={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync status may be outdated');
    expect(host.textContent).toContain('server unavailable');
    expect(host.textContent).not.toContain('All notes are backed up');

    await act(async () => {
      root.unmount();
    });
  });

  it('blocks first-time setup actions when the cached unconfigured status is stale', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValueOnce({ enabled: false });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Connect & Start Sync');

    mockApiFetch.mockRejectedValueOnce(new Error('server unavailable'));
    await act(async () => {
      root.render(<SyncTab t={messages.en} visible={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync status may be outdated');
    expect(host.textContent).toContain('server unavailable');
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).not.toContain('Connect & Start Sync');

    await act(async () => {
      root.unmount();
    });
  });

  it('blocks reset actions when a cached broken sync status is stale', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockResolvedValueOnce({
      enabled: true,
      configured: true,
      needsSetup: true,
      remote: '(not configured)',
      branch: 'main',
      lastSync: null,
      unpushed: '?',
      conflicts: [],
      lastError: 'Remote not configured. Please re-configure sync.',
      autoCommitInterval: 30,
      autoPullInterval: 300,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync configuration is broken');

    mockApiFetch.mockRejectedValueOnce(new Error('status refresh failed'));
    await act(async () => {
      root.render(<SyncTab t={messages.en} visible={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync status may be outdated');
    expect(host.textContent).toContain('status refresh failed');
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).not.toContain('Reset & Re-configure');

    await act(async () => {
      root.unmount();
    });
  });

  it('enables and disables auto-sync through explicit user actions', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let enabled = false;
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'on') {
        enabled = true;
        return { ok: true, enabled: true };
      }
      if (action === 'off') {
        enabled = false;
        return { ok: true, enabled: false };
      }
      return {
        enabled,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: '2026-06-05T10:00:00.000Z',
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const enableButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Enable Auto-sync')) as HTMLButtonElement | undefined;
    expect(enableButton).toBeTruthy();

    await act(async () => {
      enableButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'on' }),
    }));
    expect(host.textContent).toContain('Auto-sync enabled');
    expect(host.textContent).toContain('Active');

    const disableButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Disable Auto-sync')) as HTMLButtonElement | undefined;
    expect(disableButton).toBeTruthy();

    await act(async () => {
      disableButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'off' }),
    }));
    expect(host.textContent).toContain('Auto-sync disabled');
    expect(host.textContent).toContain('Paused');

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces auto-sync toggle failures without changing the cached state', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'on') throw new Error('SYNC_LOCKED: Sync is already running');
      return {
        enabled: false,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: '2026-06-05T10:00:00.000Z',
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const enableButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Enable Auto-sync')) as HTMLButtonElement | undefined;

    await act(async () => {
      enableButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Sync is already running');
    expect(host.textContent).toContain('Another sync operation is already running');
    expect(host.textContent).toContain('Paused');
    expect(host.textContent).not.toContain('Active');

    await act(async () => {
      root.unmount();
    });
  });

  it('saves automation interval changes and refreshes the displayed status', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let autoCommitInterval = 30;
    let autoPullInterval = 300;
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.action === 'update-intervals') {
        if (typeof body.autoCommitInterval === 'number') autoCommitInterval = body.autoCommitInterval;
        if (typeof body.autoPullInterval === 'number') autoPullInterval = body.autoPullInterval;
        return { ok: true, autoCommitInterval, autoPullInterval };
      }
      return {
        enabled: true,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: '2026-06-05T10:00:00.000Z',
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval,
        autoPullInterval,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const autoCommitButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '30s') as HTMLButtonElement | undefined;
    const autoPullButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '5min') as HTMLButtonElement | undefined;
    expect(autoCommitButton).toBeTruthy();
    expect(autoPullButton).toBeTruthy();

    await act(async () => {
      autoCommitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(host.querySelectorAll('[role="option"]'))
        .find(option => option.textContent?.trim() === '60s')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'update-intervals', autoCommitInterval: 60 }),
    }));
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === '60s')).toBe(true);
    expect(host.textContent).toContain('Sync settings saved');

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.trim() === '5min')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(host.querySelectorAll('[role="option"]'))
        .find(option => option.textContent?.trim() === '10min')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'update-intervals', autoPullInterval: 600 }),
    }));
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === '10min')).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces automation interval save failures without moving the select value', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.action === 'update-intervals') throw new Error('interval denied');
      return {
        enabled: true,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: '2026-06-05T10:00:00.000Z',
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.trim() === '30s')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(host.querySelectorAll('[role="option"]'))
        .find(option => option.textContent?.trim() === '60s')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('interval denied');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === '30s')).toBe(true);
    expect(host.textContent).not.toContain('Sync settings saved');

    await act(async () => {
      root.unmount();
    });
  });

  it('reloads .gitignore every time the editor is reopened', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let gitignoreReads = 0;
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'gitignore-get') {
        gitignoreReads += 1;
        return { content: gitignoreReads === 1 ? 'node_modules\n' : 'dist\n' };
      }
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const toggle = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Excluded files'));
    expect(toggle).toBeTruthy();

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((host.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('node_modules\n');

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((host.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('dist\n');
    expect(gitignoreReads).toBe(2);

    await act(async () => {
      root.unmount();
    });
  });

  it('refreshes sync status after saving .gitignore so dirty changes are visible', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let statusReads = 0;
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'gitignore-get') return { content: 'node_modules\n' };
      if (action === 'gitignore-save') return { ok: true, content: 'node_modules\ndist\n*.sync-conflict\nINSTRUCTION.md\n' };
      statusReads += 1;
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: statusReads > 1 ? '1' : '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const toggle = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Excluded files'));
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    await act(async () => {
      setInputValue(textarea, 'node_modules\ndist\n');
      await Promise.resolve();
    });

    const saveButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Save'));
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(statusReads).toBeGreaterThan(1);
    expect((host.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('node_modules\ndist\n*.sync-conflict\nINSTRUCTION.md\n');
    expect(host.textContent).toContain('1 local change');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not report .gitignore save failure when only the follow-up status refresh fails', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let statusReads = 0;
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'gitignore-get') return { content: 'node_modules\n' };
      if (action === 'gitignore-save') return { ok: true, content: 'node_modules\ndist\n*.sync-conflict\nINSTRUCTION.md\n' };
      statusReads += 1;
      if (statusReads > 1) throw new Error('status refresh failed');
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const toggle = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Excluded files'));
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(host.querySelector('textarea'), 'node_modules\ndist\n');
      await Promise.resolve();
    });

    const saveButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Save'));
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((host.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('node_modules\ndist\n*.sync-conflict\nINSTRUCTION.md\n');
    expect(host.textContent).toContain('Saved');
    expect(host.textContent).toContain('Saved, but failed to refresh sync status');
    expect(host.textContent).toContain('status refresh failed');
    expect(host.textContent).not.toContain('Failed to save .gitignore');

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces conflict preview failures inline', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'conflict-preview') throw new Error('preview service failed');
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const fileButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('notes/today.md'));
    expect(fileButton).toBeTruthy();

    await act(async () => {
      fileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Failed to load conflict preview');
    expect(host.textContent).toContain('preview service failed');
    expect(host.textContent).toContain('Retry');

    await act(async () => {
      root.unmount();
    });
  });

  it('allows keeping the local file when conflict preview fails', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'conflict-preview') throw new Error('preview service failed');
      if (action === 'resolve-conflict') return { ok: true };
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const fileButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('notes/today.md'));
    await act(async () => {
      fileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const keepLocal = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep local')) as HTMLButtonElement | undefined;
    const keepRemote = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep remote')) as HTMLButtonElement | undefined;
    expect(keepLocal?.disabled).toBe(false);
    expect(keepRemote?.disabled).toBe(true);

    await act(async () => {
      keepLocal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const resolveCallsAfterFirstClick = mockApiFetch.mock.calls.filter(([, opts]) => {
      const body = (opts as { body?: string } | undefined)?.body;
      return body ? JSON.parse(body).action === 'resolve-conflict' : false;
    });
    expect(resolveCallsAfterFirstClick).toHaveLength(0);
    expect(host.textContent).toContain('Confirm keep local?');

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Confirm keep local?'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const resolveCalls = mockApiFetch.mock.calls.filter(([, opts]) => {
      const body = (opts as { body?: string } | undefined)?.body;
      return body ? JSON.parse(body).action === 'resolve-conflict' : false;
    });
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]).toEqual(['/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'resolve-conflict', file: 'notes/today.md', strategy: 'keep-local' }),
    })]);

    await act(async () => {
      root.unmount();
    });
  });

  it('does not reuse a resolved conflict preview for the next conflict row', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let conflicts = [
      { file: 'notes/a.md', time: '2026-06-05T10:00:00.000Z' },
      { file: 'notes/b.md' },
    ];
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.action === 'conflict-preview') {
        return body.file === 'notes/a.md'
          ? { local: 'local A', remote: 'remote A' }
          : { local: 'local B', remote: 'remote B' };
      }
      if (body.action === 'resolve-conflict') {
        conflicts = conflicts.filter(conflict => conflict.file !== body.file);
        return { ok: true };
      }
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts,
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstFile = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('notes/a.md'));
    await act(async () => {
      firstFile?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('local A');
    expect(host.textContent).toContain('remote A');

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Keep local'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('notes/b.md');
    expect(host.textContent).toContain('unknown');
    expect(host.textContent).not.toContain('local A');
    expect(host.textContent).not.toContain('remote A');
    expect((Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep remote')) as HTMLButtonElement | undefined)?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces conflict resolution failures and restores the action buttons', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const action = opts?.body ? JSON.parse(opts.body).action : undefined;
      if (action === 'conflict-preview') return { local: 'local text', remote: 'remote text' };
      if (action === 'resolve-conflict') throw new Error('resolve failed');
      return {
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }],
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const fileButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('notes/today.md'));
    await act(async () => {
      fileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const keepLocal = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep local'));
    expect(keepLocal?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      keepLocal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Failed to resolve conflict');
    expect(host.textContent).toContain('resolve failed');
    expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Keep local'))?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('applies the remote conflict version after a successful preview', async () => {
    const { SyncTab } = await import('@/components/settings/SyncTab');
    let conflicts = [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }];
    mockApiFetch.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.action === 'conflict-preview') return { local: 'local text', remote: 'remote text' };
      if (body.action === 'resolve-conflict') {
        conflicts = conflicts.filter(conflict => conflict.file !== body.file);
        return { ok: true };
      }
      return {
        enabled: true,
        configured: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts,
        lastError: null,
        autoCommitInterval: 30,
        autoPullInterval: 300,
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncTab t={messages.en} visible />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const fileButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('notes/today.md'));
    await act(async () => {
      fileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('local text');
    expect(host.textContent).toContain('remote text');
    const keepRemote = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Keep remote')) as HTMLButtonElement | undefined;
    expect(keepRemote?.disabled).toBe(false);

    await act(async () => {
      keepRemote?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      body: JSON.stringify({ action: 'resolve-conflict', file: 'notes/today.md', strategy: 'keep-remote' }),
    }));
    expect(host.textContent).not.toContain('notes/today.md');
    expect(host.textContent).not.toContain('Resolve conflicts to finish sync');

    await act(async () => {
      root.unmount();
    });
  });
});
