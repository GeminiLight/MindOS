// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RAIL_PREFERENCES_CHANGED_EVENT,
  readRailPreferences,
  writeRailPreference,
} from '@/lib/rail-preferences';

describe('rail preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults optional rail items off', () => {
    expect(readRailPreferences()).toEqual({ studio: false, flow: false });
  });

  it('returns a stable snapshot when preference values do not change', () => {
    const first = readRailPreferences();
    const second = readRailPreferences();

    expect(second).toBe(first);
  });

  it('persists Studio and Flow visibility independently', () => {
    writeRailPreference('studio', true);
    expect(readRailPreferences()).toEqual({ studio: true, flow: false });

    writeRailPreference('flow', true);
    expect(readRailPreferences()).toEqual({ studio: true, flow: true });

    writeRailPreference('studio', false);
    expect(readRailPreferences()).toEqual({ studio: false, flow: true });
  });

  it('notifies the rail when preferences change', () => {
    const onChanged = vi.fn();
    window.addEventListener(RAIL_PREFERENCES_CHANGED_EVENT, onChanged);

    writeRailPreference('studio', true);

    expect(onChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener(RAIL_PREFERENCES_CHANGED_EVENT, onChanged);
  });
});
