import { describe, expect, it } from 'vitest';
import { toRendererPluginManifest, type RendererDefinition } from '@/lib/renderers/registry';
import { manifest as agentInspector } from '@/components/renderers/agent-inspector/manifest';
import { manifest as audio } from '@/components/renderers/audio/manifest';
import { manifest as backlinks } from '@/components/renderers/backlinks/manifest';
import { manifest as changeLog } from '@/components/renderers/change-log/manifest';
import { manifest as config } from '@/components/renderers/config/manifest';
import { manifest as csv } from '@/components/renderers/csv/manifest';
import { manifest as graph } from '@/components/renderers/graph/manifest';
import { manifest as image } from '@/components/renderers/image/manifest';
import { manifest as pdf } from '@/components/renderers/pdf/manifest';
import { manifest as summary } from '@/components/renderers/summary/manifest';
import { manifest as timeline } from '@/components/renderers/timeline/manifest';
import { manifest as todo } from '@/components/renderers/todo/manifest';
import { manifest as video } from '@/components/renderers/video/manifest';
import { manifest as workflowYaml } from '@/components/renderers/workflow-yaml/manifest';

const rendererManifests: RendererDefinition[] = [
  agentInspector,
  audio,
  backlinks,
  changeLog,
  config,
  csv,
  graph,
  image,
  pdf,
  summary,
  timeline,
  todo,
  video,
  workflowYaml,
];

describe('built-in renderer plugin manifests', () => {
  it('converts every renderer definition to an Obsidian-compatible manifest', () => {
    for (const renderer of rendererManifests) {
      const manifest = toRendererPluginManifest(renderer);

      expect(manifest).toMatchObject({
        id: renderer.id,
        name: renderer.name,
        description: renderer.description,
        author: renderer.author,
        isDesktopOnly: false,
      });
      expect(manifest.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(manifest.id).not.toContain('obsidian');
      expect(manifest.id.endsWith('plugin')).toBe(false);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('preserves Obsidian fundingUrl object syntax for built-in extension manifests', () => {
    const manifest = toRendererPluginManifest({
      ...backlinks,
      fundingUrl: {
        Sponsor: 'https://example.com/sponsor',
        GitHub: 'https://github.com/sponsors/example',
      },
    });

    expect(manifest.fundingUrl).toEqual({
      Sponsor: 'https://example.com/sponsor',
      GitHub: 'https://github.com/sponsors/example',
    });
  });
});
