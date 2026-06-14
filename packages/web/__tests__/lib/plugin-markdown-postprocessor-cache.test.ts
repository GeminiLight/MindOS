import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPluginMarkdownPostProcessorCacheForTests,
  fetchPluginMarkdownPostProcessorSnapshots,
} from '@/lib/plugins/client';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

describe('plugin markdown post-processor snapshots cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPluginMarkdownPostProcessorCacheForTests();
  });

  it('reuses one in-flight/cached snapshot request for the same markdown and source path', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      renders: [
        { processorId: 'outline:1', pluginId: 'outline', pluginName: 'Outline', text: 'Outline snapshot' },
      ],
    });

    const first = fetchPluginMarkdownPostProcessorSnapshots('# Title', 'note.md');
    const second = fetchPluginMarkdownPostProcessorSnapshots('# Title', 'note.md');

    await expect(first).resolves.toEqual([
      { processorId: 'outline:1', pluginId: 'outline', pluginName: 'Outline', text: 'Outline snapshot' },
    ]);
    await expect(second).resolves.toEqual([
      { processorId: 'outline:1', pluginId: 'outline', pluginName: 'Outline', text: 'Outline snapshot' },
    ]);
    await expect(fetchPluginMarkdownPostProcessorSnapshots('# Title', 'note.md')).resolves.toHaveLength(1);

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('does not reuse snapshots across different markdown bodies', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ ok: true, renders: [] })
      .mockResolvedValueOnce({
        ok: true,
        renders: [
          { processorId: 'outline:2', pluginId: 'outline', pluginName: 'Outline', text: 'Changed outline' },
        ],
      });

    await fetchPluginMarkdownPostProcessorSnapshots('# Title', 'note.md');
    await expect(fetchPluginMarkdownPostProcessorSnapshots('# Changed', 'note.md')).resolves.toEqual([
      { processorId: 'outline:2', pluginId: 'outline', pluginName: 'Outline', text: 'Changed outline' },
    ]);

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });
});
