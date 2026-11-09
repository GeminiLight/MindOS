import { describe, expect, it } from 'vitest';
import {
  SHELL_BACKGROUND,
  backgroundColorFor,
  normalizeUiThemePreference,
  resolveUiTheme,
} from './ui-theme';

describe('shell appearance resolution', () => {
  it('lets an explicit preference win over the OS', () => {
    expect(resolveUiTheme('light', true)).toBe('light');
    expect(resolveUiTheme('dark', false)).toBe('dark');
  });

  it('follows the OS when the preference is system or unset', () => {
    expect(resolveUiTheme('system', true)).toBe('dark');
    expect(resolveUiTheme('system', false)).toBe('light');
    expect(resolveUiTheme(undefined, true)).toBe('dark');
    expect(resolveUiTheme(null, false)).toBe('light');
  });

  it('ignores unsupported stored values instead of trusting them', () => {
    expect(resolveUiTheme('sepia', true)).toBe('dark');
    expect(normalizeUiThemePreference('sepia')).toBe('system');
    expect(normalizeUiThemePreference(0)).toBe('system');
    expect(normalizeUiThemePreference(null)).toBe('system');
    expect(normalizeUiThemePreference('dark')).toBe('dark');
  });

  it('paints the backdrop the page is about to use', () => {
    // A hardcoded light backdrop gave dark-mode users a white flash on every
    // launch — the exact thing backgroundColor exists to prevent.
    expect(backgroundColorFor('dark')).toBe('#131210');
    expect(backgroundColorFor('light')).toBe('#f8f6f1');
  });

  it('keeps the backdrop in step with the Web app background tokens', () => {
    // packages/web/app/layout.tsx inlines these same two values before paint.
    expect(SHELL_BACKGROUND.light).toBe('#f8f6f1');
    expect(SHELL_BACKGROUND.dark).toBe('#131210');
  });
});
