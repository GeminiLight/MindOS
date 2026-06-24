import { createHash } from 'node:crypto';
import { ErrorCodes, MindOSError } from '@/lib/errors';
import {
  analyzePluginCompatibility,
  getCompatibilityLevel,
  type CompatibilityLevel,
  type PluginCompatibilityReport,
} from './compatibility-report';
import {
  buildObsidianCapabilityCoverage,
  summarizeObsidianCapabilityCoverage,
  type ObsidianCapabilityCoverage,
  type ObsidianCapabilitySupport,
} from './capability-matrix';
import { ManifestError, validateManifest } from './manifest';
import {
  lintObsidianCommunityManifestPolicy,
  type ObsidianCommunityManifestPolicyReport,
} from './manifest-policy';
import { OBSIDIAN_PLUGIN_STYLESHEET_MAX_BYTES } from './stylesheet-host';
import type { PluginManifest } from './types';
import { compareCommunityVersionStrings, isCommunityVersionAtMost } from './community-version';
import {
  buildObsidianCommunityPreflightSupport,
  buildObsidianCommunitySurfacePreview,
  type ObsidianCommunityPreflightSupport,
  type ObsidianCommunitySurfacePreview,
} from './community-support';

export const OBSIDIAN_COMMUNITY_PLUGINS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
const RAW_GITHUB_HEAD_BASE_URL = 'https://raw.githubusercontent.com';
const GITHUB_RELEASE_BASE_URL = 'https://github.com';
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const OBSIDIAN_COMMUNITY_PACKAGE_FETCH_TIMEOUT_MS = 8000;
export const OBSIDIAN_COMMUNITY_MANIFEST_MAX_CHARS = 64 * 1024;
export const OBSIDIAN_COMMUNITY_VERSIONS_MAX_CHARS = 128 * 1024;
export const OBSIDIAN_COMMUNITY_MAIN_JS_MAX_CHARS = 2 * 1024 * 1024;

export interface ObsidianCommunityCatalogEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  repo: string;
  githubUrl?: string;
}

export interface InstalledObsidianPluginState {
  id: string;
  enabled: boolean;
  loaded: boolean;
  status: 'enabled' | 'loaded' | 'disabled' | 'blocked' | 'error';
  version?: string;
  lastError?: string;
}

export interface ObsidianCommunityCatalogItem extends ObsidianCommunityCatalogEntry {
  source: 'obsidian-community';
  installed: boolean;
  installStatus: 'available' | 'disabled' | 'enabled' | 'loaded' | 'blocked' | 'error';
  installedVersion?: string;
  installedEnabled?: boolean;
  installedLoaded?: boolean;
  installedLastError?: string;
}

export interface ParseObsidianCommunityCatalogResult {
  items: ObsidianCommunityCatalogEntry[];
  skipped: Array<{ index: number; reason: string }>;
}

export interface BuildObsidianCommunityCatalogOptions {
  query?: string;
  limit?: number;
  installed?: Iterable<InstalledObsidianPluginState>;
}

export interface ObsidianCommunityPluginReleaseUrls {
  type: 'github-release';
  strategy: 'latest-release' | 'compatible-release';
  resolvedVersion: string;
  latestVersion: string;
  versionsUrl: string;
  targetAppVersion?: string;
  manifestUrl: string;
  mainUrl: string;
  stylesUrl: string;
}

export interface ObsidianCommunityPluginRepositoryUrls {
  manifestUrl: string;
  versionsUrl: string;
}

export interface ObsidianCommunityPluginPackageDigest {
  algorithm: 'sha256';
  manifestJson: string;
  mainJs: string;
  stylesCss?: string;
  package: string;
}

export interface PreflightObsidianCommunityPluginPackageOptions {
  repo: string;
  pluginId?: string;
  targetAppVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  mainJsMaxChars?: number;
}

export type FetchObsidianCommunityPluginPackageOptions = PreflightObsidianCommunityPluginPackageOptions;

export interface ObsidianCommunityPluginPreflight {
  ok: true;
  plugin: {
    id: string;
    name: string;
    repo: string;
    githubUrl?: string;
  };
  package: {
    manifest: PluginManifest;
    assets: {
      manifestJson: true;
      mainJs: true;
      stylesCss: boolean;
    };
    source: ObsidianCommunityPluginReleaseUrls;
    digest: ObsidianCommunityPluginPackageDigest;
  };
  compatibility: {
    level: CompatibilityLevel;
    report: PluginCompatibilityReport;
  };
  policy: ObsidianCommunityManifestPolicyReport;
  derivedCapabilities: {
    coverage: ObsidianCapabilityCoverage[];
    summary: Record<ObsidianCapabilitySupport, number>;
  };
  support: ObsidianCommunityPreflightSupport;
  surfacePreview: ObsidianCommunitySurfacePreview[];
  installable: boolean;
  installBlockedReasons: string[];
}

export interface FetchedObsidianCommunityPluginPackage {
  preflight: ObsidianCommunityPluginPreflight;
  files: {
    manifestJson: string;
    mainJs: string;
    stylesCss?: string;
  };
}

export interface ObsidianCommunityCatalogCounts {
  total: number;
  returned: number;
  installed: number;
  enabled: number;
  blocked: number;
  errors: number;
}

export interface ObsidianCommunityCatalog {
  source: {
    type: 'obsidian-releases';
    url: string;
  };
  query: string;
  plugins: ObsidianCommunityCatalogItem[];
  counts: ObsidianCommunityCatalogCounts;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function parseObsidianCommunityCatalog(raw: unknown): ParseObsidianCommunityCatalogResult {
  const skipped: ParseObsidianCommunityCatalogResult['skipped'] = [];
  if (!Array.isArray(raw)) {
    return {
      items: [],
      skipped: [{ index: -1, reason: 'Community plugin index must be an array.' }],
    };
  }

  const seen = new Set<string>();
  const items: ObsidianCommunityCatalogEntry[] = [];

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      skipped.push({ index, reason: 'Entry is not an object.' });
      return;
    }

    const record = entry as Record<string, unknown>;
    const id = normalizeText(record.id);
    const name = normalizeText(record.name);
    const description = normalizeText(record.description);
    const author = normalizeText(record.author);
    const repo = normalizeText(record.repo);

    if (!id || !name || !author || !repo) {
      skipped.push({ index, reason: 'Entry is missing id, name, author, or repo.' });
      return;
    }
    if (seen.has(id)) {
      skipped.push({ index, reason: `Duplicate plugin id: ${id}` });
      return;
    }

    seen.add(id);
    const githubUrl = githubUrlForRepo(repo);
    items.push({
      id,
      name,
      description,
      author,
      repo,
      ...(githubUrl ? { githubUrl } : {}),
    });
  });

  return { items, skipped };
}

export function buildObsidianCommunityCatalog(
  entries: ObsidianCommunityCatalogEntry[],
  options: BuildObsidianCommunityCatalogOptions = {},
): ObsidianCommunityCatalog {
  const query = options.query?.trim() ?? '';
  const normalizedQuery = query.toLowerCase();
  const limit = normalizeLimit(options.limit);
  const installedById = new Map(Array.from(options.installed ?? []).map((plugin) => [plugin.id, plugin]));

  const matching = entries
    .filter((entry) => matchesQuery(entry, normalizedQuery))
    .sort((a, b) => compareCommunityCatalogEntries(a, b, normalizedQuery));

  let installedCount = 0;
  let enabledCount = 0;
  let blockedCount = 0;
  let errorCount = 0;
  const plugins: ObsidianCommunityCatalogItem[] = [];

  matching.forEach((entry, index) => {
    const installed = installedById.get(entry.id);
    if (installed) {
      installedCount += 1;
      if (installed.enabled) enabledCount += 1;
      if (installed.status === 'blocked') blockedCount += 1;
      if (installed.status === 'error') errorCount += 1;
    }

    if (index >= limit) return;

    const installStatus: ObsidianCommunityCatalogItem['installStatus'] = installed?.status ?? 'available';
    plugins.push({
      ...entry,
      source: 'obsidian-community' as const,
      installed: Boolean(installed),
      installStatus,
      ...(installed?.version ? { installedVersion: installed.version } : {}),
      ...(installed ? { installedEnabled: installed.enabled, installedLoaded: installed.loaded } : {}),
      ...(installed?.lastError ? { installedLastError: installed.lastError } : {}),
    });
  });

  return {
    source: {
      type: 'obsidian-releases',
      url: OBSIDIAN_COMMUNITY_PLUGINS_URL,
    },
    query,
    plugins,
    counts: {
      total: entries.length,
      returned: plugins.length,
      installed: installedCount,
      enabled: enabledCount,
      blocked: blockedCount,
      errors: errorCount,
    },
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function matchesQuery(entry: ObsidianCommunityCatalogEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystack = `${entry.id} ${entry.name} ${entry.description} ${entry.author} ${entry.repo}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function compareCommunityCatalogEntries(
  a: ObsidianCommunityCatalogEntry,
  b: ObsidianCommunityCatalogEntry,
  normalizedQuery: string,
): number {
  const rankDelta = communityCatalogSearchRank(a, normalizedQuery) - communityCatalogSearchRank(b, normalizedQuery);
  if (rankDelta !== 0) return rankDelta;
  return a.name.localeCompare(b.name, 'en');
}

function communityCatalogSearchRank(entry: ObsidianCommunityCatalogEntry, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const id = entry.id.toLowerCase();
  const name = entry.name.toLowerCase();
  if (id === normalizedQuery || name === normalizedQuery) return 0;
  if (id.startsWith(normalizedQuery) || name.startsWith(normalizedQuery)) return 1;
  if (entry.repo.toLowerCase().includes(normalizedQuery)) return 2;
  if (entry.author.toLowerCase().includes(normalizedQuery)) return 3;
  return 4;
}

export function githubUrlForRepo(repo: string): string | undefined {
  const normalizedRepo = repo.trim();
  if (GITHUB_REPO_PATTERN.test(normalizedRepo)) {
    return `https://github.com/${normalizedRepo}`;
  }
  return undefined;
}

export function buildObsidianCommunityPluginRepositoryUrls(repo: string): ObsidianCommunityPluginRepositoryUrls {
  const normalizedRepo = repo.trim();
  if (!GITHUB_REPO_PATTERN.test(normalizedRepo)) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      'Invalid Obsidian community repo. Expected "owner/repo".',
    );
  }

  const baseUrl = `${RAW_GITHUB_HEAD_BASE_URL}/${normalizedRepo}/HEAD`;
  return {
    manifestUrl: `${baseUrl}/manifest.json`,
    versionsUrl: `${baseUrl}/versions.json`,
  };
}

export function buildObsidianCommunityPluginReleaseUrls(
  repo: string,
  version: string,
  options: {
    strategy: ObsidianCommunityPluginReleaseUrls['strategy'];
    latestVersion: string;
    versionsUrl: string;
    targetAppVersion?: string;
  },
): ObsidianCommunityPluginReleaseUrls {
  const normalizedRepo = repo.trim();
  if (!GITHUB_REPO_PATTERN.test(normalizedRepo)) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      'Invalid Obsidian community repo. Expected "owner/repo".',
    );
  }
  const normalizedVersion = version.trim();
  if (!normalizedVersion) {
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, 'Missing Obsidian community plugin release version.');
  }

  const baseUrl = `${GITHUB_RELEASE_BASE_URL}/${normalizedRepo}/releases/download/${encodeURIComponent(normalizedVersion)}`;
  return {
    type: 'github-release',
    strategy: options.strategy,
    resolvedVersion: normalizedVersion,
    latestVersion: options.latestVersion,
    versionsUrl: options.versionsUrl,
    ...(options.targetAppVersion ? { targetAppVersion: options.targetAppVersion } : {}),
    manifestUrl: `${baseUrl}/manifest.json`,
    mainUrl: `${baseUrl}/main.js`,
    stylesUrl: `${baseUrl}/styles.css`,
  };
}

export async function preflightObsidianCommunityPluginPackage(
  options: PreflightObsidianCommunityPluginPackageOptions,
): Promise<ObsidianCommunityPluginPreflight> {
  const fetched = await fetchObsidianCommunityPluginPackage(options);
  return fetched.preflight;
}

export async function fetchObsidianCommunityPluginPackage(
  options: FetchObsidianCommunityPluginPackageOptions,
): Promise<FetchedObsidianCommunityPluginPackage> {
  const repo = options.repo.trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, 'Fetch is not available for Obsidian plugin preflight.');
  }

  const repositorySource = buildObsidianCommunityPluginRepositoryUrls(repo);
  const timeoutMs = normalizePackageFetchTimeout(options.timeoutMs);
  const latestManifestJson = await fetchRequiredTextAsset(
    repositorySource.manifestUrl,
    fetchImpl,
    timeoutMs,
    'manifest.json',
    'application/json',
    OBSIDIAN_COMMUNITY_MANIFEST_MAX_CHARS,
  );
  const latestRawManifest = parsePluginManifestJson(latestManifestJson);
  const latestManifest = validatePreflightManifest(latestRawManifest);
  const targetAppVersion = normalizeTargetAppVersion(options.targetAppVersion);
  const source = await resolveCommunityPluginReleaseSource({
    repo,
    latestManifest,
    repositorySource,
    targetAppVersion,
    fetchImpl,
    timeoutMs,
  });
  const mainJsMaxChars = normalizePackageAssetMaxChars(
    options.mainJsMaxChars,
    OBSIDIAN_COMMUNITY_MAIN_JS_MAX_CHARS,
  );
  const manifestJson = await fetchRequiredTextAsset(
    source.manifestUrl,
    fetchImpl,
    timeoutMs,
    'manifest.json',
    'application/json',
    OBSIDIAN_COMMUNITY_MANIFEST_MAX_CHARS,
  );
  const rawManifest = parsePluginManifestJson(manifestJson);
  const manifest = validatePreflightManifest(rawManifest);
  const mainJs = await fetchRequiredTextAsset(
    source.mainUrl,
    fetchImpl,
    timeoutMs,
    'main.js',
    'text/javascript',
    mainJsMaxChars,
  );
  const stylesCss = await fetchOptionalTextAsset(
    source.stylesUrl,
    fetchImpl,
    timeoutMs,
    'styles.css',
    'text/css',
    OBSIDIAN_PLUGIN_STYLESHEET_MAX_BYTES,
  );
  const digest = buildPackageDigest({ manifestJson, mainJs, stylesCss });
  const githubUrl = githubUrlForRepo(repo);

  const compatibilityReport = analyzePluginCompatibility(mainJs, manifest);
  const level = getCompatibilityLevel(compatibilityReport);
  const policy = lintObsidianCommunityManifestPolicy(manifest);
  const coverage = buildObsidianCapabilityCoverage(compatibilityReport);
  const installBlockedReasons = [
    ...manifestIdMismatchReasons(options.pluginId, manifest.id),
    ...manifestVersionMismatchReasons(source.resolvedVersion, manifest.version),
    ...targetAppVersionMismatchReasons(targetAppVersion, manifest.minAppVersion),
    ...compatibilityReport.blockers,
  ];
  const installable = installBlockedReasons.length === 0;
  const supportInput = {
    compatibility: {
      level,
      report: compatibilityReport,
    },
    policy,
    installable,
    installBlockedReasons,
    stylesCss: typeof stylesCss === 'string',
  };

  return {
    preflight: {
      ok: true,
      plugin: {
        id: options.pluginId?.trim() || manifest.id,
        name: manifest.name,
        repo,
        ...(githubUrl ? { githubUrl } : {}),
      },
      package: {
        manifest,
        assets: {
          manifestJson: true,
          mainJs: true,
          stylesCss: typeof stylesCss === 'string',
        },
        source,
        digest,
      },
      compatibility: {
        level,
        report: compatibilityReport,
      },
      policy,
      derivedCapabilities: {
        coverage,
        summary: summarizeObsidianCapabilityCoverage(coverage),
      },
      support: buildObsidianCommunityPreflightSupport(supportInput),
      surfacePreview: buildObsidianCommunitySurfacePreview(supportInput),
      installable,
      installBlockedReasons,
    },
    files: {
      manifestJson,
      mainJs,
      ...(typeof stylesCss === 'string' ? { stylesCss } : {}),
    },
  };
}

function buildPackageDigest(files: {
  manifestJson: string;
  mainJs: string;
  stylesCss?: string;
}): ObsidianCommunityPluginPackageDigest {
  const manifestJson = sha256(files.manifestJson);
  const mainJs = sha256(files.mainJs);
  const stylesCss = typeof files.stylesCss === 'string' ? sha256(files.stylesCss) : undefined;
  const packageInput = {
    manifestJson,
    mainJs,
    stylesCss: stylesCss ?? null,
  };

  return {
    algorithm: 'sha256',
    manifestJson,
    mainJs,
    ...(stylesCss ? { stylesCss } : {}),
    package: sha256(JSON.stringify(packageInput)),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function normalizePackageFetchTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return OBSIDIAN_COMMUNITY_PACKAGE_FETCH_TIMEOUT_MS;
  return Math.max(1000, Math.min(30_000, Math.floor(value)));
}

function normalizePackageAssetMaxChars(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.max(1024, Math.floor(value));
}

function normalizeTargetAppVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (compareCommunityVersionStrings(normalized, normalized) === null) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Invalid Obsidian app version. Expected a numeric version.');
  }
  return normalized;
}

async function resolveCommunityPluginReleaseSource(options: {
  repo: string;
  latestManifest: PluginManifest;
  repositorySource: ObsidianCommunityPluginRepositoryUrls;
  targetAppVersion?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<ObsidianCommunityPluginReleaseUrls> {
  const latestVersion = options.latestManifest.version;
  const targetAppVersion = options.targetAppVersion;
  if (
    !targetAppVersion
    || !options.latestManifest.minAppVersion
    || isCommunityVersionAtMost(options.latestManifest.minAppVersion, targetAppVersion)
  ) {
    return buildObsidianCommunityPluginReleaseUrls(options.repo, latestVersion, {
      strategy: 'latest-release',
      latestVersion,
      versionsUrl: options.repositorySource.versionsUrl,
      targetAppVersion,
    });
  }

  const versionsJson = await fetchRequiredTextAsset(
    options.repositorySource.versionsUrl,
    options.fetchImpl,
    options.timeoutMs,
    'versions.json',
    'application/json',
    OBSIDIAN_COMMUNITY_VERSIONS_MAX_CHARS,
  );
  const versions = parsePluginVersionsJson(versionsJson);
  const compatibleVersion = findLatestCompatiblePluginVersion(versions, targetAppVersion);
  if (!compatibleVersion) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `No Obsidian community plugin release is compatible with app version ${targetAppVersion}.`,
    );
  }

  return buildObsidianCommunityPluginReleaseUrls(options.repo, compatibleVersion, {
    strategy: 'compatible-release',
    latestVersion,
    versionsUrl: options.repositorySource.versionsUrl,
    targetAppVersion,
  });
}

function parsePluginManifestJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, 'Invalid Obsidian plugin manifest.json JSON.');
  }
}

function parsePluginVersionsJson(text: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('versions.json must be an object');
    }
    const versions: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([pluginVersion, appVersion]) => {
      if (
        compareCommunityVersionStrings(pluginVersion, pluginVersion) !== null
        && typeof appVersion === 'string'
        && compareCommunityVersionStrings(appVersion, appVersion) !== null
      ) {
        versions[pluginVersion] = appVersion;
      }
    });
    return versions;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new MindOSError(ErrorCodes.INTERNAL_ERROR, 'Invalid Obsidian plugin versions.json JSON.');
    }
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, 'Invalid Obsidian plugin versions.json.');
  }
}

function findLatestCompatiblePluginVersion(
  versions: Record<string, string>,
  targetAppVersion: string,
): string | undefined {
  return Object.entries(versions)
    .filter(([, minAppVersion]) => isCommunityVersionAtMost(minAppVersion, targetAppVersion))
    .sort(([left], [right]) => {
      const comparison = compareCommunityVersionStrings(right, left);
      return comparison ?? 0;
    })[0]?.[0];
}

async function fetchRequiredTextAsset(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  label: string,
  accept: string,
  maxChars: number,
): Promise<string> {
  const response = await fetchWithTimeout(url, fetchImpl, timeoutMs, label, {
    cache: 'no-store',
    headers: { Accept: accept },
  });

  if (!response.ok) {
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Failed to fetch Obsidian plugin ${label}: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxChars) {
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Obsidian plugin ${label} is too large to preflight.`);
  }

  const text = await response.text();
  if (text.length > maxChars) {
    throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Obsidian plugin ${label} is too large to preflight.`);
  }

  return text;
}

async function fetchOptionalTextAsset(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  label: string,
  accept: string,
  maxChars: number,
): Promise<string | undefined> {
  try {
    const response = await fetchWithTimeout(url, fetchImpl, timeoutMs, label, {
      cache: 'no-store',
      headers: { Accept: accept },
    });
    if (!response.ok) {
      return undefined;
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxChars) {
      throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Obsidian plugin ${label} is too large to preflight.`);
    }

    const text = await response.text();
    if (text.length > maxChars) {
      throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Obsidian plugin ${label} is too large to preflight.`);
    }

    return text;
  } catch (err) {
    if (err instanceof MindOSError && err.message.includes('is too large')) {
      throw err;
    }
    return undefined;
  }
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  label: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Timed out fetching Obsidian plugin ${label}.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function validatePreflightManifest(rawManifest: unknown): PluginManifest {
  try {
    return validateManifest(rawManifest);
  } catch (err) {
    if (err instanceof ManifestError) {
      throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Invalid Obsidian plugin manifest: ${err.message}`);
    }
    throw err;
  }
}

function manifestIdMismatchReasons(pluginId: string | undefined, manifestId: string): string[] {
  const expectedId = pluginId?.trim();
  if (!expectedId || expectedId === manifestId) return [];
  return [`Manifest id "${manifestId}" does not match requested plugin id "${expectedId}".`];
}

function manifestVersionMismatchReasons(resolvedVersion: string, manifestVersion: string): string[] {
  if (resolvedVersion === manifestVersion) return [];
  return [`Release asset manifest version "${manifestVersion}" does not match resolved release "${resolvedVersion}".`];
}

function targetAppVersionMismatchReasons(
  targetAppVersion: string | undefined,
  minAppVersion: string | undefined,
): string[] {
  if (!targetAppVersion || !minAppVersion || isCommunityVersionAtMost(minAppVersion, targetAppVersion)) return [];
  return [`Requires Obsidian app version ${minAppVersion} or newer; target is ${targetAppVersion}.`];
}
