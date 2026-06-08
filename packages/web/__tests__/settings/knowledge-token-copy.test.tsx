// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';
import { KnowledgeTab } from '@/components/settings/KnowledgeTab';
import type { SettingsData } from '@/components/settings/types';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  copyToClipboard: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('@/lib/actions', () => ({
  scanExampleFilesAction: vi.fn(async () => ({ files: [] })),
  cleanupExamplesAction: vi.fn(async () => ({ success: true, deleted: 0 })),
}));

vi.mock('@/components/FileTree', () => ({
  setShowHiddenFiles: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('KnowledgeTab auth token copy behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/setup') return { guideState: { active: false, dismissed: false } };
      if (url === '/api/settings') return { port: 4567 };
      if (url === '/api/monitoring') throw new Error('not loaded');
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });
  });

  it('does not offer copy for a masked auth token from settings GET', async () => {
    const data: SettingsData = {
      ai: { activeProvider: '', providers: [] },
      mindRoot: '/tmp/mind',
      authToken: 'abcd-••••-wxyz',
      webPassword: '',
      allowNetworkAccess: false,
      envOverrides: {},
    };
    const setData = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<KnowledgeTab data={data} setData={setData} t={messages.en} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('abcd-••••-wxyz');
    expect(host.querySelector('button[title="Copy"]')).toBeNull();
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
