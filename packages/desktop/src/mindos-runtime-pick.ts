/**
 * Pure selection of MindOS project root: override vs cached vs user vs bundled.
 * Spec: wiki/specs/spec-desktop-bundled-mindos.md, spec-desktop-core-hot-update.md
 */
import semver from 'semver';

export type MindOsRuntimePolicy = 'prefer-newer' | 'bundled-only' | 'user-only';
export type MindOsRuntimeSource = 'override' | 'cached' | 'user' | 'bundled' | 'none';

export interface MindOsRuntimePickInput {
  policy: MindOsRuntimePolicy;
  /** Highest priority: validated runnable root from MINDOS_RUNTIME_ROOT or config.mindosRuntimeRoot */
  overrideRoot: string | null;
  overrideVersion: string | null;
  /** Downloaded Core runtime at ~/.mindos/runtime/ (Core Hot Update) */
  cachedRoot: string | null;
  cachedVersion: string | null;
  cachedRunnable: boolean;
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
  // Collect all runnable candidates with valid semver, then pick the newest.
  // Priority when versions are equal: cached > user > bundled
  const candidates: Array<{ root: string; version: string; source: MindOsRuntimeSource }> = [];

  // Cached runtime (downloaded by Core Hot Update)
  if (input.cachedRunnable && input.cachedRoot && input.cachedVersion && semver.valid(input.cachedVersion)) {
    candidates.push({ root: input.cachedRoot, version: input.cachedVersion, source: 'cached' });
  }

  // User global install (validated by userAdoptionAllowed)
  if (userOk.ok && input.userRoot && input.userVersion && semver.valid(input.userVersion)) {
    candidates.push({ root: input.userRoot, version: input.userVersion, source: 'user' });
  }

  // Bundled runtime
  const bundledOk = input.bundledRunnable && !!input.bundledRoot;
  if (bundledOk && input.bundledRoot && input.bundledVersion && semver.valid(input.bundledVersion)) {
    candidates.push({ root: input.bundledRoot, version: input.bundledVersion, source: 'bundled' });
  }

  if (candidates.length === 0) {
    return { projectRoot: null, source: 'none', version: null, reason: 'no-runnable-runtime' };
  }

  // Sort: highest version first; equal versions keep array order (cached > user > bundled)
  candidates.sort((a, b) => {
    const cmp = semver.compare(b.version, a.version);
    return cmp; // stable sort preserves insertion order for equal versions
  });

  const winner = candidates[0];
  return { projectRoot: winner.root, source: winner.source, version: winner.version };
}
