/**
 * HTTP handlers for agent runtime extensions — request/response shape only.
 *
 * Extension directory I/O lives in `agent/runtime/extension-store.ts`; the
 * staged-install swap, id rules, and fingerprint confirmation come from
 * `foundation/plugins` (spec-plugin-primitives). The public names this module
 * re-exports keep `server/index.ts` and the route table untouched.
 */

import { existsSync } from 'node:fs';
import {
  parseAgentRuntimeExtensionManifest,
  type AgentRuntimeExtensionManifest,
  type AgentRuntimeExtensionManifestDiagnostic,
} from '../../agent/runtime/extension-manifest.js';
import {
  EXTENSION_MANIFEST_FILE,
  EXTENSION_METADATA_FILE,
  MINDOS_RUNTIME_EXTENSIONS_ROOT,
  extensionContributionCounts,
  installAgentRuntimeExtension,
  listInstalledAgentRuntimeExtensions,
  readInstalledExtensionAppliedAcpAgents,
  stripResolvedPaths,
  type AgentRuntimeExtensionContributionCounts,
  type InstalledAgentRuntimeExtension,
  type InstalledAgentRuntimeExtensionMetadata,
} from '../../agent/runtime/extension-store.js';
import {
  AGENT_DESCRIPTORS,
  resolveAlias,
  type AcpAgentOverride,
} from '../../protocols/acp/agent-descriptors.js';
import { isSafeAgentId } from '../../agent/runtime/acp-overrides.js';
import { safePluginIdentifierIssue } from '../../foundation/plugins/safe-id.js';
import {
  evaluateInstallConfirmation,
  computeArtifactFingerprint,
  matchInstallConfirmationFingerprint,
} from '../../foundation/plugins/confirmation-receipt.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export {
  MINDOS_RUNTIME_EXTENSIONS_ROOT,
  listInstalledAgentRuntimeExtensions,
  type AgentRuntimeExtensionContributionCounts,
  type InstalledAgentRuntimeExtension,
  type InstalledAgentRuntimeExtensionMetadata,
};

export type RuntimeExtensionSettingsRecord = {
  /**
   * ACP agent ids this extension applied through a confirmed install/replace.
   * Host settings are the authorization record for `replace: true` (P2-6);
   * the extension-directory metadata file is display/migration fallback only.
   */
  appliedAcpAgents?: string[];
  updatedAt?: string;
};

export type RuntimeExtensionSettings = {
  acpAgents?: Record<string, AcpAgentOverride>;
  runtimeExtensions?: Record<string, RuntimeExtensionSettingsRecord>;
  [key: string]: unknown;
};

export type RuntimeExtensionServices = {
  mindRoot: string;
  readSettings(): RuntimeExtensionSettings;
  writeSettings(settings: RuntimeExtensionSettings): void;
  now?: () => Date;
};

export type AgentRuntimeExtensionPreflightPayload = {
  ok: true;
  readOnly: true;
  writePolicy: 'preflight-only';
  installable: boolean;
  blockedReasons: string[];
  warnings: string[];
  /**
   * Canonical-JSON sha256 fingerprint of everything the install would apply
   * (manifest, ACP overrides, replace flag). Install must echo it back via
   * `confirmFingerprint`; any change to the submitted manifest invalidates it.
   */
  fingerprint?: string;
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
  warnings: string[];
};

type RuntimeExtensionInstallBody = {
  manifest?: unknown;
  manifestJson?: unknown;
  extensionRoot?: unknown;
  confirm?: unknown;
  confirmFingerprint?: unknown;
  replace?: unknown;
};

const INSTALL_FINGERPRINT_SCHEMA = 'mindos.agent-runtime-extension.install.v1';
const FINGERPRINT_MISMATCH_MESSAGE =
  'Runtime extension confirmation does not match the submitted manifest. Re-run preflight and confirm the current fingerprint.';

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
    // P2-5: confirmation is fingerprint-based. A boolean `confirm: true` no
    // longer authorizes "whatever manifest arrives next"; the client must echo
    // the fingerprint from preflight. The legacy boolean stays accepted for
    // exactly one release with a deprecation warning (spec-plugin-primitives).
    const confirmation = evaluateInstallConfirmation(payload);
    if (confirmation.kind === 'missing' || confirmation.kind === 'invalid' || confirmation.kind === 'ambiguous') {
      return json({ error: 'Runtime extension install requires explicit confirmation.' }, { status: 400 });
    }

    const preflight = buildAgentRuntimeExtensionPreflight(body, services);
    if (!preflight.installable || !preflight.manifest || !preflight.extension) {
      return json({
        error: preflight.blockedReasons[0] ?? 'Runtime extension manifest is not installable.',
      }, { status: 409 });
    }

    const matched = matchInstallConfirmationFingerprint(confirmation, preflight.fingerprint ?? '', {
      mismatchMessage: FINGERPRINT_MISMATCH_MESSAGE,
    });
    if (!matched.ok) {
      return json({ error: matched.error }, { status: 409 });
    }
    const warnings = [...preflight.warnings, ...(matched.warning ? [matched.warning] : [])];

    const replace = payload.replace === true;
    const settings = services.readSettings();
    const existingAcpAgents = sanitizeAcpAgents(settings.acpAgents);
    const installed = installAgentRuntimeExtension(services.mindRoot, preflight.manifest, {
      appliedAcpAgents: preflight.acpAgentIds,
      replace,
      ...(services.now ? { now: services.now } : {}),
    });
    const nextAcpAgents = {
      ...existingAcpAgents,
      ...pickAcpAgentOverrides(preflight.acpAgentOverrides, preflight.acpAgentIds),
    };
    const nowIso = (services.now?.() ?? new Date()).toISOString();
    const runtimeExtensions = sanitizeRuntimeExtensionRecords(settings.runtimeExtensions);
    defineRecordProperty(runtimeExtensions, preflight.manifest.id, {
      appliedAcpAgents: [...preflight.acpAgentIds],
      updatedAt: nowIso,
    });
    services.writeSettings({ ...settings, acpAgents: nextAcpAgents, runtimeExtensions });

    return json({ ok: true, installed, preflight, acpAgents: nextAcpAgents, warnings }, { status: replace ? 200 : 201 });
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
      warnings: [],
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
    ? resolveReplaceableAcpAgents(services.mindRoot, settings, manifest)
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

  const acpAgentOverrides = pickAcpAgentOverrides(safeOverrides, acpAgentIds);
  return {
    ok: true,
    readOnly: true,
    writePolicy: 'preflight-only',
    installable: Boolean(manifest) && blockedReasons.length === 0,
    blockedReasons: Array.from(new Set(blockedReasons)),
    warnings: [],
    ...(manifest ? { fingerprint: installFingerprint(manifest, acpAgentOverrides, acpAgentIds, replace) } : {}),
    diagnostics,
    ...(extension ? { extension } : {}),
    ...(manifest ? { manifest } : {}),
    acpAgentOverrides,
    acpAgentIds,
  };
}

/**
 * Fingerprint of everything an install would apply. Derived only from the
 * submitted manifest (never from host state) so preflight and install agree
 * on identical input, while any manifest mutation — including a replayed
 * confirmation for a changed manifest — invalidates it.
 */
function installFingerprint(
  manifest: AgentRuntimeExtensionManifest,
  acpAgentOverrides: Record<string, AcpAgentOverride>,
  acpAgentIds: string[],
  replace: boolean,
): string {
  return computeArtifactFingerprint({
    schema: INSTALL_FINGERPRINT_SCHEMA,
    replace,
    manifest,
    acpAgentOverrides,
    acpAgentIds,
  });
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
    manifestPath: `${targetDir}/${EXTENSION_MANIFEST_FILE}`,
    metadataPath: `${targetDir}/${EXTENSION_METADATA_FILE}`,
    alreadyInstalled: existsSync(resolveExistingSafe(mindRoot, targetDir)),
    contributionCounts: extensionContributionCounts(manifest),
    lifecycleScriptsDeclared: manifest.lifecycle.scripts.length,
  };
}

/**
 * Authorization source for `replace: true` (audit P2-6). Host settings win
 * whenever they carry a record for the extension — the extension-directory
 * metadata file sits inside the mind root, so any agent with mind-root write
 * access could forge it to claim ownership of a user's custom ACP agent. The
 * directory file is only read as a migration fallback for installs that
 * predate settings ownership; the next successful install/replace rewrites
 * the record into settings and closes the window.
 */
function resolveReplaceableAcpAgents(
  mindRoot: string,
  settings: RuntimeExtensionSettings,
  manifest: AgentRuntimeExtensionManifest,
): Set<string> {
  const records = sanitizeRuntimeExtensionRecords(settings.runtimeExtensions);
  const record = Object.prototype.hasOwnProperty.call(records, manifest.id)
    ? records[manifest.id]
    : undefined;
  if (record) return new Set(record.appliedAcpAgents ?? []);
  return readInstalledExtensionAppliedAcpAgents(mindRoot, manifest);
}

function sanitizeRuntimeExtensionRecords(
  raw: unknown,
): Record<string, RuntimeExtensionSettingsRecord> {
  const result: Record<string, RuntimeExtensionSettingsRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    // Record keys are extension ids: validate with the same shared rules the
    // manifest parser uses (not the agent-id variant, which also rejects
    // Windows reserved device names that are legal extension ids).
    if (safePluginIdentifierIssue(key, { maxLength: 64 }) !== undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Partial<RuntimeExtensionSettingsRecord>;
    const applied = Array.isArray(record.appliedAcpAgents)
      ? record.appliedAcpAgents.filter((item): item is string => typeof item === 'string')
      : undefined;
    defineRecordProperty(result, key, {
      ...(applied ? { appliedAcpAgents: applied } : {}),
      ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
    });
  }
  return result;
}

/**
 * Own-property assignment that cannot hit the `__proto__` setter even if a
 * sanitized key somehow slipped through (keys are regex-gated upstream).
 */
function defineRecordProperty<T>(
  target: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
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
    if (!isSafeAgentId(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    defineRecordProperty(result, key, value as AcpAgentOverride);
  }
  return result;
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
