import fs from 'fs';
import path from 'path';
import { assertSafePluginIdentifier, stagedDirectorySwap } from '@geminilight/mindos/foundation';
import { ErrorCodes, MindOSError } from '@/lib/errors';
import { ManifestError, validateManifest } from './manifest';
import {
  fetchObsidianCommunityPluginPackage,
  type FetchObsidianCommunityPluginPackageOptions,
  type ObsidianCommunityPluginPackageDigest,
  type ObsidianCommunityPluginPreflight,
} from './community-catalog';
import { compareCommunityVersions, type CommunityVersionState } from './community-version';
import type { CompatibilityLevel } from './compatibility-report';
import {
  hasInstalledObsidianPluginDir,
  resolveCanonicalObsidianPluginDir,
  resolveCanonicalObsidianPluginRoot,
  resolveInstalledObsidianPluginDir,
} from './plugin-paths';

export interface InstallObsidianCommunityPluginOptions extends FetchObsidianCommunityPluginPackageOptions {
  pluginId: string;
  targetMindRoot: string;
  confirm: boolean;
  now?: () => Date;
}

export interface ObsidianCommunityInstallMetadata {
  schemaVersion: 1;
  source: 'obsidian-community';
  pluginId: string;
  repo: string;
  githubUrl?: string;
  sourceType: 'github-release';
  sourceStrategy: 'latest-release' | 'compatible-release';
  resolvedVersion: string;
  latestVersion: string;
  versionsUrl: string;
  targetAppVersion?: string;
  manifestUrl: string;
  mainUrl: string;
  stylesUrl: string;
  packageDigest: ObsidianCommunityPluginPackageDigest;
  installedAt: string;
  updatedAt?: string;
  previousVersion?: string;
  compatibilityLevel: CompatibilityLevel;
  installBlockedReasons: string[];
}

export interface InstalledObsidianCommunityPlugin {
  pluginId: string;
  targetDir: string;
  enabled: false;
  loaded: false;
  source: 'obsidian-community';
  metadata: ObsidianCommunityInstallMetadata;
}

export interface InstallObsidianCommunityPluginResult {
  ok: true;
  plugin: ObsidianCommunityPluginPreflight['plugin'];
  installed: InstalledObsidianCommunityPlugin;
  preflight: ObsidianCommunityPluginPreflight;
}

export interface PlanObsidianCommunityPluginUpdateOptions extends FetchObsidianCommunityPluginPackageOptions {
  pluginId: string;
  targetMindRoot: string;
}

export interface UpdateObsidianCommunityPluginOptions extends FetchObsidianCommunityPluginPackageOptions {
  pluginId: string;
  targetMindRoot: string;
  confirm: boolean;
  expectedRemoteVersion?: string;
  expectedPackageDigest?: string;
  now?: () => Date;
  beforeSwap?: () => Promise<void> | void;
}

export type ObsidianCommunityUpdateFileAction = 'create' | 'modify' | 'remove' | 'unchanged' | 'refresh';

export interface ObsidianCommunityUpdatePlanFile {
  path: 'manifest.json' | 'main.js' | 'styles.css' | 'obsidian-community.json';
  action: ObsidianCommunityUpdateFileAction;
  localBytes?: number;
  remoteBytes?: number;
  generated?: boolean;
}

export interface ObsidianCommunityUpdatePlan {
  ok: true;
  readOnly: true;
  writePolicy: 'preview-only';
  plugin: ObsidianCommunityPluginPreflight['plugin'];
  installed: {
    pluginId: string;
    targetDir: string;
    version?: string;
    hasCommunityMetadata: boolean;
  };
  version: {
    installed?: string;
    remote: string;
    state: CommunityVersionState;
  };
  packageDigest: ObsidianCommunityPluginPackageDigest;
  updatable: boolean;
  blockedReasons: string[];
  files: ObsidianCommunityUpdatePlanFile[];
  preflight: ObsidianCommunityPluginPreflight;
}

export interface UpdatedObsidianCommunityPlugin {
  pluginId: string;
  targetDir: string;
  previousVersion?: string;
  version: string;
  source: 'obsidian-community';
  metadata: ObsidianCommunityInstallMetadata;
  preservedDataJson: boolean;
}

export interface UpdateObsidianCommunityPluginResult {
  ok: true;
  plugin: ObsidianCommunityPluginPreflight['plugin'];
  updated: UpdatedObsidianCommunityPlugin;
  files: ObsidianCommunityUpdatePlanFile[];
  preflight: ObsidianCommunityPluginPreflight;
}

export async function installObsidianCommunityPlugin(
  options: InstallObsidianCommunityPluginOptions,
): Promise<InstallObsidianCommunityPluginResult> {
  if (options.confirm !== true) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      'Community plugin install requires explicit confirmation.',
    );
  }

  const pluginId = options.pluginId.trim();
  assertSafePluginId(pluginId);

  const targetMindRoot = options.targetMindRoot.trim();
  if (!targetMindRoot) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing target MindOS root.');
  }

  const pluginsRoot = resolveCanonicalObsidianPluginRoot(targetMindRoot).rootDir;
  const targetDir = resolveCanonicalObsidianPluginDir(targetMindRoot, pluginId).pluginDir;
  assertPluginRootCanBeCreated(pluginsRoot);
  if (hasInstalledObsidianPluginDir(targetMindRoot, pluginId)) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Obsidian plugin is already installed: ${pluginId}`,
    );
  }

  const fetched = await fetchObsidianCommunityPluginPackage({
    repo: options.repo,
    pluginId,
    targetAppVersion: options.targetAppVersion,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const preflight = fetched.preflight;

  if (!preflight.installable) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      preflight.installBlockedReasons[0] ?? `Obsidian community plugin is not installable: ${pluginId}`,
    );
  }

  fs.mkdirSync(pluginsRoot, { recursive: true });
  assertPluginRootCanBeCreated(pluginsRoot);

  const metadata = buildInstallMetadata(preflight, options.now?.() ?? new Date());

  // stage → validate → rename → rollback lives in the shared primitive
  // (spec-plugin-primitives); the `.installing-<id>-` staging name is kept so
  // plugin enumeration and tests keep recognising in-flight installs.
  stagedDirectorySwap(targetDir, (stageDir) => {
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), fetched.files.manifestJson, 'utf-8');
    fs.writeFileSync(path.join(stageDir, 'main.js'), fetched.files.mainJs, 'utf-8');
    if (typeof fetched.files.stylesCss === 'string') {
      fs.writeFileSync(path.join(stageDir, 'styles.css'), fetched.files.stylesCss, 'utf-8');
    }
    fs.writeFileSync(
      path.join(stageDir, 'obsidian-community.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf-8',
    );
  }, {
    stageParentDir: pluginsRoot,
    stagePrefix: `.installing-${pluginId}-`,
    existsMessage: `Obsidian plugin is already installed: ${pluginId}`,
    validate: () => {
      if (pathExists(targetDir)) {
        throw new MindOSError(
          ErrorCodes.CONFLICT,
          `Obsidian plugin is already installed: ${pluginId}`,
        );
      }
    },
  });

  return {
    ok: true,
    plugin: preflight.plugin,
    installed: {
      pluginId,
      targetDir,
      enabled: false,
      loaded: false,
      source: 'obsidian-community',
      metadata,
    },
    preflight,
  };
}

export async function planObsidianCommunityPluginUpdate(
  options: PlanObsidianCommunityPluginUpdateOptions,
): Promise<ObsidianCommunityUpdatePlan> {
  const pluginId = options.pluginId.trim();
  assertSafePluginId(pluginId);

  const targetMindRoot = options.targetMindRoot.trim();
  if (!targetMindRoot) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing target MindOS root.');
  }

  const targetLocation = requireCanonicalInstalledPluginLocation(targetMindRoot, pluginId);
  const targetDir = targetLocation.pluginDir;

  const localManifest = readInstalledManifest(targetDir, pluginId);
  readRequiredCommunityInstallMetadata(targetDir, pluginId, options.repo);
  const fetched = await fetchObsidianCommunityPluginPackage({
    repo: options.repo,
    pluginId,
    targetAppVersion: options.targetAppVersion,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const preflight = fetched.preflight;
  const metadataPath = path.join(targetDir, 'obsidian-community.json');
  const versionState = compareCommunityVersions(localManifest.version, preflight.package.manifest.version);

  return {
    ok: true,
    readOnly: true,
    writePolicy: 'preview-only',
    plugin: preflight.plugin,
    installed: {
      pluginId,
      targetDir,
      version: localManifest.version,
      hasCommunityMetadata: true,
    },
    version: {
      installed: localManifest.version,
      remote: preflight.package.manifest.version,
      state: versionState,
    },
    packageDigest: preflight.package.digest,
    updatable: preflight.installable && versionState === 'update-available',
    blockedReasons: preflight.installBlockedReasons,
    files: [
      comparePackageFile(targetDir, 'manifest.json', fetched.files.manifestJson),
      comparePackageFile(targetDir, 'main.js', fetched.files.mainJs),
      comparePackageFile(targetDir, 'styles.css', fetched.files.stylesCss),
      planGeneratedOriginFile(targetDir),
    ],
    preflight,
  };
}

export async function updateObsidianCommunityPlugin(
  options: UpdateObsidianCommunityPluginOptions,
): Promise<UpdateObsidianCommunityPluginResult> {
  if (options.confirm !== true) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      'Community plugin update requires explicit confirmation.',
    );
  }

  const pluginId = options.pluginId.trim();
  assertSafePluginId(pluginId);

  const targetMindRoot = options.targetMindRoot.trim();
  if (!targetMindRoot) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing target MindOS root.');
  }

  const targetLocation = requireCanonicalInstalledPluginLocation(targetMindRoot, pluginId);
  const pluginsRoot = targetLocation.rootDir;
  const targetDir = targetLocation.pluginDir;

  const localManifest = readInstalledManifest(targetDir, pluginId);
  const existingMetadata = readRequiredCommunityInstallMetadata(targetDir, pluginId, options.repo);
  const fetched = await fetchObsidianCommunityPluginPackage({
    repo: options.repo,
    pluginId,
    targetAppVersion: options.targetAppVersion,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const preflight = fetched.preflight;
  const remoteVersion = preflight.package.manifest.version;
  const expectedRemoteVersion = options.expectedRemoteVersion?.trim();
  const expectedPackageDigest = options.expectedPackageDigest?.trim();

  if (expectedRemoteVersion && expectedRemoteVersion !== remoteVersion) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Remote plugin version changed from ${expectedRemoteVersion} to ${remoteVersion}. Preview the update again.`,
    );
  }
  if (expectedPackageDigest && expectedPackageDigest !== preflight.package.digest.package) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      'Remote plugin package changed since preview. Preview the update again.',
    );
  }
  if (!preflight.installable) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      preflight.installBlockedReasons[0] ?? `Obsidian community plugin is not safe to update: ${pluginId}`,
    );
  }

  const versionState = compareCommunityVersions(localManifest.version, remoteVersion);
  if (versionState !== 'update-available') {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `No newer remote version is available for Obsidian plugin: ${pluginId}`,
    );
  }

  const files = [
    comparePackageFile(targetDir, 'manifest.json', fetched.files.manifestJson),
    comparePackageFile(targetDir, 'main.js', fetched.files.mainJs),
    comparePackageFile(targetDir, 'styles.css', fetched.files.stylesCss),
    planGeneratedOriginFile(targetDir),
  ];
  const metadata = buildUpdateMetadata(
    preflight,
    localManifest.version,
    existingMetadata,
    options.now?.() ?? new Date(),
  );

  await options.beforeSwap?.();

  // stage → backup → rename → rollback lives in the shared primitive
  // (spec-plugin-primitives). A failed backup cleanup after a successful swap
  // is tolerated: the new package is already published, and a stale hidden
  // `.previous-<id>-` backup is safer than reporting a failed update.
  const swap = stagedDirectorySwap<{ preservedDataJson: boolean }>(targetDir, (stageDir) => {
    copyPreservedPluginFiles(targetDir, stageDir);
    writeFetchedPackageToDir(stageDir, fetched.files, metadata);
  }, {
    stageParentDir: pluginsRoot,
    stagePrefix: `.updating-${pluginId}-`,
    backupPrefix: `.previous-${pluginId}-`,
    replace: true,
    validate: () => {
      if (!pathExists(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new MindOSError(
          ErrorCodes.FILE_NOT_FOUND,
          `Obsidian plugin is not installed: ${pluginId}`,
        );
      }
    },
    onSwapped: (publishedDir) => ({
      preservedDataJson: pathExists(path.join(publishedDir, 'data.json')),
    }),
    tolerateBackupCleanupFailure: true,
  });

  return {
    ok: true,
    plugin: preflight.plugin,
    updated: {
      pluginId,
      targetDir,
      previousVersion: localManifest.version,
      version: remoteVersion,
      source: 'obsidian-community',
      metadata,
      preservedDataJson: swap.payload?.preservedDataJson ?? false,
    },
    files,
    preflight,
  };
}

function assertSafePluginId(pluginId: string): void {
  // Shared segment validator (foundation/plugins/safe-id) instead of routing a
  // synthetic manifest through validateManifest; Obsidian community ids never
  // contain dots, so the stricter allowDots:false rules are a superset.
  try {
    assertSafePluginIdentifier(pluginId, { allowDots: false, context: 'obsidian plugin id' });
  } catch (err) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err));
  }
}

function requireCanonicalInstalledPluginLocation(
  targetMindRoot: string,
  pluginId: string,
): NonNullable<ReturnType<typeof resolveInstalledObsidianPluginDir>> {
  const targetLocation = resolveInstalledObsidianPluginDir(targetMindRoot, pluginId);
  if (!targetLocation || !pathExists(targetLocation.pluginDir) || !fs.statSync(targetLocation.pluginDir).isDirectory()) {
    throw new MindOSError(
      ErrorCodes.FILE_NOT_FOUND,
      `Obsidian plugin is not installed: ${pluginId}`,
    );
  }
  if (targetLocation.legacy) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Obsidian community plugin update requires canonical package location. Migrate .plugins/${pluginId} to .mindos/plugins/${pluginId} before updating.`,
    );
  }
  return targetLocation;
}

function assertPluginRootCanBeCreated(pluginsRoot: string): void {
  if (!pathExists(pluginsRoot)) {
    return;
  }
  if (!fs.statSync(pluginsRoot).isDirectory()) {
    throw new MindOSError(ErrorCodes.CONFLICT, 'MindOS plugin directory exists but is not a directory.');
  }
}

function readInstalledManifest(targetDir: string, pluginId: string): { version?: string } {
  const manifestPath = path.join(targetDir, 'manifest.json');
  if (!pathExists(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new MindOSError(
      ErrorCodes.FILE_NOT_FOUND,
      `Installed Obsidian plugin manifest is missing: ${pluginId}`,
    );
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = validateManifest(JSON.parse(raw));
    if (manifest.id !== pluginId) {
      throw new MindOSError(
        ErrorCodes.CONFLICT,
        `Installed Obsidian plugin manifest id "${manifest.id}" does not match "${pluginId}".`,
      );
    }
    return { version: manifest.version };
  } catch (err) {
    if (err instanceof MindOSError) throw err;
    if (err instanceof ManifestError) {
      throw new MindOSError(ErrorCodes.CONFLICT, `Invalid installed Obsidian plugin manifest: ${err.message}`);
    }
    throw new MindOSError(ErrorCodes.CONFLICT, 'Invalid installed Obsidian plugin manifest JSON.');
  }
}

function writeFetchedPackageToDir(
  targetDir: string,
  files: { manifestJson: string; mainJs: string; stylesCss?: string },
  metadata: ObsidianCommunityInstallMetadata,
): void {
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), files.manifestJson, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'main.js'), files.mainJs, 'utf-8');
  const stylesPath = path.join(targetDir, 'styles.css');
  if (typeof files.stylesCss === 'string') {
    fs.writeFileSync(stylesPath, files.stylesCss, 'utf-8');
  } else if (pathExists(stylesPath)) {
    fs.rmSync(stylesPath, { force: true });
  }
  fs.writeFileSync(
    path.join(targetDir, 'obsidian-community.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf-8',
  );
}

function copyPreservedPluginFiles(sourceDir: string, targetDir: string): void {
  const packageFiles = new Set(['manifest.json', 'main.js', 'styles.css', 'obsidian-community.json']);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (packageFiles.has(entry.name)) continue;
    copyPreservedPluginStateEntry(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
  }
}

function copyPreservedPluginStateEntry(source: string, target: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyPreservedPluginStateEntry(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function comparePackageFile(
  targetDir: string,
  fileName: 'manifest.json' | 'main.js' | 'styles.css',
  remoteText: string | undefined,
): ObsidianCommunityUpdatePlanFile {
  const localPath = path.join(targetDir, fileName);
  const localText = readOptionalTextFile(localPath);
  const localBytes = typeof localText === 'string' ? Buffer.byteLength(localText, 'utf-8') : undefined;
  const remoteBytes = typeof remoteText === 'string' ? Buffer.byteLength(remoteText, 'utf-8') : undefined;

  if (typeof localText !== 'string' && typeof remoteText === 'string') {
    return { path: fileName, action: 'create', remoteBytes };
  }
  if (typeof localText === 'string' && typeof remoteText !== 'string') {
    return { path: fileName, action: 'remove', localBytes };
  }
  if (typeof localText !== 'string' || typeof remoteText !== 'string') {
    return { path: fileName, action: 'unchanged' };
  }
  return {
    path: fileName,
    action: localText === remoteText ? 'unchanged' : 'modify',
    localBytes,
    remoteBytes,
  };
}

function planGeneratedOriginFile(targetDir: string): ObsidianCommunityUpdatePlanFile {
  const localPath = path.join(targetDir, 'obsidian-community.json');
  const localText = readOptionalTextFile(localPath);
  return {
    path: 'obsidian-community.json',
    action: typeof localText === 'string' ? 'refresh' : 'create',
    ...(typeof localText === 'string' ? { localBytes: Buffer.byteLength(localText, 'utf-8') } : {}),
    generated: true,
  };
}

function readRequiredCommunityInstallMetadata(
  targetDir: string,
  pluginId: string,
  repo: string,
): Partial<ObsidianCommunityInstallMetadata> {
  const metadataPath = path.join(targetDir, 'obsidian-community.json');
  if (!pathExists(metadataPath) || !fs.statSync(metadataPath).isFile()) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Community plugin update requires Obsidian Community provenance for ${pluginId}.`,
    );
  }

  let metadata: Partial<ObsidianCommunityInstallMetadata>;
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('metadata must be an object');
    }
    metadata = parsed as Partial<ObsidianCommunityInstallMetadata>;
  } catch {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Invalid Obsidian Community provenance for ${pluginId}.`,
    );
  }

  if (metadata.source !== 'obsidian-community') {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Community plugin update requires Obsidian Community provenance for ${pluginId}.`,
    );
  }
  if (metadata.pluginId !== pluginId) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Community plugin provenance plugin id mismatch for ${pluginId}.`,
    );
  }

  const installedRepo = typeof metadata.repo === 'string' ? normalizeRepoForProvenance(metadata.repo) : '';
  const requestedRepo = normalizeRepoForProvenance(repo);
  if (!installedRepo || installedRepo !== requestedRepo) {
    throw new MindOSError(
      ErrorCodes.CONFLICT,
      `Community plugin update provenance mismatch for ${pluginId}: installed from ${metadata.repo ?? 'unknown'}, requested ${repo}.`,
    );
  }

  return metadata;
}

function readOptionalTextFile(filePath: string): string | undefined {
  if (!pathExists(filePath)) return undefined;
  if (!fs.statSync(filePath).isFile()) return undefined;
  return fs.readFileSync(filePath, 'utf-8');
}

function buildInstallMetadata(
  preflight: ObsidianCommunityPluginPreflight,
  installedAt: Date,
): ObsidianCommunityInstallMetadata {
  return {
    schemaVersion: 1,
    source: 'obsidian-community',
    pluginId: preflight.package.manifest.id,
    repo: preflight.plugin.repo,
    ...(preflight.plugin.githubUrl ? { githubUrl: preflight.plugin.githubUrl } : {}),
    sourceType: preflight.package.source.type,
    sourceStrategy: preflight.package.source.strategy,
    resolvedVersion: preflight.package.source.resolvedVersion,
    latestVersion: preflight.package.source.latestVersion,
    versionsUrl: preflight.package.source.versionsUrl,
    ...(preflight.package.source.targetAppVersion ? { targetAppVersion: preflight.package.source.targetAppVersion } : {}),
    manifestUrl: preflight.package.source.manifestUrl,
    mainUrl: preflight.package.source.mainUrl,
    stylesUrl: preflight.package.source.stylesUrl,
    packageDigest: preflight.package.digest,
    installedAt: installedAt.toISOString(),
    compatibilityLevel: preflight.compatibility.level,
    installBlockedReasons: preflight.installBlockedReasons,
  };
}

function buildUpdateMetadata(
  preflight: ObsidianCommunityPluginPreflight,
  previousVersion: string | undefined,
  existing: Partial<ObsidianCommunityInstallMetadata>,
  updatedAt: Date,
): ObsidianCommunityInstallMetadata {
  return {
    ...buildInstallMetadata(preflight, parseMetadataDate(existing.installedAt) ?? updatedAt),
    ...(previousVersion ? { previousVersion } : {}),
    updatedAt: updatedAt.toISOString(),
  };
}

function parseMetadataDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeRepoForProvenance(repo: string): string {
  return repo.trim().toLowerCase();
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
