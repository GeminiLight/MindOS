import { describe, expect, it } from 'vitest';
import {
  getObsidianImportSupport,
  isObsidianPluginImportable,
  type ObsidianImportPolicyPlugin,
} from '@/lib/obsidian-compat/import-policy';

function plugin(
  compatibilityLevel: ObsidianImportPolicyPlugin['compatibilityLevel'],
  overrides: Partial<ObsidianImportPolicyPlugin> = {},
): ObsidianImportPolicyPlugin {
  return {
    compatibilityLevel,
    compatibility: {
      partialApis: [],
      unsupportedApis: [],
      blockers: [],
      ...overrides.compatibility,
    },
    obsidianConfig: overrides.obsidianConfig,
  };
}

describe('obsidian import policy', () => {
  it('selects compatible and limited-host partial plugins by default', () => {
    const ready = getObsidianImportSupport(plugin('compatible'));
    const limited = getObsidianImportSupport(plugin('partial', {
      compatibility: {
        partialApis: ['registerMarkdownCodeBlockProcessor'],
        unsupportedApis: [],
        blockers: [],
      },
    }));

    expect(ready).toMatchObject({ kind: 'ready', importable: true, defaultSelected: true, label: 'Ready' });
    expect(limited).toMatchObject({ kind: 'limited', importable: true, defaultSelected: true, label: 'Limited' });
    expect(limited.reason).toContain('safe MindOS hosts');
  });

  it('keeps unsupported partial plugins importable but not selected by default', () => {
    const review = getObsidianImportSupport(plugin('partial', {
      compatibility: {
        partialApis: ['registerView'],
        unsupportedApis: ['FileSystemAdapter'],
        blockers: [],
      },
    }));

    expect(review).toMatchObject({ kind: 'review', importable: true, defaultSelected: false, label: 'Review' });
    expect(review.reason).toContain('FileSystemAdapter');
  });

  it('honors the source vault enabled list when choosing defaults', () => {
    const disabledInSource = getObsidianImportSupport(plugin('compatible', {
      obsidianConfig: { enabledInObsidian: false },
    }), { hasEnabledList: true });
    const enabledLimited = getObsidianImportSupport(plugin('partial', {
      compatibility: {
        partialApis: ['registerMarkdownCodeBlockProcessor'],
        unsupportedApis: [],
        blockers: [],
      },
      obsidianConfig: { enabledInObsidian: true },
    }), { hasEnabledList: true });

    expect(disabledInSource.defaultSelected).toBe(false);
    expect(enabledLimited.defaultSelected).toBe(true);
  });

  it('blocks only plugins with blocking compatibility results', () => {
    const blocked = plugin('blocked', {
      compatibility: {
        partialApis: [],
        unsupportedApis: [],
        blockers: ['Requires unsupported runtime module: electron'],
      },
    });

    expect(isObsidianPluginImportable(blocked)).toBe(false);
    expect(getObsidianImportSupport(blocked)).toMatchObject({
      kind: 'blocked',
      importable: false,
      defaultSelected: false,
      label: 'Blocked',
    });
  });
});
