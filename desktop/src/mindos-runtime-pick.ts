/**
 * Pure selection of MindOS project root: override vs bundled vs user global install.
 * Spec: wiki/specs/spec-desktop-bundled-mindos.md
 */
import semver from 'semver';

export type MindOsRuntimePolicy = 'prefer-newer' | 'bundled-only' | 'user-only';
export type MindOsRuntimeSource = 'override' | 'user' | 'bundled' | 'none';

export interface MindOsRuntimePickInput {
  policy: MindOsRuntimePolicy;
  /** Highest priority: validated runnable root from MINDOS_RUNTIME_ROOT or config.mindosRuntimeRoot */
  overrideRoot: string | null;
  overrideVersion: string | null;
  bundledRoot: string | null;
  bundledVersion: string | null;
  bundledRunnable: boolean;
  userRoot: string | null;
  userVersion: string | null;
  userRunnable: boolean;
  /** Reject user global when Vu < min (semver), if set */
  minUserVersion: string | null;
  /** When strictCompat and set, reject user when Vu > max (semver) */
  maxTestedUserVersion: string | null;
  strictCompat: boolean;
}

export interface MindOsRuntimePickResult {
  projectRoot: string | null;
  source: MindOsRuntimeSource;
  version: string | null;
  reason?: string;
}

function userAdoptionAllowed(input: MindOsRuntimePickInput): { ok: true } | { ok: false; reason: string } {
  if (!input.userRunnable || !input.userRoot) {
    return { ok: false, reason: 'user-not-runnable' };
  }
  if (!input.userVersion || !semver.valid(input.userVersion)) {
    return { ok: false, reason: 'user-version-invalid' };
  }
  if (input.minUserVersion && semver.valid(input.minUserVersion) && semver.lt(input.userVersion, input.minUserVersion)) {
    return { ok: false, reason: 'user-below-min' };
  }
  if (
    input.strictCompat &&
    input.maxTestedUserVersion &&
    semver.valid(input.maxTestedUserVersion) &&
    semver.gt(input.userVersion, input.maxTestedUserVersion)
  ) {
    return { ok: false, reason: 'user-above-max-tested' };
  }
  return { ok: true };
}

/**
 * Decide which MindOS root to use. Does not touch filesystem.
 * Caller supplies runnable flags and versions from analyzeMindOsLayout.
 */
export function pickMindOsRuntime(input: MindOsRuntimePickInput): MindOsRuntimePickResult {
  if (input.overrideRoot) {
    return {
      projectRoot: input.overrideRoot,
      source: 'override',
      version: input.overrideVersion,
    };
  }

  const userOk = userAdoptionAllowed(input);

  if (input.policy === 'bundled-only') {
    if (input.bundledRunnable && input.bundledRoot) {
      return { projectRoot: input.bundledRoot, source: 'bundled', version: input.bundledVersion };
    }
    return { projectRoot: null, source: 'none', version: null, reason: 'bundled-only-missing' };
  }

  if (input.policy === 'user-only') {
    if (userOk.ok) {
      return { projectRoot: input.userRoot, source: 'user', version: input.userVersion };
    }
    return {
      projectRoot: null,
      source: 'none',
      version: null,
      reason: userOk.ok === false ? userOk.reason : 'user-unavailable',
    };
  }

  // prefer-newer (default)
  const bundledOk = input.bundledRunnable && !!input.bundledRoot;
  const uV = input.userVersion && semver.valid(input.userVersion) ? input.userVersion : null;
  const bV = input.bundledVersion && semver.valid(input.bundledVersion) ? input.bundledVersion : null;

  if (userOk.ok && uV && bundledOk && bV) {
    if (semver.gt(uV, bV)) {
      return { projectRoot: input.userRoot, source: 'user', version: uV };
    }
    if (semver.lt(uV, bV)) {
      return { projectRoot: input.bundledRoot, source: 'bundled', version: bV };
    }
    // equal semver → prefer user tree (spec: local patch / parity with published)
    return { projectRoot: input.userRoot, source: 'user', version: uV };
  }

  if (userOk.ok && input.userRoot) {
    return { projectRoot: input.userRoot, source: 'user', version: input.userVersion };
  }

  if (bundledOk && input.bundledRoot) {
    return { projectRoot: input.bundledRoot, source: 'bundled', version: input.bundledVersion };
  }

  return { projectRoot: null, source: 'none', version: null, reason: 'no-runnable-runtime' };
}
