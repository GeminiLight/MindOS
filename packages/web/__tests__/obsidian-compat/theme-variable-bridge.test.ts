import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_THEME_VARIABLE_MAP,
  buildObsidianThemeBridgeCss,
  findUnmappedObsidianVariables,
  obsidianHostClassName,
  obsidianThemeClassName,
  validateObsidianThemeVariableMap,
} from '@/lib/obsidian-compat/theme-variable-bridge';

describe('Obsidian theme variable bridge', () => {
  it('ships a valid table with no duplicates and no hard-coded colors', () => {
    expect(validateObsidianThemeVariableMap()).toEqual([]);
    expect(OBSIDIAN_THEME_VARIABLE_MAP.length).toBeGreaterThan(100);
    const core = ['--background-primary', '--background-secondary', '--text-normal', '--text-muted', '--interactive-accent', '--font-interface', '--radius-m', '--layer-modal'];
    for (const name of core) {
      expect(OBSIDIAN_THEME_VARIABLE_MAP.some((entry) => entry.obsidian === name)).toBe(true);
    }
    // Every color-ish mapping must resolve through a MindOS token.
    for (const entry of OBSIDIAN_THEME_VARIABLE_MAP) {
      const colorLike = /color|background|text-|icon-color|link|tag-|shadow|divider-color|scrollbar/.test(entry.obsidian)
        && !/size|width|stroke|font-text/.test(entry.obsidian);
      if (colorLike) {
        expect(entry.value, entry.obsidian).toMatch(/var\(--|inherit|transparent/);
      }
    }
  });

  it('rejects hard-coded colors, duplicates and unsafe values', () => {
    expect(validateObsidianThemeVariableMap([
      { obsidian: '--background-primary', value: '#ffffff' },
      { obsidian: '--background-primary', value: 'var(--background)' },
      { obsidian: 'bad', value: 'var(--x)' },
      { obsidian: '--text-normal', value: 'var(--foreground); } body { display:none' },
      { obsidian: '--empty', value: '   ' },
    ])).toEqual([
      'Hard-coded color in --background-primary: #ffffff',
      'Duplicate mapping: --background-primary',
      'Invalid variable name: bad',
      'Unsafe characters in --text-normal: var(--foreground); } body { display:none',
      'Empty value: --empty',
    ]);
    expect(() => buildObsidianThemeBridgeCss('.x', [{ obsidian: '--a', value: 'rgb(0,0,0)' }])).toThrow(/invalid/);
  });

  it('emits one scoped rule with every mapping', () => {
    const css = buildObsidianThemeBridgeCss('[data-obsidian-plugin-view="calendar"]');
    expect(css.startsWith('[data-obsidian-plugin-view="calendar"] {\n')).toBe(true);
    expect(css).toContain('  --background-primary: var(--background);');
    expect(css).toContain('  --text-on-accent: var(--amber-foreground);');
    expect(css).toContain('  --layer-modal: var(--z-app-modal);');
    expect(css.trim().endsWith('}')).toBe(true);
    expect((css.match(/;\n/g) ?? []).length).toBe(OBSIDIAN_THEME_VARIABLE_MAP.length);
    expect(() => buildObsidianThemeBridgeCss('   ')).toThrow(/scope selector/);
  });

  it('reports Obsidian variables a stylesheet reads but the bridge does not define', () => {
    const css = `
      .calendar { color: var(--text-normal); background: var(--background-primary); }
      .calendar .dot { background: var(--color-pink); border-color: VAR(--custom-plugin-color, red); }
      .calendar { --custom-plugin-color: var(--text-accent); }
    `;
    expect(findUnmappedObsidianVariables(css)).toEqual(['--color-pink']);
    expect(findUnmappedObsidianVariables('')).toEqual([]);
  });

  it('exposes Obsidian structural and theme class names for host containers', () => {
    expect(obsidianHostClassName('viewContent')).toBe('view-content');
    expect(obsidianHostClassName('markdownPreview', ['mindos-extra'])).toContain('markdown-preview-view');
    expect(obsidianHostClassName('markdownPreview', ['mindos-extra'])).toMatch(/mindos-extra$/);
    expect(obsidianThemeClassName(true)).toBe('theme-dark');
    expect(obsidianThemeClassName(false)).toBe('theme-light');
  });
});
