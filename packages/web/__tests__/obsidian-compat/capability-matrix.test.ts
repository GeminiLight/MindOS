import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_CAPABILITY_MATRIX,
  buildObsidianCapabilityCoverage,
  getObsidianCapability,
  summarizeObsidianCapabilityCoverage,
  summarizeObsidianCapabilitySurfaces,
} from '@/lib/obsidian-compat/capability-matrix';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

describe('Obsidian capability matrix', () => {
  it('documents every exported Obsidian shim symbol', () => {
    const exportedNames = Object.keys(createObsidianModule()).sort();

    for (const name of exportedNames) {
      expect(getObsidianCapability(name), `${name} should be documented in the capability matrix`).toBeTruthy();
    }
  });

  it('requires implemented capability rows to carry verification notes', () => {
    for (const row of OBSIDIAN_CAPABILITY_MATRIX) {
      expect(row.notes.trim().length, `${row.api} should explain its host boundary`).toBeGreaterThan(0);
      if (row.support !== 'unsupported') {
        expect(
          (row.tests?.length ?? 0) > 0 || row.notes.toLowerCase().includes('phase'),
          `${row.api} should point to tests or an explicit phase boundary`,
        ).toBe(true);
      }
    }
  });

  it('builds per-plugin coverage from analyzer API names', () => {
    const coverage = buildObsidianCapabilityCoverage({
      obsidianApis: [
        'Plugin',
        'Plugin.getSettingDefinitions',
        'Workspace.openLinkText',
        'SecretStorage',
        'Vault.getConfig',
        'Workspace.getRightLeaf',
        'registerEditorExtension',
        'registerEditorSuggest',
        'EditorSuggest',
        'Scope',
        'Commands.listCommands',
        'Workspace.iterateCodeMirrors',
        'getIconIds',
        'prepareSimpleSearch',
        'renderMatches',
        'htmlToMarkdown',
        'Notice',
        'FileSystemAdapter',
        'ImaginaryApi',
      ],
    });

    expect(coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: 'Plugin', support: 'full', surface: 'core' }),
      expect.objectContaining({ api: 'Plugin.getSettingDefinitions', support: 'catalog-only', surface: 'settings' }),
      expect.objectContaining({ api: 'Workspace.openLinkText', support: 'request-only', surface: 'workspace' }),
      expect.objectContaining({ api: 'SecretStorage', support: 'limited', surface: 'secret' }),
      expect.objectContaining({ api: 'Vault.getConfig', support: 'limited', surface: 'vault' }),
      expect.objectContaining({ api: 'Workspace.getRightLeaf', support: 'limited', surface: 'views' }),
      expect.objectContaining({ api: 'registerEditorExtension', support: 'catalog-only', surface: 'editor' }),
      expect.objectContaining({ api: 'registerEditorSuggest', support: 'catalog-only', surface: 'editor' }),
      expect.objectContaining({ api: 'EditorSuggest', support: 'catalog-only', surface: 'editor' }),
      expect.objectContaining({ api: 'Scope', support: 'catalog-only', surface: 'editor' }),
      expect.objectContaining({ api: 'Commands.listCommands', support: 'limited', surface: 'commands' }),
      expect.objectContaining({ api: 'Workspace.iterateCodeMirrors', support: 'catalog-only', surface: 'editor' }),
      expect.objectContaining({ api: 'getIconIds', support: 'limited', surface: 'core' }),
      expect.objectContaining({ api: 'prepareSimpleSearch', support: 'limited', surface: 'core' }),
      expect.objectContaining({ api: 'renderMatches', support: 'snapshot-only', surface: 'document' }),
      expect.objectContaining({ api: 'htmlToMarkdown', support: 'limited', surface: 'document' }),
      expect.objectContaining({ api: 'Notice', support: 'snapshot-only', surface: 'entries' }),
      expect.objectContaining({ api: 'FileSystemAdapter', support: 'limited', surface: 'core' }),
      expect.objectContaining({ api: 'ImaginaryApi', support: 'unsupported', surface: 'unsupported' }),
    ]));
    expect(summarizeObsidianCapabilityCoverage(coverage)).toMatchObject({
      full: 1,
      limited: 8,
      'request-only': 1,
      'catalog-only': 6,
      'snapshot-only': 2,
      unsupported: 1,
    });
  });

  it('summarizes detected APIs by MindOS surface for user-facing compatibility reports', () => {
    const coverage = buildObsidianCapabilityCoverage({
      obsidianApis: [
        'Plugin',
        'addCommand',
        'Commands.listCommands',
        'Plugin.getSettingDefinitions',
        'PluginSettingTab',
        'SecretStorage',
        'registerView',
        'MarkdownRenderer',
        'renderMatches',
        'requestUrl',
        'registerEditorExtension',
        'registerEditorSuggest',
        'EditorSuggest',
        'Workspace.iterateCodeMirrors',
        'getIconIds',
        'prepareSimpleSearch',
        'htmlToMarkdown',
      ],
    });

    expect(summarizeObsidianCapabilitySurfaces(coverage)).toEqual([
      expect.objectContaining({
        surface: 'commands',
        apiCount: 2,
        supportSummary: expect.objectContaining({ full: 1, limited: 1 }),
        apis: ['addCommand', 'Commands.listCommands'],
        routes: ['/api/obsidian-plugins'],
      }),
      expect.objectContaining({
        surface: 'settings',
        apiCount: 2,
        supportSummary: expect.objectContaining({ full: 1, 'catalog-only': 1 }),
      }),
      expect.objectContaining({
        surface: 'views',
        apiCount: 1,
        supportSummary: expect.objectContaining({ limited: 1 }),
      }),
      expect.objectContaining({
        surface: 'document',
        apiCount: 3,
        supportSummary: expect.objectContaining({ limited: 2, 'snapshot-only': 1 }),
      }),
      expect.objectContaining({
        surface: 'network',
        apiCount: 1,
        supportSummary: expect.objectContaining({ limited: 1 }),
      }),
      expect.objectContaining({
        surface: 'secret',
        apiCount: 1,
        supportSummary: expect.objectContaining({ limited: 1 }),
        apis: ['SecretStorage'],
      }),
      expect.objectContaining({
        surface: 'editor',
        apiCount: 4,
        supportSummary: expect.objectContaining({ 'catalog-only': 4 }),
      }),
      expect.objectContaining({
        surface: 'core',
        apiCount: 3,
        supportSummary: expect.objectContaining({ full: 1, limited: 2 }),
      }),
    ]);
  });
});
