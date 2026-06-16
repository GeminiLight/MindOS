import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_CAPABILITY_MATRIX,
  buildObsidianCapabilityCoverage,
  getObsidianCapability,
  summarizeObsidianCapabilityCoverage,
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
        'Workspace.openLinkText',
        'registerEditorExtension',
        'Notice',
        'FileSystemAdapter',
        'ImaginaryApi',
      ],
    });

    expect(coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: 'Plugin', support: 'full', surface: 'core' }),
      expect.objectContaining({ api: 'Workspace.openLinkText', support: 'request-only', surface: 'workspace' }),
      expect.objectContaining({ api: 'registerEditorExtension', support: 'catalog-only', surface: 'editor' }),
      expect.objectContaining({ api: 'Notice', support: 'snapshot-only', surface: 'entries' }),
      expect.objectContaining({ api: 'FileSystemAdapter', support: 'limited', surface: 'core' }),
      expect.objectContaining({ api: 'ImaginaryApi', support: 'unsupported', surface: 'unsupported' }),
    ]));
    expect(summarizeObsidianCapabilityCoverage(coverage)).toMatchObject({
      full: 1,
      limited: 1,
      'request-only': 1,
      'catalog-only': 1,
      'snapshot-only': 1,
      unsupported: 1,
    });
  });
});
