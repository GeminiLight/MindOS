import path from 'node:path';
import { redactSensitiveObject, redactSensitiveText } from '../redaction.js';
import {
  parseAcpAgentOverrides,
  type AcpAgentAdapterMetadata,
  type AcpAgentOverride,
} from '../../protocols/acp/agent-descriptors.js';

export type AgentRuntimeExtensionManifestDiagnosticSeverity = 'info' | 'warning' | 'error';

export type AgentRuntimeExtensionManifestDiagnostic = {
  code: string;
  severity: AgentRuntimeExtensionManifestDiagnosticSeverity;
  summary: string;
  path?: string;
};

export type AgentRuntimeExtensionFileRef = {
  kind: 'file';
  path: string;
  resolvedPath?: string;
};

export type AgentRuntimeExtensionTextRef =
  | { kind: 'inline'; text: string }
  | AgentRuntimeExtensionFileRef;

export type AgentRuntimeExtensionAcpAdapterContribution = {
  id: string;
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  detectCommands?: string[];
  presenceDirs?: string[];
  installCmd?: string;
  enabled?: boolean;
  adapterMetadata?: AcpAgentAdapterMetadata;
};

export type AgentRuntimeExtensionMcpServerContribution = {
  id: string;
  name?: string;
  description?: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
};

export type AgentRuntimeExtensionAssistantContribution = {
  id: string;
  name: string;
  description?: string;
  runtimeId?: string;
  model?: string;
  prompt?: AgentRuntimeExtensionTextRef;
};

export type AgentRuntimeExtensionAgentContribution = {
  id: string;
  name: string;
  description?: string;
  runtimeId?: string;
  command?: string;
  args?: string[];
  manifest?: AgentRuntimeExtensionFileRef;
};

export type AgentRuntimeExtensionSkillContribution = {
  id: string;
  name: string;
  description?: string;
  path?: AgentRuntimeExtensionFileRef;
  entry?: AgentRuntimeExtensionFileRef;
  runtimeId?: string;
};

export type AgentRuntimeExtensionCommandContribution = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  runtimeId?: string;
  slash?: string;
  command?: string;
};

export type AgentRuntimeExtensionContributes = {
  acpAdapters: AgentRuntimeExtensionAcpAdapterContribution[];
  mcpServers: AgentRuntimeExtensionMcpServerContribution[];
  assistants: AgentRuntimeExtensionAssistantContribution[];
  agents: AgentRuntimeExtensionAgentContribution[];
  skills: AgentRuntimeExtensionSkillContribution[];
  commands: AgentRuntimeExtensionCommandContribution[];
  themes: Array<Record<string, unknown>>;
  settingsTabs: Array<Record<string, unknown>>;
};

export type AgentRuntimeExtensionLifecycle = {
  supported: false;
  scripts: Array<{
    name: string;
    path?: string;
    summary: string;
  }>;
};

export type AgentRuntimeExtensionManifest = {
  schemaVersion: 0;
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  icon?: AgentRuntimeExtensionFileRef;
  engines?: Record<string, string>;
  permissions: string[];
  contributes: AgentRuntimeExtensionContributes;
  lifecycle: AgentRuntimeExtensionLifecycle;
};

export type ParseAgentRuntimeExtensionManifestOptions = {
  extensionRoot?: string;
};

export type ParseAgentRuntimeExtensionManifestResult = {
  manifest?: AgentRuntimeExtensionManifest;
  acpAgentOverrides: Record<string, AcpAgentOverride>;
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[];
};

const MAX_STRING = 500;
const MAX_LONG_STRING = 2000;
const MAX_ITEMS = 100;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SAFE_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
const CONTROL_CHARS_RE = /[\x00-\x1f]/;
const SECRETISH_KEY_RE = /(?:api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|app[_-]?secret|bot[_-]?token|webhook)/i;

export function parseAgentRuntimeExtensionManifest(
  raw: unknown,
  options: ParseAgentRuntimeExtensionManifestOptions = {},
): ParseAgentRuntimeExtensionManifestResult {
  const diagnostics: AgentRuntimeExtensionManifestDiagnostic[] = [];
  if (!isRecord(raw)) {
    diagnostics.push(diagnostic('invalid-manifest', 'error', 'Extension manifest must be an object.'));
    return { acpAgentOverrides: {}, diagnostics };
  }

  const id = sanitizeId(raw.id ?? raw.name);
  if (!id) {
    diagnostics.push(diagnostic('invalid-id', 'error', 'Extension manifest requires a safe id or name.'));
    return { acpAgentOverrides: {}, diagnostics };
  }

  const name = sanitizeString(raw.name ?? raw.displayName, 120) ?? id;
  const contributesRecord = isRecord(raw.contributes) ? raw.contributes : {};
  const acpAgentOverrides = sanitizeAcpAgentOverrides(parseAcpAgentOverrides(raw) ?? {});
  const contributes = parseContributes(contributesRecord, acpAgentOverrides, diagnostics, options);
  const lifecycle = parseLifecycle(raw.lifecycle, diagnostics, options);
  const icon = sanitizeFileRef(raw.icon, 'icon', diagnostics, options);
  const permissions = sanitizeStringArray(raw.permissions, 50, 120)
    .filter((permission) => !SECRETISH_KEY_RE.test(permission));

  const schema = sanitizeString(raw.$schema ?? raw.schema ?? raw.schemaVersion, 200);
  if (schema && !isKnownSchema(schema)) {
    diagnostics.push(diagnostic(
      'unknown-schema',
      'warning',
      'Extension manifest schema is not recognized; MindOS parsed the stable v0 subset.',
      '$schema',
    ));
  }

  const manifest: AgentRuntimeExtensionManifest = {
    schemaVersion: 0,
    id,
    name,
    ...(sanitizeString(raw.displayName, 120) ? { displayName: sanitizeString(raw.displayName, 120) } : {}),
    ...(sanitizeString(raw.version, 80) ? { version: sanitizeString(raw.version, 80) } : {}),
    ...(sanitizeString(raw.description, MAX_STRING) ? { description: sanitizeString(raw.description, MAX_STRING) } : {}),
    ...(sanitizeString(raw.author, 160) ? { author: sanitizeString(raw.author, 160) } : {}),
    ...(sanitizeUrl(raw.homepage) ? { homepage: sanitizeUrl(raw.homepage) } : {}),
    ...(icon ? { icon } : {}),
    ...(parseEngines(raw.engines) ? { engines: parseEngines(raw.engines) } : {}),
    permissions,
    contributes,
    lifecycle,
  };

  if (lifecycle.scripts.length > 0) {
    diagnostics.push(diagnostic(
      'lifecycle-scripts-declared-only',
      'warning',
      'Extension lifecycle scripts were recorded but will not be executed by the runtime manifest parser.',
      'lifecycle',
    ));
  }

  return {
    manifest,
    acpAgentOverrides,
    diagnostics,
  };
}

function parseContributes(
  contributes: Record<string, unknown>,
  acpAgentOverrides: Record<string, AcpAgentOverride>,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionContributes {
  return {
    acpAdapters: Object.entries(acpAgentOverrides).map(([id, override]) => ({
      id,
      ...(override.name ? { name: override.name } : {}),
      ...(override.description ? { description: override.description } : {}),
      ...(override.command ? { command: override.command } : {}),
      ...(override.args ? { args: override.args } : {}),
      ...(override.detectCommands ? { detectCommands: override.detectCommands } : {}),
      ...(override.presenceDirs ? { presenceDirs: override.presenceDirs } : {}),
      ...(override.installCmd ? { installCmd: override.installCmd } : {}),
      ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
      ...(override.adapterMetadata ? { adapterMetadata: override.adapterMetadata } : {}),
    })),
    mcpServers: parseMcpServers(contributes.mcpServers, diagnostics),
    assistants: parseAssistants(contributes.assistants, diagnostics, options),
    agents: parseAgents(contributes.agents, diagnostics, options),
    skills: parseSkills(contributes.skills, diagnostics, options),
    commands: parseCommands(contributes.commands, diagnostics),
    themes: parseOpaqueContributions(contributes.themes, 'themes'),
    settingsTabs: parseOpaqueContributions(contributes.settingsTabs ?? contributes.configurationTabs, 'settingsTabs'),
  };
}

function sanitizeAcpAgentOverrides(overrides: Record<string, AcpAgentOverride>): Record<string, AcpAgentOverride> {
  const safe: Record<string, AcpAgentOverride> = {};
  for (const [id, override] of Object.entries(overrides)) {
    if (!sanitizeId(id)) continue;
    const copy: AcpAgentOverride = {
      ...override,
      ...(override.adapterMetadata ? { adapterMetadata: redactSensitiveObject(override.adapterMetadata) } : {}),
    };
    delete copy.env;
    safe[id] = copy;
  }
  return safe;
}

function parseMcpServers(
  raw: unknown,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
): AgentRuntimeExtensionMcpServerContribution[] {
  return contributionEntries(raw)
    .map(([fallbackId, entry], index) => {
      const id = sanitizeId(entry.id ?? entry.name ?? fallbackId);
      if (!id) {
        diagnostics.push(diagnostic('invalid-mcp-server-id', 'warning', 'Skipped MCP server contribution with an invalid id.', `contributes.mcpServers.${index}`));
        return null;
      }
      const type = sanitizeMcpServerType(entry.type ?? entry.transport ?? (entry.url ? 'http' : 'stdio'));
      const command = sanitizeString(entry.command ?? entry.cmd, 240);
      const url = sanitizeUrl(entry.url);
      if (type === 'stdio' && !command) {
        diagnostics.push(diagnostic('invalid-mcp-stdio-server', 'warning', `Skipped MCP server "${id}" because stdio servers require a command.`, `contributes.mcpServers.${id}`));
        return null;
      }
      if ((type === 'http' || type === 'sse') && !url) {
        diagnostics.push(diagnostic('invalid-mcp-remote-server', 'warning', `Skipped MCP server "${id}" because remote servers require a safe url.`, `contributes.mcpServers.${id}`));
        return null;
      }
      return {
        id,
        ...(sanitizeString(entry.name, 120) ? { name: sanitizeString(entry.name, 120) } : {}),
        ...(sanitizeString(entry.description, MAX_STRING) ? { description: sanitizeString(entry.description, MAX_STRING) } : {}),
        type,
        ...(command ? { command } : {}),
        ...(sanitizeStringArray(entry.args, 50, 240).length > 0 ? { args: sanitizeStringArray(entry.args, 50, 240) } : {}),
        ...(url ? { url } : {}),
      };
    })
    .filter((server): server is AgentRuntimeExtensionMcpServerContribution => server !== null)
    .slice(0, MAX_ITEMS);
}

function parseAssistants(
  raw: unknown,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionAssistantContribution[] {
  return contributionEntries(raw)
    .map(([fallbackId, entry], index) => {
      const id = sanitizeId(entry.id ?? entry.name ?? fallbackId);
      const name = sanitizeString(entry.name ?? entry.title, 120);
      if (!id || !name) {
        diagnostics.push(diagnostic('invalid-assistant', 'warning', 'Skipped assistant contribution with an invalid id or name.', `contributes.assistants.${index}`));
        return null;
      }
      const prompt = sanitizeTextRef(entry.prompt ?? entry.instructions ?? entry.systemPrompt, `contributes.assistants.${id}.prompt`, diagnostics, options);
      return {
        id,
        name,
        ...(sanitizeString(entry.description, MAX_STRING) ? { description: sanitizeString(entry.description, MAX_STRING) } : {}),
        ...(sanitizeId(entry.runtimeId ?? entry.runtime) ? { runtimeId: sanitizeId(entry.runtimeId ?? entry.runtime) } : {}),
        ...(sanitizeString(entry.model, 120) ? { model: sanitizeString(entry.model, 120) } : {}),
        ...(prompt ? { prompt } : {}),
      };
    })
    .filter((assistant): assistant is AgentRuntimeExtensionAssistantContribution => assistant !== null)
    .slice(0, MAX_ITEMS);
}

function parseAgents(
  raw: unknown,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionAgentContribution[] {
  return contributionEntries(raw)
    .map(([fallbackId, entry], index) => {
      const id = sanitizeId(entry.id ?? entry.name ?? fallbackId);
      const name = sanitizeString(entry.name ?? entry.title, 120);
      if (!id || !name) {
        diagnostics.push(diagnostic('invalid-agent', 'warning', 'Skipped agent contribution with an invalid id or name.', `contributes.agents.${index}`));
        return null;
      }
      const manifest = sanitizeFileRef(entry.manifest ?? entry.manifestPath, `contributes.agents.${id}.manifest`, diagnostics, options);
      return {
        id,
        name,
        ...(sanitizeString(entry.description, MAX_STRING) ? { description: sanitizeString(entry.description, MAX_STRING) } : {}),
        ...(sanitizeId(entry.runtimeId ?? entry.runtime) ? { runtimeId: sanitizeId(entry.runtimeId ?? entry.runtime) } : {}),
        ...(sanitizeString(entry.command ?? entry.cliCommand, 240) ? { command: sanitizeString(entry.command ?? entry.cliCommand, 240) } : {}),
        ...(sanitizeStringArray(entry.args ?? entry.acpArgs, 50, 240).length > 0 ? { args: sanitizeStringArray(entry.args ?? entry.acpArgs, 50, 240) } : {}),
        ...(manifest ? { manifest } : {}),
      };
    })
    .filter((agent): agent is AgentRuntimeExtensionAgentContribution => agent !== null)
    .slice(0, MAX_ITEMS);
}

function parseSkills(
  raw: unknown,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionSkillContribution[] {
  return contributionEntries(raw)
    .map(([fallbackId, entry], index) => {
      const id = sanitizeId(entry.id ?? entry.name ?? fallbackId);
      const name = sanitizeString(entry.name ?? entry.title, 120);
      if (!id || !name) {
        diagnostics.push(diagnostic('invalid-skill', 'warning', 'Skipped skill contribution with an invalid id or name.', `contributes.skills.${index}`));
        return null;
      }
      const skillPath = sanitizeFileRef(entry.path ?? entry.dir, `contributes.skills.${id}.path`, diagnostics, options);
      const entryRef = sanitizeFileRef(entry.entry ?? entry.file ?? entry.skill, `contributes.skills.${id}.entry`, diagnostics, options);
      return {
        id,
        name,
        ...(sanitizeString(entry.description, MAX_STRING) ? { description: sanitizeString(entry.description, MAX_STRING) } : {}),
        ...(skillPath ? { path: skillPath } : {}),
        ...(entryRef ? { entry: entryRef } : {}),
        ...(sanitizeId(entry.runtimeId ?? entry.runtime) ? { runtimeId: sanitizeId(entry.runtimeId ?? entry.runtime) } : {}),
      };
    })
    .filter((skill): skill is AgentRuntimeExtensionSkillContribution => skill !== null)
    .slice(0, MAX_ITEMS);
}

function parseCommands(
  raw: unknown,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
): AgentRuntimeExtensionCommandContribution[] {
  return contributionEntries(raw)
    .map(([fallbackId, entry], index) => {
      const id = sanitizeId(entry.id ?? entry.name ?? fallbackId);
      const title = sanitizeString(entry.title ?? entry.name ?? entry.label, 120);
      if (!id || !title) {
        diagnostics.push(diagnostic('invalid-command', 'warning', 'Skipped command contribution with an invalid id or title.', `contributes.commands.${index}`));
        return null;
      }
      const slash = sanitizeSlashCommand(entry.slash ?? entry.commandId ?? entry.name);
      return {
        id,
        title,
        ...(sanitizeString(entry.description, MAX_STRING) ? { description: sanitizeString(entry.description, MAX_STRING) } : {}),
        ...(sanitizeString(entry.category, 120) ? { category: sanitizeString(entry.category, 120) } : {}),
        ...(sanitizeId(entry.runtimeId ?? entry.runtime) ? { runtimeId: sanitizeId(entry.runtimeId ?? entry.runtime) } : {}),
        ...(slash ? { slash } : {}),
        ...(sanitizeString(entry.command, 240) ? { command: sanitizeString(entry.command, 240) } : {}),
      };
    })
    .filter((command): command is AgentRuntimeExtensionCommandContribution => command !== null)
    .slice(0, MAX_ITEMS);
}

function parseLifecycle(
  raw: unknown,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionLifecycle {
  if (!isRecord(raw)) return { supported: false, scripts: [] };
  const scripts: AgentRuntimeExtensionLifecycle['scripts'] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (SECRETISH_KEY_RE.test(name)) continue;
    const scriptPath = typeof value === 'string'
      ? sanitizeRelativePath(value, `lifecycle.${name}`, diagnostics, options)
      : isRecord(value)
        ? sanitizeRelativePath(value.path ?? value.script, `lifecycle.${name}.path`, diagnostics, options)
        : undefined;
    scripts.push({
      name: sanitizeString(name, 80) ?? 'script',
      ...(scriptPath ? { path: scriptPath.path } : {}),
      summary: 'Declared only; MindOS does not execute manifest lifecycle scripts.',
    });
  }
  return { supported: false, scripts: scripts.slice(0, 20) };
}

function parseOpaqueContributions(raw: unknown, contributionName: string): Array<Record<string, unknown>> {
  return contributionEntries(raw)
    .map(([, entry]) => ({
      ...redactSensitiveObject(entry),
      contribution: contributionName,
    }))
    .slice(0, MAX_ITEMS);
}

function parseEngines(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  const engines: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const safeKey = sanitizeString(key, 80);
    const safeValue = sanitizeString(value, 120);
    if (safeKey && safeValue && !SECRETISH_KEY_RE.test(safeKey)) engines[safeKey] = safeValue;
  }
  return Object.keys(engines).length > 0 ? engines : undefined;
}

function sanitizeTextRef(
  raw: unknown,
  fieldPath: string,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionTextRef | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('$file:')) {
    return sanitizeFileRef(trimmed, fieldPath, diagnostics, options);
  }
  return { kind: 'inline', text: sanitizeString(redactSensitiveText(trimmed), MAX_LONG_STRING) ?? '' };
}

function sanitizeFileRef(
  raw: unknown,
  fieldPath: string,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionFileRef | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().startsWith('$file:')
    ? raw.trim().slice('$file:'.length)
    : raw.trim();
  return sanitizeRelativePath(value, fieldPath, diagnostics, options);
}

function sanitizeRelativePath(
  raw: unknown,
  fieldPath: string,
  diagnostics: AgentRuntimeExtensionManifestDiagnostic[],
  options: ParseAgentRuntimeExtensionManifestOptions,
): AgentRuntimeExtensionFileRef | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  const slashPath = value.replace(/\\/g, '/');
  if (
    CONTROL_CHARS_RE.test(value)
    || path.posix.isAbsolute(slashPath)
    || path.win32.isAbsolute(value)
    || WINDOWS_DRIVE_RE.test(value)
  ) {
    diagnostics.push(diagnostic('unsafe-path', 'warning', `Ignored unsafe absolute path in ${fieldPath}.`, fieldPath));
    return undefined;
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    diagnostics.push(diagnostic('unsafe-path', 'warning', `Ignored unsafe path traversal in ${fieldPath}.`, fieldPath));
    return undefined;
  }
  if (normalized.split('/').some((segment) => segment === '__proto__' || segment === 'constructor' || segment === 'prototype')) {
    diagnostics.push(diagnostic('unsafe-path', 'warning', `Ignored unsafe prototype path segment in ${fieldPath}.`, fieldPath));
    return undefined;
  }
  if (!options.extensionRoot) return { kind: 'file', path: normalized };

  const root = path.resolve(options.extensionRoot);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    diagnostics.push(diagnostic('unsafe-path', 'warning', `Ignored path outside the extension root in ${fieldPath}.`, fieldPath));
    return undefined;
  }
  return { kind: 'file', path: normalized, resolvedPath: resolved };
}

function contributionEntries(raw: unknown): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(raw)) {
    return raw
      .filter(isRecord)
      .map((entry, index) => [String(index), entry]);
  }
  if (isRecord(raw)) {
    return Object.entries(raw)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
  }
  return [];
}

function sanitizeMcpServerType(raw: unknown): AgentRuntimeExtensionMcpServerContribution['type'] {
  return raw === 'http' || raw === 'sse' || raw === 'stdio' ? raw : 'stdio';
}

function sanitizeSlashCommand(raw: unknown): string | undefined {
  const value = sanitizeString(raw, 80);
  if (!value) return undefined;
  const command = value.startsWith('/') ? value : `/${value}`;
  return /^\/[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(command) ? command : undefined;
}

function sanitizeUrl(raw: unknown): string | undefined {
  const value = sanitizeString(raw, MAX_STRING);
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value)) return undefined;
  return redactSensitiveText(value);
}

function sanitizeId(raw: unknown): string | undefined {
  const value = sanitizeString(raw, 120);
  if (!value || !SAFE_ID_RE.test(value)) return undefined;
  if (value === '__proto__' || value === 'constructor' || value === 'prototype') return undefined;
  return value;
}

function sanitizeStringArray(raw: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw
    .map((entry) => sanitizeString(entry, maxLength))
    .filter((entry): entry is string => !!entry)))
    .slice(0, maxItems);
}

function sanitizeString(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = redactSensitiveText(raw).trim();
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return undefined;
  return trimmed.slice(0, maxLength);
}

function isKnownSchema(schema: string): boolean {
  return schema === '0'
    || schema === 'v0'
    || schema === 'mindos.agent-runtime.extension.v0'
    || schema === 'https://mindos.you/schemas/agent-runtime-extension.v0.json';
}

function diagnostic(
  code: string,
  severity: AgentRuntimeExtensionManifestDiagnosticSeverity,
  summary: string,
  diagnosticPath?: string,
): AgentRuntimeExtensionManifestDiagnostic {
  return {
    code,
    severity,
    summary,
    ...(diagnosticPath ? { path: diagnosticPath } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
