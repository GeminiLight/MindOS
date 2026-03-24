import { describe, expect, it } from 'vitest';
import {
  getEffectiveMindRootFromConfig,
  localBrowseNeedsSetupWizard,
  shouldSeedWebSetupPendingForLocal,
} from './mindos-desktop-config';

describe('getEffectiveMindRootFromConfig', () => {
  it('prefers mindRoot over sopRoot', () => {
    expect(
      getEffectiveMindRootFromConfig({ mindRoot: '/a', sopRoot: '/b' }),
    ).toBe('/a');
  });

  it('falls back to sopRoot', () => {
    expect(getEffectiveMindRootFromConfig({ sopRoot: '/legacy' })).toBe('/legacy');
  });

  it('trims whitespace', () => {
    expect(getEffectiveMindRootFromConfig({ mindRoot: '  /x  ' })).toBe('/x');
  });

  it('treats empty string as unset', () => {
    expect(getEffectiveMindRootFromConfig({ mindRoot: '   ' })).toBe('');
  });
});

describe('localBrowseNeedsSetupWizard', () => {
  it('true when setupPending', () => {
    expect(localBrowseNeedsSetupWizard({ setupPending: true, mindRoot: '/ok' })).toBe(true);
  });

  it('false when no mindRoot if setupPending is not true', () => {
    expect(localBrowseNeedsSetupWizard({ desktopMode: 'local' })).toBe(false);
  });

  it('false when mindRoot set and not setupPending', () => {
    expect(localBrowseNeedsSetupWizard({ mindRoot: '/kb', setupPending: false })).toBe(false);
  });

  it('false when only sopRoot set (legacy)', () => {
    expect(localBrowseNeedsSetupWizard({ sopRoot: '/old' })).toBe(false);
  });
});

describe('shouldSeedWebSetupPendingForLocal', () => {
  it('false for remote', () => {
    expect(shouldSeedWebSetupPendingForLocal('remote', {})).toBe(false);
  });

  it('false for local with empty roots (Next defaults mind root; do not force setupPending)', () => {
    expect(shouldSeedWebSetupPendingForLocal('local', {})).toBe(false);
  });

  it('true for local when setupPending already true', () => {
    expect(shouldSeedWebSetupPendingForLocal('local', { setupPending: true })).toBe(true);
  });
});
