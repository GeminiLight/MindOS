// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { messages } from '@/lib/i18n';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

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
});
