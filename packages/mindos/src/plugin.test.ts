import { describe, expect, it } from 'vitest';
import { defineMindosPlugin, validateMindosPluginManifest } from './plugin/index.js';

describe('MindOS plugin contract', () => {
  it('defines valid plugin manifests with permissions and tools', () => {
    const plugin = defineMindosPlugin({
      id: 'example.plugin',
      name: 'Example',
      version: '1.0.0',
      permissions: [{ id: 'files.read', description: 'Read files', default: 'ask' }],
      tools: [{ id: 'read-note', description: 'Read a note', permission: 'files.read' }],
    });

    expect(plugin.manifest.id).toBe('example.plugin');
  });

  it('rejects tool permissions not declared by the plugin', () => {
    expect(validateMindosPluginManifest({
      id: 'bad',
      name: 'Bad',
      version: '1.0.0',
      tools: [{ id: 'tool', description: 'Tool', permission: 'missing' }],
    })).toContain('tool "tool" references unknown permission "missing"');
  });
});
