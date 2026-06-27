import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import {
  parseAgentRuntimeExtensionManifest,
  type AgentRuntimeExtensionManifest,
  type AgentRuntimeExtensionManifestDiagnostic,
} from '../../agent/runtime/extension-manifest.js';
import {
  AGENT_DESCRIPTORS,
  resolveAlias,
  type AcpAgentOverride,
} from '../../protocols/acp/agent-descriptors.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export const MINDOS_RUNTIME_EXTENSIONS_ROOT = '.mindos/runtime-extensions';

export type RuntimeExtensionSettings = {
  acpAgents?: Record<string, AcpAgentOverride>;
  [key: string]: unknown;
};

export type RuntimeExtensionServices = {
  mindRoot: string;
  readSettings(): RuntimeExtensionSettings;
  writeSettings(settings: RuntimeExtensionSettings): void;
  now?: () => Date;
};

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

export type AgentRuntimeExtensionPreflightPayload = {
  ok: true;
  readOnly: true;
  writePolicy: 'preflight-only';
  installable: boolean;
  blockedReasons: string[];
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[];
  extension?: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    root: typeof MINDOS_RUNTIME_EXTENSIONS_ROOT;
    targetDir: string;
    manifestPath: string;
    metadataPath: string;
    alreadyInstalled: boolean;
    contributionCounts: AgentRuntimeExtensionContributionCounts;
    lifecycleScriptsDeclared: number;
  };
  manifest?: AgentRuntimeExtensionManifest;
  acpAgentOverrides: Record<string, AcpAgentOverride>;
  acpAgentIds: string[];
};

export type AgentRuntimeExtensionInstallPayload = {
  ok: true;
  installed: InstalledAgentRuntimeExtension;
  preflight: AgentRuntimeExtensionPreflightPayload;
  acpAgents: Record<string, AcpAgentOverride>;
};

type RuntimeExtensionInstallBody = {
  manifest?: unknown;
  manifestJson?: unknown;
  extensionRoot?: unknown;
  confirm?: unknown;
  replace?: unknown;
};

const METADATA_FILE = 'mindos-runtime-extension.json';
const MANIFEST_FILE = 'manifest.json';

export function handleAgentRuntimeExtensionsGet(
  services: Pick<RuntimeExtensionServices, 'mindRoot'>,
): MindosServerResponse<{ extensions: InstalledAgentRuntimeExtension[] } | { error: string }> {
  try {
    return json({
      extensions: listInstalledAgentRuntimeExtensions(services.mindRoot),
    }, { headers: privateCacheHeaders(10) });
  } catch (error) {
    return runtimeExtensionErrorResponse(error);
  }
}

export function handleAgentRuntimeExtensionPreflightPost(
  body: unknown,
  services: Pick<RuntimeExtensionServices, 'mindRoot' | 'readSettings'>,
): MindosServerResponse<AgentRuntimeExtensionPreflightPayload | { error: string }> {
  try {
    return json(buildAgentRuntimeExtensionPreflight(body, services));
  } catch (error) {
    return runtimeExtensionErrorResponse(error);
  }
}

export function handleAgentRuntimeExtensionInstallPost(
  body: unknown,
  services: RuntimeExtensionServices,
): MindosServerResponse<AgentRuntimeExtensionInstallPayload | { error: string }> {
  try {
    const payload = objectBody(body) as RuntimeExtensionInstallBody;
    if (payload.confirm !== true) {
      return json({ error: 'Runtime extension install requires explicit confirmation.' }, { status: 400 });
    }

    const preflight = buildAgentRuntimeExtensionPreflight(body, services);
    if (!preflight.installable || !preflight.manifest || !preflight.extension) {
      return json({
        error: preflight.blockedReasons[0] ?? 'Runtime extension manifest is not installable.',
      }, { status: 409 });
    }

    const replace = payload.replace === true;
    const settings = services.readSettings();
    const existingAcpAgents = sanitizeAcpAgents(settings.acpAgents);
    const installed = writeInstalledExtension(preflight.manifest, preflight.acpAgentIds, services, replace);
    const nextAcpAgents = {
      ...existingAcpAgents,
      ...pickAcpAgentOverrides(preflight.acpAgentOverrides, preflight.acpAgentIds),
    };
    services.writeSettings({ ...settings, acpAgents: nextAcpAgents });

    return json({ ok: true, installed, preflight, acpAgents: nextAcpAgents }, { status: replace ? 200 : 201 });
  } catch (error) {
    return runtimeExtensionErrorResponse(error);
  }
}

export function buildAgentRuntimeExtensionPreflight(
  body: unknown,
  services: Pick<RuntimeExtensionServices, 'mindRoot' | 'readSettings'>,
): AgentRuntimeExtensionPreflightPayload {
  const payload = objectBody(body) as RuntimeExtensionInstallBody;
  const rawManifest = readManifestInput(payload);
  if (!rawManifest.ok) {
    return {
      ok: true,
      readOnly: true,
      writePolicy: 'preflight-only',
      installable: false,
      blockedReasons: [rawManifest.error],
      diagnostics: [{
        code: 'invalid-manifest-input',
        severity: 'error',
        summary: rawManifest.error,
      }],
      acpAgentOverrides: {},
      acpAgentIds: [],
    };
  }

  const parseResult = parseAgentRuntimeExtensionManifest(rawManifest.manifest, {
    extensionRoot: typeof payload.extensionRoot === 'string' ? payload.extensionRoot.trim() || undefined : undefined,
  });
  const diagnostics = [...parseResult.diagnostics];
  const blockedReasons: string[] = [];
  const manifest = parseResult.manifest ? stripResolvedPaths(parseResult.manifest) : undefined;
  const safeOverrides = sanitizeAcpAgents(parseResult.acpAgentOverrides);
  const acpAgentIds = filterInstallableAcpAgentIds(safeOverrides, diagnostics, blockedReasons);
  const replace = payload.replace === true;

  if (!manifest) {
    blockedReasons.push('Extension manifest could not be parsed.');
  }

  const extension = manifest ? extensionSummary(manifest, services.mindRoot) : undefined;
  if (manifest && extension?.alreadyInstalled && !replace) {
    blockedReasons.push(`Runtime extension is already installed: ${manifest.id}`);
    diagnostics.push({
      code: 'runtime-extension-already-installed',
      severity: 'error',
      summary: `Runtime extension "${manifest.id}" is already installed. Pass replace: true to update it.`,
      path: 'id',
    });
  }

  const settings = safeReadSettings(services);
  const existingAcpAgents = sanitizeAcpAgents(settings.acpAgents);
  const replaceableAcpAgents = manifest && replace
    ? readInstalledExtensionAppliedAcpAgents(services.mindRoot, manifest)
    : new Set<string>();
  for (const agentId of acpAgentIds) {
    if (existingAcpAgents[agentId] && !replaceableAcpAgents.has(agentId)) {
      blockedReasons.push(`ACP agent already configured: ${agentId}`);
      diagnostics.push({
        code: 'acp-agent-conflict',
        severity: 'error',
        summary: `ACP agent "${agentId}" already exists in MindOS settings.`,
        path: `contributes.acpAdapters.${agentId}`,
      });
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    blockedReasons.push('Extension manifest has error diagnostics.');
  }

  return {
    ok: true,
    readOnly: true,
    writePolicy: 'preflight-only',
    installable: Boolean(manifest) && blockedReasons.length === 0,
    blockedReasons: Array.from(new Set(blockedReasons)),
    diagnostics,
    ...(extension ? { extension } : {}),
    ...(manifest ? { manifest } : {}),
    acpAgentOverrides: pickAcpAgentOverrides(safeOverrides, acpAgentIds),
    acpAgentIds,
  };
}

export function listInstalledAgentRuntimeExtensions(mindRoot: string): InstalledAgentRuntimeExtension[] {
  const rootDir = runtimeExtensionsRootDir(mindRoot);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) return [];

  const installed: InstalledAgentRuntimeExtension[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extensionDir = join(rootDir, entry.name);
    const manifestPath = join(extensionDir, MANIFEST_FILE);
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) continue;

    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
      const parsed = parseAgentRuntimeExtensionManifest(raw, { extensionRoot: extensionDir });
      if (!parsed.manifest) continue;
      const manifest = stripResolvedPaths(parsed.manifest);
      const metadataPath = join(extensionDir, METADATA_FILE);
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

function writeInstalledExtension(
  manifest: AgentRuntimeExtensionManifest,
  appliedAcpAgents: string[],
  services: RuntimeExtensionServices,
  replace: boolean,
): InstalledAgentRuntimeExtension {
  const rootDir = runtimeExtensionsRootDir(services.mindRoot);
  mkdirSync(rootDir, { recursive: true });
  const targetDir = resolveExistingSafe(services.mindRoot, `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`);
  const alreadyInstalled = existsSync(targetDir);
  if (alreadyInstalled && !replace) {
    throw new Error(`Runtime extension is already installed: ${manifest.id}`);
  }

  const stageDir = `${targetDir}.installing-${process.pid}-${Date.now()}`;
  const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`;
  const now = services.now?.() ?? new Date();
  const installedAt = alreadyInstalled
    ? readExistingInstalledAt(services.mindRoot, manifest)
    : undefined;
  const metadata = buildExtensionMetadata(manifest, appliedAcpAgents, now, installedAt);

  try {
    rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, MANIFEST_FILE), `${JSON.stringify(stripResolvedPaths(manifest), null, 2)}\n`, 'utf-8');
    writeFileSync(join(stageDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');

    if (alreadyInstalled) {
      renameSync(targetDir, backupDir);
    }
    renameSync(stageDir, targetDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    rmSync(stageDir, { recursive: true, force: true });
    if (!existsSync(targetDir) && existsSync(backupDir)) {
      renameSync(backupDir, targetDir);
    } else {
      rmSync(backupDir, { recursive: true, force: true });
    }
    throw error;
  }

  const listed = listInstalledAgentRuntimeExtensions(services.mindRoot).find((item) => item.id === manifest.id);
  if (listed) return listed;
  throw new Error(`Failed to install runtime extension: ${manifest.id}`);
}

function runtimeExtensionsRootDir(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT);
}

function extensionSummary(manifest: AgentRuntimeExtensionManifest, mindRoot: string): AgentRuntimeExtensionPreflightPayload['extension'] {
  const targetDir = `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`;
  return {
    id: manifest.id,
    name: manifest.displayName ?? manifest.name,
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
    root: MINDOS_RUNTIME_EXTENSIONS_ROOT,
    targetDir,
    manifestPath: `${targetDir}/${MANIFEST_FILE}`,
    metadataPath: `${targetDir}/${METADATA_FILE}`,
    alreadyInstalled: existsSync(resolveExistingSafe(mindRoot, targetDir)),
    contributionCounts: contributionCounts(manifest),
    lifecycleScriptsDeclared: manifest.lifecycle.scripts.length,
  };
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
    contributionCounts: contributionCounts(manifest),
    appliedAcpAgents,
    lifecycleScriptsDeclared: manifest.lifecycle.scripts.length,
  };
}

function readExistingInstalledAt(mindRoot: string, manifest: AgentRuntimeExtensionManifest): string | undefined {
  const extensionDir = resolveExistingSafe(mindRoot, `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`);
  if (!existsSync(extensionDir)) return undefined;
  try {
    const metadata = readExtensionMetadata(join(extensionDir, METADATA_FILE), manifest);
    return metadata.installedAt;
  } catch {
    return undefined;
  }
}

function readInstalledExtensionAppliedAcpAgents(
  mindRoot: string,
  manifest: AgentRuntimeExtensionManifest,
): Set<string> {
  const extensionDir = resolveExistingSafe(mindRoot, `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/${manifest.id}`);
  if (!existsSync(extensionDir)) return new Set();
  try {
    const metadata = readExtensionMetadata(join(extensionDir, METADATA_FILE), manifest);
    return new Set(metadata.appliedAcpAgents);
  } catch {
    return new Set();
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
        contributionCounts: parsed.contributionCounts ?? contributionCounts(manifest),
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
    contributionCounts: contributionCounts(manifest),
    appliedAcpAgents: manifest.contributes.acpAdapters.map((adapter) => adapter.id),
    lifecycleScriptsDeclared: manifest.lifecycle.scripts.length,
  };
}

function contributionCounts(manifest: AgentRuntimeExtensionManifest): AgentRuntimeExtensionContributionCounts {
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

function readManifestInput(payload: RuntimeExtensionInstallBody): { ok: true; manifest: unknown } | { ok: false; error: string } {
  if ('manifest' in payload) return { ok: true, manifest: payload.manifest };
  if (typeof payload.manifestJson === 'string') {
    try {
      return { ok: true, manifest: JSON.parse(payload.manifestJson) as unknown };
    } catch {
      return { ok: false, error: 'manifestJson must contain valid JSON.' };
    }
  }
  return { ok: false, error: 'manifest or manifestJson is required.' };
}

function filterInstallableAcpAgentIds(
  overrides: Record<string, AcpAgentOverride>,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  blockedReasons: string[],
): string[] {
  const ids: string[] = [];
  for (const [agentId, override] of Object.entries(overrides)) {
    if (isBuiltInAcpAgentId(agentId)) {
      blockedReasons.push(`ACP adapter id collides with a built-in agent: ${agentId}`);
      diagnostics.push({
        code: 'acp-agent-built-in-collision',
        severity: 'error',
        summary: `ACP adapter "${agentId}" would override a built-in MindOS agent and was blocked.`,
        path: `contributes.acpAdapters.${agentId}`,
      });
      continue;
    }
    if (!override.command) {
      blockedReasons.push(`ACP adapter requires a command: ${agentId}`);
      diagnostics.push({
        code: 'acp-agent-missing-command',
        severity: 'error',
        summary: `ACP adapter "${agentId}" requires a command before it can be installed.`,
        path: `contributes.acpAdapters.${agentId}`,
      });
      continue;
    }
    ids.push(agentId);
  }
  return ids;
}

function isBuiltInAcpAgentId(agentId: string): boolean {
  return Boolean(AGENT_DESCRIPTORS[resolveAlias(agentId)]);
}

function pickAcpAgentOverrides(
  overrides: Record<string, AcpAgentOverride>,
  ids: string[],
): Record<string, AcpAgentOverride> {
  const picked: Record<string, AcpAgentOverride> = {};
  for (const id of ids) {
    const override = overrides[id];
    if (override) picked[id] = override;
  }
  return picked;
}

function sanitizeAcpAgents(raw: unknown): Record<string, AcpAgentOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, AcpAgentOverride> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    result[key] = value as AcpAgentOverride;
  }
  return result;
}

function stripResolvedPaths(manifest: AgentRuntimeExtensionManifest): AgentRuntimeExtensionManifest {
  return JSON.parse(JSON.stringify(manifest, (_key, value) => (
    _key === 'resolvedPath' ? undefined : value
  ))) as AgentRuntimeExtensionManifest;
}

function safeReadSettings(
  services: Pick<RuntimeExtensionServices, 'readSettings'>,
): RuntimeExtensionSettings {
  try {
    return services.readSettings();
  } catch {
    return {};
  }
}

function objectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function runtimeExtensionErrorResponse(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  if (/access denied|outside root|absolute paths|symlink/i.test(message)) {
    return json({ error: 'Access denied' }, { status: 403 });
  }
  if (/already installed|already configured|conflict/i.test(message)) {
    return json({ error: message }, { status: 409 });
  }
  return json({ error: message }, { status: 500 });
}
