import { describe, expect, it } from 'vitest';
import { pickMindOsRuntime, type MindOsRuntimePickInput } from './mindos-runtime-pick';

const base = (): MindOsRuntimePickInput => ({
  policy: 'prefer-newer',
  overrideRoot: null,
  overrideVersion: null,
  bundledRoot: '/b',
  bundledVersion: '0.5.0',
  bundledRunnable: true,
  userRoot: '/u',
  userVersion: '0.5.0',
  userRunnable: true,
  minUserVersion: null,
  maxTestedUserVersion: null,
  strictCompat: false,
});

describe('pickMindOsRuntime', () => {
  it('returns override when set regardless of policy', () => {
    const r = pickMindOsRuntime({
      ...base(),
      policy: 'bundled-only',
      overrideRoot: '/o',
      overrideVersion: '1.0.0',
    });
    expect(r).toEqual({ projectRoot: '/o', source: 'override', version: '1.0.0' });
  });

  it('bundled-only uses bundled when runnable', () => {
    const r = pickMindOsRuntime({ ...base(), policy: 'bundled-only' });
    expect(r.projectRoot).toBe('/b');
    expect(r.source).toBe('bundled');
  });

  it('bundled-only returns none when bundled not runnable', () => {
    const r = pickMindOsRuntime({ ...base(), policy: 'bundled-only', bundledRunnable: false });
    expect(r.projectRoot).toBeNull();
    expect(r.reason).toBe('bundled-only-missing');
  });

  it('user-only returns user when adoption allowed', () => {
    const r = pickMindOsRuntime({ ...base(), policy: 'user-only' });
    expect(r.projectRoot).toBe('/u');
    expect(r.source).toBe('user');
  });

  it('user-only fails when user not runnable (no silent bundled)', () => {
    const r = pickMindOsRuntime({
      ...base(),
      policy: 'user-only',
      userRunnable: false,
      bundledRunnable: true,
    });
    expect(r.projectRoot).toBeNull();
    expect(r.reason).toBe('user-not-runnable');
  });

  it('prefer-newer chooses user when semver greater', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userVersion: '0.6.0',
      bundledVersion: '0.5.0',
    });
    expect(r.source).toBe('user');
    expect(r.version).toBe('0.6.0');
  });

  it('prefer-newer chooses bundled when user semver lower', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userVersion: '0.4.0',
      bundledVersion: '0.5.0',
    });
    expect(r.source).toBe('bundled');
    expect(r.projectRoot).toBe('/b');
  });

  it('prefer-newer equal semver prefers user', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userVersion: '0.5.0',
      bundledVersion: '0.5.0',
    });
    expect(r.source).toBe('user');
    expect(r.projectRoot).toBe('/u');
  });

  it('prefer-newer uses user when bundled missing', () => {
    const r = pickMindOsRuntime({
      ...base(),
      bundledRunnable: false,
      bundledRoot: null,
      userVersion: '0.5.0',
    });
    expect(r.source).toBe('user');
  });

  it('prefer-newer uses bundled when user invalid version', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userVersion: 'not-a-semver',
      bundledVersion: '0.5.0',
    });
    expect(r.source).toBe('bundled');
  });

  it('reject user below minMindOsVersion then bundled', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userVersion: '0.4.0',
      bundledVersion: '0.5.0',
      minUserVersion: '0.5.0',
    });
    expect(r.source).toBe('bundled');
  });

  it('strictCompat rejects user above maxTested', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userVersion: '1.0.0',
      bundledVersion: '0.5.0',
      maxTestedUserVersion: '0.9.0',
      strictCompat: true,
    });
    expect(r.source).toBe('bundled');
  });

  it('prefer-newer returns none when nothing runnable', () => {
    const r = pickMindOsRuntime({
      ...base(),
      userRunnable: false,
      bundledRunnable: false,
    });
    expect(r.projectRoot).toBeNull();
    expect(r.reason).toBe('no-runnable-runtime');
  });
});
