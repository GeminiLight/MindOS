import { describe, expect, it } from 'vitest';
import { registerRenderer, getPluginRenderers } from '@/lib/renderers/registry';
import { manifest as todoManifest } from '@/components/renderers/todo/manifest';
import { manifest as workflowYamlManifest } from '@/components/renderers/workflow-yaml/manifest';
import type { RendererDefinition } from '@/lib/renderers/registry';

function makeTestRenderer(id: string, appBuiltinFeature?: boolean): RendererDefinition {
  return {
    id,
    name: id,
    description: 'test renderer',
    author: 'test',
    icon: '🧪',
    tags: ['test'],
    builtin: true,
    appBuiltinFeature,
    match: () => false,
  };
}

describe('plugin renderer filtering', () => {
  it('excludes app-builtin renderers from plugin surface (normal path)', () => {
    registerRenderer(todoManifest);
    const pluginIds = getPluginRenderers().map((r) => r.id);
    expect(pluginIds).not.toContain('todo');
  });

  it('excludes workflow-yaml builtin renderer from plugin surface', () => {
    registerRenderer(workflowYamlManifest);
    const pluginIds = getPluginRenderers().map((r) => r.id);
    expect(pluginIds).not.toContain('workflow-yaml');
  });

  it('includes non-app-builtin renderers in plugin surface (boundary: appBuiltinFeature undefined)', () => {
    const id = 'test-plugin-surface-renderer';
    registerRenderer(makeTestRenderer(id));
    const pluginIds = getPluginRenderers().map((r) => r.id);
    expect(pluginIds).toContain(id);
  });

  it('keeps plugin list stable when duplicate id registration is attempted (error path)', () => {
    const id = 'test-duplicate-renderer';
    registerRenderer(makeTestRenderer(id, false));
    registerRenderer(makeTestRenderer(id, false));
    const pluginIds = getPluginRenderers().filter((r) => r.id === id);
    expect(pluginIds.length).toBe(1);
  });
});

