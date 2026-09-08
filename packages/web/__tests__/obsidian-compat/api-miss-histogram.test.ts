import { describe, expect, it } from 'vitest';
import {
  buildObsidianApiMissHistogram,
  renderObsidianApiMissHistogramMarkdown,
} from '@/lib/obsidian-compat/api-miss-histogram';
import { classifyPluginRuntimeTier } from '@/lib/obsidian-compat/compatibility-report';
import type { ObsidianRealPluginMatrixRow } from '@/lib/obsidian-compat/real-plugin-matrix';

function row(input: {
  id: string;
  downloads?: number;
  obsidianApis?: string[];
  unsupportedApis?: string[];
  unsupportedModules?: string[];
  extraBlockers?: string[];
}): ObsidianRealPluginMatrixRow {
  const unsupportedModules = input.unsupportedModules ?? [];
  const blockers = [
    ...unsupportedModules.map((moduleName) => `Requires unsupported runtime module: ${moduleName}`),
    ...(input.extraBlockers ?? []),
  ];
  const compatibility: ObsidianRealPluginMatrixRow['compatibility'] = {
    level: blockers.length > 0 ? 'blocked' : 'partial',
    supportedApis: 0,
    partialApis: 0,
    unsupportedApis: (input.unsupportedApis ?? []).length,
    partialApiList: [],
    unsupportedApiList: input.unsupportedApis ?? [],
    blockers,
    unsupportedModules,
    runtimeTier: classifyPluginRuntimeTier({
      obsidianApis: input.obsidianApis ?? [],
      unsupportedModules,
      blockers,
    }),
  };
  return {
    id: input.id,
    ...(typeof input.downloads === 'number' ? { downloads: input.downloads } : {}),
    compatibility,
  } as unknown as ObsidianRealPluginMatrixRow;
}

describe('buildObsidianApiMissHistogram', () => {
  it('weights misses by downloads, tags them by tier and counts each plugin once per key', () => {
    const histogram = buildObsidianApiMissHistogram({
      generatedAt: '2026-09-08T00:00:00.000Z',
      targetSet: 'test-top',
      plugins: [
        row({ id: 'templater', downloads: 4_000, unsupportedModules: ['child_process', '@codemirror/state'], obsidianApis: ['registerEditorExtension'] }),
        row({ id: 'dataview', downloads: 3_000, unsupportedModules: ['@codemirror/state', '@codemirror/view'], obsidianApis: ['registerMarkdownCodeBlockProcessor'] }),
        row({ id: 'calendar', downloads: 2_000, obsidianApis: ['registerView', 'addCommand'] }),
        row({ id: 'style-settings', downloads: 1_000, unsupportedApis: ['CustomCss.readSnippets'] }),
        row({ id: 'dynamic', unsupportedModules: ['some-third-party'], extraBlockers: ['Uses dynamic require(), which the MindOS Obsidian runtime cannot safely resolve.'] }),
      ],
    });

    expect(histogram.pluginCount).toBe(5);
    expect(histogram.totalDownloads).toBe(10_000);
    expect(histogram.byRequiredTier.native).toMatchObject({ plugins: 1, downloads: 4_000, pluginIds: ['templater'] });
    expect(histogram.byRequiredTier.browser).toMatchObject({ plugins: 2, downloads: 5_000, pluginIds: ['dataview', 'calendar'] });
    expect(histogram.byRequiredTier.server).toMatchObject({ plugins: 2, downloads: 1_000, pluginIds: ['style-settings', 'dynamic'] });
    expect(histogram.loadsInServerTier).toMatchObject({ plugins: 2, downloads: 3_000, pluginIds: ['calendar', 'style-settings'] });

    const codemirrorState = histogram.entries.find((entry) => entry.key === '@codemirror/state');
    expect(codemirrorState).toMatchObject({ kind: 'module', tier: 'browser', plugins: 2, downloads: 7_000, pluginIds: ['templater', 'dataview'] });
    expect(histogram.entries[0]?.key).toBe('@codemirror/state');

    expect(histogram.entries.find((entry) => entry.key === 'child_process')).toMatchObject({ tier: 'native', plugins: 1, downloads: 4_000 });
    expect(histogram.entries.find((entry) => entry.key === 'registerView')).toMatchObject({ kind: 'api', tier: 'browser', plugins: 1, downloads: 2_000 });
    expect(histogram.entries.find((entry) => entry.key === 'CustomCss.readSnippets')).toMatchObject({ kind: 'api', tier: 'server-shim' });
    expect(histogram.entries.find((entry) => entry.key === 'some-third-party')).toMatchObject({ kind: 'module', tier: 'unknown', downloads: 0 });
    expect(histogram.entries.find((entry) => entry.kind === 'blocker')).toMatchObject({ tier: 'browser', plugins: 1 });
    // addCommand is supported in the server tier and must not appear as a miss.
    expect(histogram.entries.some((entry) => entry.key === 'addCommand')).toBe(false);

    const browserStep = histogram.unlockPlan.find((step) => step.tier === 'browser');
    expect(browserStep?.unlocks.plugins).toBe(2);
    expect(browserStep?.keys[0]).toBe('@codemirror/state');
    expect(browserStep?.keys).toEqual(expect.arrayContaining(['@codemirror/view', 'registerEditorExtension', 'registerView']));
    expect(browserStep?.keys).not.toContain('child_process');
    const serverStep = histogram.unlockPlan.find((step) => step.tier === 'server');
    expect(serverStep?.keys).toContain('CustomCss.readSnippets');
  });

  it('handles an empty matrix and missing download stats without NaN', () => {
    const histogram = buildObsidianApiMissHistogram({ generatedAt: 'now', targetSet: 'empty', plugins: [] });
    expect(histogram.pluginCount).toBe(0);
    expect(histogram.totalDownloads).toBe(0);
    expect(histogram.entries).toEqual([]);
    expect(histogram.unlockPlan).toHaveLength(3);

    const markdown = renderObsidianApiMissHistogramMarkdown(histogram);
    expect(markdown).toContain('| server | 0 | 0 | 0% |');
    expect(markdown).not.toContain('NaN');
  });

  it('caps example plugin ids and renders a stable markdown report', () => {
    const plugins = Array.from({ length: 20 }, (_, index) => row({
      id: `plugin-${String(index).padStart(2, '0')}`,
      downloads: 1_000 - index,
      unsupportedModules: ['@codemirror/view'],
    }));
    const histogram = buildObsidianApiMissHistogram({ generatedAt: 'now', targetSet: 'many', plugins }, { maxPluginIdsPerEntry: 3 });
    expect(histogram.entries[0]).toMatchObject({ key: '@codemirror/view', plugins: 20, pluginIds: ['plugin-00', 'plugin-01', 'plugin-02'] });

    const markdown = renderObsidianApiMissHistogramMarkdown(histogram, { maxEntries: 1 });
    expect(markdown).toContain('# Obsidian API Miss Histogram');
    expect(markdown).toContain('| `@codemirror/view` | module | browser | 20 |');
    expect(markdown).toContain('### browser: Browser tier');
    expect(markdown.endsWith('\n')).toBe(true);
  });
});
