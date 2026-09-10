/**
 * Extension directory store — the file-system half of runtime extensions.
 *
 * Extracted from `server/handlers/runtime-extensions.ts` so the HTTP handler
 * stays request/response-shaped while everything that reads or writes
 * `<mindRoot>/.mindos/runtime-extensions/<id>/` lives here: listing installed
 * extensions, the staged install swap, and the display/migration metadata
 * file. Authorization for `replace: true` is NOT decided here — host settings
 * own that record (audit P2-6); this module only exposes the extension-dir
 * fallback read for already-installed legacy extensions.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { stagedDirectorySwap } from '../../foundation/plugins/index.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  parseAgentRuntimeExtensionManifest,
  type AgentRuntimeExtensionManifest,
  type AgentRuntimeExtensionManifestDiagnostic,
} from './extension-manifest.js';

export const MINDOS_RUNTIME_EXTENSIONS_ROOT = '.mindos/runtime-extensions';
export const EXTENSION_METADATA_FILE = 'mindos-runtime-extension.json';
export const EXTENSION_MANIFEST_FILE = 'manifest.json';

export type AgentRuntimeExtensionContributionCounts = {
  acpAdapters: number;
  mcpServers: number;
  assistants: number;
  agents: number;
  skills: number;
  commands: number;
  themes: number;
  settingsTabs: number;
};

export type InstalledAgentRuntimeExtensionMetadata = {
  schemaVersion: 1;
  source: 'agent-runtime-extension';
  extensionId: string;
  version?: string;
  installedAt: string;
  updatedAt?: string;
  contributionCounts: AgentRuntimeExtensionContributionCounts;
  appliedAcpAgents: string[];
  lifecycleScriptsDeclared: number;
};

export type InstalledAgentRuntimeExtension = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  root: typeof MINDOS_RUNTIME_EXTENSIONS_ROOT;
  targetDir: string;
  manifestPath: string;
  metadataPath: string;
  manifest: AgentRuntimeExtensionManifest;
  metadata: InstalledAgentRuntimeExtensionMetadata;
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[];
};

export type InstallAgentRuntimeExtensionOptions = {
  /** ACP agent ids applied by this install; recorded in the metadata file for display/migration. */
  appliedAcpAgents: string[];
  /** Allow replacing an already-installed extension (backup + swap). */
  replace: boolean;
  now?: () => Date;
};

export function runtimeExtensionsRootDir(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT);
}

export function listInstalledAgentRuntimeExtensions(mindRoot: string): InstalledAgentRuntimeExtension[] {
  const rootDir = runtimeExtensionsRootDir(mindRoot);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) return [];

  const installed: InstalledAgentRuntimeExtension[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extensionDir = join(rootDir, entry.name);
    const manifestPath = join(extensionDir, EXTENSION_MANIFEST_FILE);
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) continue;

    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
      const parsed = parseAgentRuntimeExtensionManifest(raw, { extensionRoot: extensionDir });
      if (!parsed.manifest) continue;
      const manifest = stripResolvedPaths(parsed.manifest);
      const metadataPath = join(extensionDir, EXTENSION_METADATA_FILE);
      const metadata = readExtensionMetadata(metadataPath, manifest);
      installed.push({
        id: manifest.id,
        name: manifest.displayName ?? manifest.name,
        ...(manifest.version ? { version: manifest.version } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
        root: MINDOS_RUNTIME_EXTENSIONS_ROOT,
        targetDir: relative(mindRoot, extensionDir).split('\\').join('/'),
        manifestPath: relative(mindRoot, manifestPath).split('\\').join('/'),
        metadataPath: relative(mindRoot, metadataPath).split('\\').join('/'),
        manifest,
        metadata,
        diagnostics: parsed.diagnostics,
      });
    } catch {
      continue;
    }
  }

  return installed.sort((a, b) => a.name.localeCompare(b.name));
}

export function installAgentRuntimeExtension(
  mindRoot: string,
  manifest: AgentRuntimeExtensionManifest,
  options: InstallAgentRuntimeExtensionOptions,
): InstalledAgentRuntimeExtension {
  const rootDir = runtimeExtensionsRootDir(mindRoot);
  mkdirSync(rootDir, { recursive: true });
  const targetDir = resolveExistingSafe(mindRoot, `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`);
  const alreadyInstalled = existsSync(targetDir);
  if (alreadyInstalled && !options.replace) {
    throw new Error(`Runtime extension is already installed: ${manifest.id}`);
  }

  const now = options.now?.() ?? new Date();
  const installedAt = alreadyInstalled ? readExistingInstalledAt(mindRoot, manifest) : undefined;
  const metadata = buildExtensionMetadata(manifest, options.appliedAcpAgents, now, installedAt);
  const sanitizedManifest = stripResolvedPaths(manifest);

  // stage → validate → backup → rename → rollback lives in the shared
  // primitive (spec-plugin-primitives); the sibling naming with pid/timestamp
  // keeps stage/backup dirs identifiable next to the published extension dir.
  stagedDirectorySwap(targetDir, (stageDir) => {
    writeFileSync(join(stageDir, EXTENSION_MANIFEST_FILE), `${JSON.stringify(sanitizedManifest, null, 2)}\n`, 'utf-8');
    writeFileSync(join(stageDir, EXTENSION_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
  }, {
    stageParentDir: rootDir,
    stagePrefix: `${relative(rootDir, targetDir)}.installing-${process.pid}-${Date.now()}-`,
    backupPrefix: `${relative(rootDir, targetDir)}.backup-${process.pid}-${Date.now()}-`,
    replace: options.replace,
    existsMessage: `Runtime extension is already installed: ${manifest.id}`,
  });

  const listed = listInstalledAgentRuntimeExtensions(mindRoot).find((item) => item.id === manifest.id);
  if (listed) return listed;
  throw new Error(`Failed to install runtime extension: ${manifest.id}`);
}

/**
 * Migration fallback for audit P2-6: applied ACP agent ids recorded in the
 * extension directory by installs that predate settings ownership. Callers
 * must prefer the host-settings record and only consult this when settings
 * carry no entry for the extension.
 */
export function readInstalledExtensionAppliedAcpAgents(
  mindRoot: string,
  manifest: AgentRuntimeExtensionManifest,
): Set<string> {
  const extensionDir = resolveExistingSafe(mindRoot, `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`);
  if (!existsSync(extensionDir)) return new Set();
  try {
    const metadata = readExtensionMetadata(join(extensionDir, EXTENSION_METADATA_FILE), manifest);
    return new Set(metadata.appliedAcpAgents);
  } catch {
    return new Set();
  }
}

export function extensionContributionCounts(
  manifest: AgentRuntimeExtensionManifest,
): AgentRuntimeExtensionContributionCounts {
  return {
    acpAdapters: manifest.contributes.acpAdapters.length,
    mcpServers: manifest.contributes.mcpServers.length,
    assistants: manifest.contributes.assistants.length,
    agents: manifest.contributes.agents.length,
    skills: manifest.contributes.skills.length,
    commands: manifest.contributes.commands.length,
    themes: manifest.contributes.themes.length,
    settingsTabs: manifest.contributes.settingsTabs.length,
  };
}

export function stripResolvedPaths(manifest: AgentRuntimeExtensionManifest): AgentRuntimeExtensionManifest {
  return JSON.parse(JSON.stringify(manifest, (_key, value) => (
    _key === 'resolvedPath' ? undefined : value
  ))) as AgentRuntimeExtensionManifest;
}

function buildExtensionMetadata(
  manifest: AgentRuntimeExtensionManifest,
  appliedAcpAgents: string[],
  now: Date,
  installedAt?: string,
): InstalledAgentRuntimeExtensionMetadata {
  return {
    schemaVersion: 1,
    source: 'agent-runtime-extension',
    extensionId: manifest.id,
    ...(manifest.version ? { version: manifest.version } : {}),
    installedAt: installedAt ?? now.toISOString(),
    ...(installedAt ? { updatedAt: now.toISOString() } : {}),
    contributionCounts: extensionContributionCounts(manifest),
    appliedAcpAgents,
    lifecycleScriptsDeclared: manifest.lifecycle.scripts.length,
  };
}

function readExistingInstalledAt(mindRoot: string, manifest: AgentRuntimeExtensionManifest): string | undefined {
  const extensionDir = resolveExistingSafe(mindRoot, `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`);
  if (!existsSync(extensionDir)) return undefined;
  try {
    const metadata = readExtensionMetadata(join(extensionDir, EXTENSION_METADATA_FILE), manifest);
    return metadata.installedAt;
  } catch {
    return undefined;
  }
}

function readExtensionMetadata(
  metadataPath: string,
  manifest: AgentRuntimeExtensionManifest,
): InstalledAgentRuntimeExtensionMetadata {
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf-8')) as Partial<InstalledAgentRuntimeExtensionMetadata>;
    if (parsed.schemaVersion === 1 && parsed.source === 'agent-runtime-extension' && parsed.extensionId === manifest.id) {
      return {
        schemaVersion: 1,
        source: 'agent-runtime-extension',
        extensionId: manifest.id,
        ...(typeof parsed.version === 'string' ? { version: parsed.version } : manifest.version ? { version: manifest.version } : {}),
        installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : new Date(0).toISOString(),
        ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
        contributionCounts: parsed.contributionCounts ?? extensionContributionCounts(manifest),
        appliedAcpAgents: Array.isArray(parsed.appliedAcpAgents)
          ? parsed.appliedAcpAgents.filter((item): item is string => typeof item === 'string')
          : [],
        lifecycleScriptsDeclared: typeof parsed.lifecycleScriptsDeclared === 'number'
          ? parsed.lifecycleScriptsDeclared
          : manifest.lifecycle.scripts.length,
      };
    }
  } catch {
    // Fall through to derived metadata for legacy or hand-written manifests.
  }
  return {
    schemaVersion: 1,
    source: 'agent-runtime-extension',
    extensionId: manifest.id,
    ...(manifest.version ? { version: manifest.version } : {}),
    installedAt: new Date(0).toISOString(),
    contributionCounts: extensionContributionCounts(manifest),
    appliedAcpAgents: manifest.contributes.acpAdapters.map((adapter) => adapter.id),
    lifecycleScriptsDeclared: manifest.lifecycle.scripts.length,
  };
}
