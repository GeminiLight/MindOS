import { describe, expect, it } from 'vitest';
import { validateBrowserEditorSandboxContributions } from '@/lib/obsidian-compat/browser-editor-sandbox';
import {
  buildObsidianLinterSandboxContributions,
  type ObsidianLinterAdapterRuleId,
} from '@/lib/obsidian-compat/linter-adapter';

describe('Obsidian Linter declarative adapter', () => {
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
});
