// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT,
  OBSIDIAN_LINTER_PROFILE_STORAGE_KEY,
  parseObsidianLinterProfilePreference,
  readObsidianLinterProfilePreference,
  resetObsidianLinterProfilePreference,
  saveObsidianLinterProfilePreference,
  setObsidianLinterMaxConsecutiveBlankLines,
  setObsidianLinterRuleEnabled,
} from '@/lib/stores/obsidian-linter-profile-store';

describe('Obsidian Linter profile preference store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetObsidianLinterProfilePreference();
  });

  it('returns the default profile when no preference exists', () => {
    expect(readObsidianLinterProfilePreference()).toMatchObject({
      maxConsecutiveBlankLines: 1,
      enabledRules: {
        'heading-space': true,
        'trailing-whitespace': true,
        'hard-tab': true,
        'multiple-blank-lines': true,
        'missing-final-newline': true,
      },
    });
  });

  it('falls back safely for corrupt or non-object storage payloads', () => {
    expect(parseObsidianLinterProfilePreference('{bad json')).toMatchObject({
      maxConsecutiveBlankLines: 1,
      enabledRules: { 'trailing-whitespace': true },
    });
    expect(parseObsidianLinterProfilePreference('"not-object"')).toMatchObject({
      maxConsecutiveBlankLines: 1,
      enabledRules: { 'trailing-whitespace': true },
    });
  });

  it('normalizes persisted rules and ignores unknown or non-boolean values', () => {
    localStorage.setItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY, JSON.stringify({
      version: 1,
      enabledRules: {
        'trailing-whitespace': false,
        'hard-tab': 'false',
        unknown: false,
      },
      maxConsecutiveBlankLines: '3',
    }));

    expect(readObsidianLinterProfilePreference()).toMatchObject({
      maxConsecutiveBlankLines: 1,
      enabledRules: {
        'heading-space': true,
        'trailing-whitespace': false,
        'hard-tab': true,
        'multiple-blank-lines': true,
        'missing-final-newline': true,
      },
    });
  });

  it('persists profile updates and notifies local subscribers', () => {
    const listener = vi.fn();
    window.addEventListener(OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT, listener);

    const saved = saveObsidianLinterProfilePreference({
      enabledRules: {
        'heading-space': false,
        'missing-final-newline': false,
      },
      maxConsecutiveBlankLines: 2,
    });

    expect(saved).toMatchObject({
      maxConsecutiveBlankLines: 2,
      enabledRules: {
        'heading-space': false,
        'trailing-whitespace': true,
        'missing-final-newline': false,
      },
    });
    expect(readObsidianLinterProfilePreference()).toEqual(saved);
    expect(JSON.parse(localStorage.getItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 1,
      maxConsecutiveBlankLines: 2,
      enabledRules: {
        'heading-space': false,
        'missing-final-newline': false,
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT, listener);
  });

  it('provides targeted rule and blank-line setters plus reset', () => {
    setObsidianLinterRuleEnabled('trailing-whitespace', false);
    expect(readObsidianLinterProfilePreference().enabledRules['trailing-whitespace']).toBe(false);

    setObsidianLinterMaxConsecutiveBlankLines(3);
    expect(readObsidianLinterProfilePreference().maxConsecutiveBlankLines).toBe(3);

    resetObsidianLinterProfilePreference();
    expect(localStorage.getItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY)).toBeNull();
    expect(readObsidianLinterProfilePreference()).toMatchObject({
      maxConsecutiveBlankLines: 1,
      enabledRules: { 'trailing-whitespace': true },
    });
  });
});
