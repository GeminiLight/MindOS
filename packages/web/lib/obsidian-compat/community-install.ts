import fs from 'fs';
import path from 'path';
import { ErrorCodes, MindOSError } from '@/lib/errors';
import { resolveExistingSafe } from '@/lib/core/security';
import { ManifestError, validateManifest } from './manifest';
import {
  fetchObsidianCommunityPluginPackage,
  type FetchObsidianCommunityPluginPackageOptions,
  type ObsidianCommunityPluginPackageDigest,
  type ObsidianCommunityPluginPreflight,
} from './community-catalog';
import { compareCommunityVersions, type CommunityVersionState } from './community-version';
import type { CompatibilityLevel } from './compatibility-report';

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

  const pluginsRoot = resolveExistingSafe(targetMindRoot, '.plugins');
  const targetDir = resolveExistingSafe(targetMindRoot, `.plugins/${pluginId}`);
  assertPluginRootCanBeCreated(pluginsRoot);
  if (pathExists(targetDir)) {
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

  let stageDir: string | undefined;
  try {
    stageDir = fs.mkdtempSync(path.join(pluginsRoot, `.installing-${pluginId}-`));
    const metadata = buildInstallMetadata(preflight, options.now?.() ?? new Date());

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

    if (pathExists(targetDir)) {
      throw new MindOSError(
        ErrorCodes.CONFLICT,
        `Obsidian plugin is already installed: ${pluginId}`,
      );
    }

    fs.renameSync(stageDir, targetDir);
    stageDir = undefined;

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
  } catch (err) {
    if (stageDir) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
    throw err;
  }
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

  const targetDir = resolveExistingSafe(targetMindRoot, `.plugins/${pluginId}`);
  if (!pathExists(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new MindOSError(
      ErrorCodes.FILE_NOT_FOUND,
      `Obsidian plugin is not installed: ${pluginId}`,
    );
  }

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

  const pluginsRoot = resolveExistingSafe(targetMindRoot, '.plugins');
  const targetDir = resolveExistingSafe(targetMindRoot, `.plugins/${pluginId}`);
  if (!pathExists(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new MindOSError(
      ErrorCodes.FILE_NOT_FOUND,
      `Obsidian plugin is not installed: ${pluginId}`,
    );
  }

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

  let stageDir: string | undefined;
  let backupDir: string | undefined;
  try {
    stageDir = fs.mkdtempSync(path.join(pluginsRoot, `.updating-${pluginId}-`));
    copyPreservedPluginFiles(targetDir, stageDir);
    writeFetchedPackageToDir(stageDir, fetched.files, metadata);

    await options.beforeSwap?.();

    if (!pathExists(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      throw new MindOSError(
        ErrorCodes.FILE_NOT_FOUND,
        `Obsidian plugin is not installed: ${pluginId}`,
      );
    }

    backupDir = uniqueHiddenDirPath(pluginsRoot, `.previous-${pluginId}-`);
    fs.renameSync(targetDir, backupDir);
    fs.renameSync(stageDir, targetDir);
    stageDir = undefined;

    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      // The new package is already published. A stale hidden backup is safer
      // than reporting a failed update after the swap has completed.
    }
    backupDir = undefined;

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
        preservedDataJson: pathExists(path.join(targetDir, 'data.json')),
      },
      files,
      preflight,
    };
  } catch (err) {
    if (backupDir && pathExists(backupDir) && !pathExists(targetDir)) {
      fs.renameSync(backupDir, targetDir);
      backupDir = undefined;
    }
    if (stageDir) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
    if (backupDir) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    throw err;
  }
}

function assertSafePluginId(pluginId: string): void {
  try {
    validateManifest({ id: pluginId, name: 'Plugin', version: '0.0.0' });
  } catch (err) {
    if (err instanceof ManifestError) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, err.message);
    }
    throw err;
  }
}

function assertPluginRootCanBeCreated(pluginsRoot: string): void {
  if (!pathExists(pluginsRoot)) {
    return;
  }
  if (!fs.statSync(pluginsRoot).isDirectory()) {
    throw new MindOSError(ErrorCodes.CONFLICT, 'MindOS .plugins exists but is not a directory.');
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

function uniqueHiddenDirPath(parentDir: string, prefix: string): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(parentDir, `${prefix}${Date.now()}-${process.pid}-${attempt}`);
    if (!pathExists(candidate)) return candidate;
  }
  throw new MindOSError(ErrorCodes.CONFLICT, 'Could not allocate plugin update backup directory.');
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
