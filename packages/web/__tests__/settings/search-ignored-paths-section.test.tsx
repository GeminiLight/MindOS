// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchIgnoredPathsSection } from '@/components/settings/SearchIgnoredPathsSection';
import type { SettingsData } from '@/components/settings/types';
import { messages } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  valueSetter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function makeSettings(): SettingsData {
  return {
    ai: { activeProvider: '', providers: [] },
    mindRoot: '/tmp/mind',
    searchIgnoredPaths: ['Archive'],
    envOverrides: {},
  };
}

describe('SearchIgnoredPathsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockResolvedValue({});
  });

  it('saves normalized custom search ignore paths through the settings patch contract', async () => {
    const data = makeSettings();
    const setData = vi.fn((updater: React.SetStateAction<SettingsData | null>) => {
      if (typeof updater === 'function') updater(data);
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SearchIgnoredPathsSection data={data} setData={setData} t={messages.en} />);
    });

    const textarea = host.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'Archive/\nDrafts\n../bad\n# comment\nArchive');
    });

    const saveButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Save'))!;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchIgnoredPaths: ['Archive', 'Drafts'] }),
    });
    expect(setData).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
