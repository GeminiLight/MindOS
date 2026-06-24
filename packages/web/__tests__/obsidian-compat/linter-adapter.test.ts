import { describe, expect, it } from 'vitest';
import { validateBrowserEditorSandboxContributions } from '@/lib/obsidian-compat/browser-editor-sandbox';
import {
  applyObsidianLinterFixes,
  buildObsidianLinterSandboxContributions,
  getObsidianLinterRuleMetadata,
  normalizeObsidianLinterRuleProfile,
  OBSIDIAN_LINTER_RULE_METADATA,
  previewObsidianLinterFixes,
  type ObsidianLinterAdapterRuleId,
} from '@/lib/obsidian-compat/linter-adapter';

describe('Obsidian Linter declarative adapter', () => {
  it('exposes a stable rule metadata catalog for UI and profile controls', () => {
    expect(OBSIDIAN_LINTER_RULE_METADATA.map((rule) => rule.id)).toEqual([
      'heading-space',
      'trailing-whitespace',
      'hard-tab',
      'multiple-blank-lines',
      'missing-final-newline',
    ]);
    expect(getObsidianLinterRuleMetadata('heading-space')).toMatchObject({
      label: 'heading spacing',
      severity: 'warning',
      fixable: true,
      defaultEnabled: true,
    });
    expect(getObsidianLinterRuleMetadata('missing-final-newline')).toMatchObject({
      label: 'final newline',
      severity: 'info',
      fixable: true,
      defaultEnabled: true,
    });
    expect(normalizeObsidianLinterRuleProfile().enabledRules).toEqual(
      Object.fromEntries(OBSIDIAN_LINTER_RULE_METADATA.map((rule) => [rule.id, rule.defaultEnabled])),
    );
  });

  it('maps common markdown formatting issues to MindOS-signed editor sandbox contributions', () => {
    const markdown = [
      '#Title',
      'alpha  ',
      '\tindented',
      '',
      '',
      'tail',
    ].join('\n');

    const result = buildObsidianLinterSandboxContributions(markdown);

    expect(result.pluginId).toBe('obsidian-linter');
    expect(result.issues.map((issue) => [issue.ruleId, issue.line])).toEqual([
      ['heading-space', 1],
      ['trailing-whitespace', 2],
      ['hard-tab', 3],
      ['multiple-blank-lines', 5],
      ['missing-final-newline', 6],
    ]);
    expect(result.contributions).toEqual([
      expect.objectContaining({
        id: 'obsidian-linter:heading-space:1',
        pluginId: 'obsidian-linter',
        source: 'mindos-signed',
        kind: 'range-highlight',
        tone: 'warning',
      }),
      expect.objectContaining({
        id: 'obsidian-linter:trailing-whitespace:2',
        kind: 'range-highlight',
        tone: 'warning',
      }),
      expect.objectContaining({
        id: 'obsidian-linter:hard-tab:3',
        kind: 'range-highlight',
        tone: 'warning',
      }),
      expect.objectContaining({
        id: 'obsidian-linter:multiple-blank-lines:5',
        kind: 'line-highlight',
        line: 5,
        tone: 'muted',
      }),
      expect.objectContaining({
        id: 'obsidian-linter:missing-final-newline:6',
        kind: 'line-highlight',
        line: 6,
        tone: 'muted',
      }),
    ]);

    const validation = validateBrowserEditorSandboxContributions(result.contributions, {
      documentLength: markdown.length,
      lineCount: markdown.split('\n').length,
    });
    expect(validation.rejected).toEqual([]);
    expect(validation.accepted).toHaveLength(result.contributions.length);
  });

  it('keeps adapter output bounded and reports skipped issues instead of overflowing the editor host', () => {
    const markdown = ['a  ', 'b  ', 'c  ', 'd  '].join('\n');

    const result = buildObsidianLinterSandboxContributions(markdown, { maxIssues: 2 });

    expect(result.issues).toHaveLength(2);
    expect(result.contributions).toHaveLength(2);
    expect(result.skipped).toEqual([
      { reason: 'max-issues', count: 3 },
    ]);
  });

  it('supports a custom plugin id and rule selection without producing executable payloads', () => {
    const enabledRules: Partial<Record<ObsidianLinterAdapterRuleId, boolean>> = {
      'trailing-whitespace': false,
      'missing-final-newline': false,
    };
    const result = buildObsidianLinterSandboxContributions('#Title  ', {
      pluginId: 'markdown-lint-preview',
      enabledRules,
    });

    expect(result.issues.map((issue) => issue.ruleId)).toEqual(['heading-space']);
    expect(result.contributions).toEqual([
      expect.objectContaining({
        pluginId: 'markdown-lint-preview',
        permissionGrant: {
          scope: 'browser-editor-sandbox',
          grantedBy: 'mindos',
          permissions: ['editor.read', 'editor.decorations'],
          grantId: 'markdown-lint-preview:linter-adapter',
        },
      }),
    ]);
    expect(JSON.stringify(result.contributions)).not.toContain('function');
  });

  it('normalizes rule profiles while preserving explicit disabled rules', () => {
    const profile = normalizeObsidianLinterRuleProfile({
      maxConsecutiveBlankLines: 2,
      enabledRules: {
        'hard-tab': false,
        'missing-final-newline': false,
      },
    });

    expect(profile.maxConsecutiveBlankLines).toBe(2);
    expect(profile.enabledRules).toMatchObject({
      'heading-space': true,
      'trailing-whitespace': true,
      'hard-tab': false,
      'multiple-blank-lines': true,
      'missing-final-newline': false,
    });
  });

  it('applies safe markdown fixes through the MindOS-owned adapter', () => {
    const markdown = [
      '#Title',
      'alpha  ',
      '\tindented',
      '',
      '',
      'tail',
    ].join('\n');

    const result = applyObsidianLinterFixes(markdown);

    expect(result.markdown).toBe([
      '# Title',
      'alpha',
      '  indented',
      '',
      'tail',
      '',
    ].join('\n'));
    expect(result.applied).toEqual([
      { ruleId: 'heading-space', count: 1 },
      { ruleId: 'trailing-whitespace', count: 1 },
      { ruleId: 'hard-tab', count: 1 },
      { ruleId: 'multiple-blank-lines', count: 1 },
      { ruleId: 'missing-final-newline', count: 1 },
    ]);
  });

  it('respects profile overrides when applying fixes', () => {
    const markdown = '#Title  \n\tindented';

    const result = applyObsidianLinterFixes(markdown, {
      profile: {
        enabledRules: {
          'heading-space': false,
          'hard-tab': false,
          'missing-final-newline': false,
        },
      },
    });

    expect(result.markdown).toBe('#Title\n\tindented');
    expect(result.applied).toEqual([
      { ruleId: 'trailing-whitespace', count: 1 },
    ]);
  });

  it('previews fix counts without mutating clean markdown', () => {
    const dirty = previewObsidianLinterFixes('#Title  \n');
    expect(dirty.changed).toBe(true);
    expect(dirty.fixCount).toBe(2);
    expect(dirty.markdown).toBe('# Title\n');

    const clean = previewObsidianLinterFixes('# Title\n');
    expect(clean.changed).toBe(false);
    expect(clean.fixCount).toBe(0);
    expect(clean.applied).toEqual([]);
  });
});
