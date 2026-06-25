import { describe, expect, it } from 'vitest';
import {
  buildImportedObsidianLinterProfile,
  parseImportedObsidianLinterProfileJson,
} from '@/lib/obsidian-compat/linter-settings-profile';

describe('Obsidian Linter settings profile import', () => {
  it('maps known Obsidian Linter data.json rule enabled flags into a MindOS profile', () => {
    const sourceData = {
      ruleConfigs: {
        'trailing-spaces': { enabled: false, twoSpaceLineBreak: true },
        'consecutive-blank-lines': { enabled: false },
        'line-break-at-document-end': { enabled: true },
        'yaml-title': { enabled: false },
      },
    };

    const result = buildImportedObsidianLinterProfile('obsidian-linter', sourceData);

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: 'obsidian-linter-data-json',
      pluginId: 'obsidian-linter',
      mappedRules: ['trailing-whitespace', 'multiple-blank-lines', 'missing-final-newline'],
      ignoredRules: ['yaml-title'],
      warnings: ['Ignored ruleConfigs.trailing-spaces.twoSpaceLineBreak: MindOS currently imports only the rule enabled state.'],
      profile: {
        maxConsecutiveBlankLines: 1,
        enabledRules: {
          'heading-space': true,
          'trailing-whitespace': false,
          'hard-tab': true,
          'multiple-blank-lines': false,
          'missing-final-newline': true,
        },
      },
    });
    expect(sourceData.ruleConfigs['trailing-spaces'].enabled).toBe(false);
  });

  it('ignores non-linter plugins, invalid data, and non-boolean enabled values', () => {
    expect(buildImportedObsidianLinterProfile('quickadd', {
      ruleConfigs: { 'trailing-spaces': { enabled: false } },
    })).toBeNull();
    expect(buildImportedObsidianLinterProfile('obsidian-linter', null)).toBeNull();
    expect(buildImportedObsidianLinterProfile('obsidian-linter', { ruleConfigs: [] })).toBeNull();
    expect(buildImportedObsidianLinterProfile('obsidian-linter', {
      ruleConfigs: {
        'trailing-spaces': { enabled: 'false' },
        'consecutive-blank-lines': {},
      },
    })).toBeNull();
  });

  it('parses raw data.json safely', () => {
    expect(parseImportedObsidianLinterProfileJson('obsidian-linter', '{bad json')).toBeNull();
    expect(parseImportedObsidianLinterProfileJson('obsidian-linter', JSON.stringify({
      ruleConfigs: {
        'line-break-at-document-end': { enabled: false },
      },
    }))).toMatchObject({
      mappedRules: ['missing-final-newline'],
      profile: {
        enabledRules: {
          'missing-final-newline': false,
        },
      },
    });
  });
});
