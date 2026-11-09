import { describe, expect, it } from 'vitest';
import {
  normalizeLocaleToLang,
  normalizeUiLangPreference,
  resolveUiLang,
} from './lang';
import { formatString, mainStrings, mtIn, obsidianEditorStrings } from './main-strings';
import { readFileSync } from 'fs';
import { join } from 'path';
import { zh } from './zh';
import { en } from './en';

describe('ui language resolution', () => {
  it('treats any zh-* locale as Chinese and everything else as English', () => {
    expect(normalizeLocaleToLang('zh-CN')).toBe('zh');
    expect(normalizeLocaleToLang('zh-Hant-TW')).toBe('zh');
    expect(normalizeLocaleToLang('ZH')).toBe('zh');
    expect(normalizeLocaleToLang('en-US')).toBe('en');
    expect(normalizeLocaleToLang('ja')).toBe('en');
  });

  it('falls back to English for empty, null and undefined locales', () => {
    expect(normalizeLocaleToLang('')).toBe('en');
    expect(normalizeLocaleToLang(null)).toBe('en');
    expect(normalizeLocaleToLang(undefined)).toBe('en');
  });

  it('lets an explicit preference override the system locale', () => {
    expect(resolveUiLang('en', 'zh-CN')).toBe('en');
    expect(resolveUiLang('zh', 'en-US')).toBe('zh');
  });

  it('follows the system locale when the preference is system or unset', () => {
    expect(resolveUiLang('system', 'zh-CN')).toBe('zh');
    expect(resolveUiLang(undefined, 'zh-CN')).toBe('zh');
    expect(resolveUiLang(null, 'en-GB')).toBe('en');
  });

  it('ignores unsupported stored preferences instead of trusting them', () => {
    expect(resolveUiLang('fr', 'zh-CN')).toBe('zh');
    expect(normalizeUiLangPreference('fr')).toBe('system');
    expect(normalizeUiLangPreference(42)).toBe('system');
    expect(normalizeUiLangPreference(null)).toBe('system');
    expect(normalizeUiLangPreference('zh')).toBe('zh');
  });
});

describe('main process strings', () => {
  it('has a non-empty zh and en entry for every key', () => {
    for (const [key, entry] of Object.entries(mainStrings)) {
      expect(entry.zh, `${key}.zh`).toBeTruthy();
      expect(entry.en, `${key}.en`).toBeTruthy();
    }
  });

  it('uses the same placeholder set in both languages', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, entry] of Object.entries(mainStrings)) {
      expect(placeholders(entry.zh), `${key} placeholders`).toEqual(placeholders(entry.en));
    }
  });

  it('never leaves Han characters in an English string', () => {
    for (const [key, entry] of Object.entries(mainStrings)) {
      expect(/[一-鿿]/.test(entry.en), `${key}.en contains Han characters`).toBe(false);
    }
  });

  it('interpolates named placeholders', () => {
    expect(mtIn('zh', 'useSuggestedPort', { port: 8782 })).toBe('改用端口 8782');
    expect(mtIn('en', 'useSuggestedPort', { port: 8782 })).toBe('Use port 8782');
  });

  it('leaves unknown placeholders verbatim rather than printing undefined', () => {
    expect(formatString('a {known} b {missing}', { known: 'x' })).toBe('a x b {missing}');
  });

  it('keeps multi-line port guidance as real newlines so the splash can wrap it', () => {
    const message = mtIn('en', 'portsAllInUse', { from: 3456, to: 3465, hint: 'lsof -i' });
    expect(message.split('\n')).toHaveLength(3);
    expect(message).toContain('lsof -i');
  });
});

describe('obsidian editor strings', () => {
  it('returns a fully translated chrome bundle for English', () => {
    const strings = obsidianEditorStrings('en');
    for (const [key, value] of Object.entries(strings)) {
      expect(/[一-鿿]/.test(value), `${key} still Chinese in the English bundle`).toBe(false);
    }
  });

  it('returns Chinese chrome for zh', () => {
    expect(obsidianEditorStrings('zh').saveNote).toBe('保存笔记');
  });
});

describe('house style for shell copy', () => {
  /*
    The shell's copy drifted into three styles at once: "..." next to "…",
    您 next to 你, and exclamation marks on routine success states. These keep
    the dictionaries on one style (documented at the top of zh.ts / en.ts).
  */
  const mainZh = Object.entries(mainStrings).map(([k, v]) => [k, (v as { zh: string }).zh] as const);
  const mainEn = Object.entries(mainStrings).map(([k, v]) => [k, (v as { en: string }).en] as const);
  const allZh = [...Object.entries(zh), ...mainZh];
  const allEn = [...Object.entries(en), ...mainEn];

  it('uses the ellipsis character, never three dots', () => {
    for (const [key, value] of [...allZh, ...allEn]) {
      expect(value.includes('...'), `${key}: "${value}"`).toBe(false);
    }
  });

  it('addresses the user as 你, not 您', () => {
    for (const [key, value] of allZh) {
      expect(value.includes('您'), `${key}: "${value}"`).toBe(false);
    }
  });

  it('does not shout routine states with exclamation marks', () => {
    for (const [key, value] of [...allZh, ...allEn]) {
      expect(/[!！]/.test(value), `${key}: "${value}"`).toBe(false);
    }
  });

  it('never tells the user about implementation details in the window', () => {
    // These words described how the shell works, not what the user can do.
    for (const [key, value] of Object.entries(zh)) {
      expect(/CLI|运行时|IPC/.test(value), `zh.${key}: "${value}"`).toBe(false);
    }
    for (const [key, value] of Object.entries(en)) {
      expect(/\bCLI\b|runtime|IPC/i.test(value), `en.${key}: "${value}"`).toBe(false);
    }
  });

  it('does not claim local mode needs Node.js on the mode card', () => {
    // Packaged builds bundle Node.js; for most users the old copy was untrue.
    expect(zh.localDesc).not.toContain('Node');
    expect(en.localDesc).not.toContain('Node');
  });
});

describe('house style for native menus', () => {
  // Tray and app-menu labels are inline ternaries, not dictionary entries, so
  // the checks above cannot see them. macOS menus use "…" for items that open
  // something further; the tray used "..." on some items and "…" on others.
  for (const file of ['tray.ts', 'app-menu.ts']) {
    it(`${file} uses the ellipsis character in labels`, () => {
      const source = readFileSync(join(__dirname, '..', file), 'utf-8');
      const labels = source.match(/'[^'\n]*\.\.\.'/g) ?? [];
      expect(labels).toEqual([]);
    });
  }
});
