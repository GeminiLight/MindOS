// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/components/MarkdownView';

const pluginMocks = vi.hoisted(() => ({
  fetchPluginSurfaces: vi.fn(),
  fetchPluginMarkdownCodeBlockSnapshots: vi.fn(),
  fetchPluginMarkdownPostProcessorSnapshots: vi.fn(),
}));

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginSurfaces: pluginMocks.fetchPluginSurfaces,
  fetchPluginMarkdownCodeBlockSnapshots: pluginMocks.fetchPluginMarkdownCodeBlockSnapshots,
  fetchPluginMarkdownPostProcessorSnapshots: pluginMocks.fetchPluginMarkdownPostProcessorSnapshots,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('MarkdownView plugin-surface stability', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    pluginMocks.fetchPluginSurfaces.mockReset();
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockReset().mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockReset().mockResolvedValue([]);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  it('does not remount rendered markdown when no plugin surfaces exist', async () => {
    const surfaces = deferred<unknown[]>();
    pluginMocks.fetchPluginSurfaces.mockReturnValue(surfaces.promise);

    await act(async () => { root.render(<MarkdownView content={'# Title\n\nSome text'} />); });
    await flush();

    const heading = host.querySelector('h1');
    expect(heading?.textContent).toBe('Title');
    const paragraph = host.querySelector('p');
    expect(paragraph?.textContent).toBe('Some text');

    surfaces.resolve([]);
    await flush();
    await flush();

    // The empty surfaces result must not replace the component map and remount the tree.
    expect(host.querySelector('h1')).toBe(heading);
    expect(heading?.isConnected).toBe(true);
    expect(host.querySelector('p')).toBe(paragraph);
  });
});
