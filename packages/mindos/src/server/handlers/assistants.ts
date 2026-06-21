import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { posix } from 'node:path';
import { normalizeMindosPermissionMode, type MindosPermissionMode } from '../../agent/permission/index.js';
import { resolveExistingSafe, resolveSafe } from '../../foundation/security/index.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export const MINDOS_ASSISTANTS_ROOT = '.mindos/assistants';

const SAFE_ASSISTANT_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_PROMPT_BYTES = 256 * 1024;
const ASSISTANT_PROFILE_VERSION = 1;
const BUILTIN_ASSISTANT_IDS = new Set([
  'inbox-organizer',
  'dreaming',
]);

const DEFAULT_ASSISTANT_PROFILE = {
  version: ASSISTANT_PROFILE_VERSION,
  mode: 'subagent',
  runtime: 'mindos',
  model: 'default',
  permissionMode: 'ask',
  hidden: false,
} as const;

export type MindosAssistantProfileMetadata = {
  skills: string[];
  mcp: string[];
  preferredAgent?: string;
};

export type MindosAssistantOrigin = 'builtin' | 'custom';
export type MindosAssistantFormat = 'markdown' | 'legacy-directory';

export type MindosAssistantPaths = {
  root: string;
  profile: string;
  prompt: string;
  file?: string;
};

export type MindosAssistantPromptPayload = {
  exists: boolean;
  content?: string;
};

export type MindosAssistantHealthIssue =
  | { code: 'missing_prompt' }
  | { code: 'missing_profile' }
  | { code: 'missing_frontmatter' }
  | { code: 'invalid_frontmatter' }
  | { code: 'invalid_profile' }
  | { code: 'invalid_version' }
  | { code: 'missing_description' }
  | { code: 'unreadable_profile' }
  | { code: 'unsupported_schema'; schemaVersion: number }
  | { code: 'prompt_too_large'; sizeBytes: number; maxBytes: number };

export type MindosAssistantHealth = {
  state: 'ready' | 'warning';
  issues: MindosAssistantHealthIssue[];
};

export type MindosAssistantLibraryItem = {
  id: string;
  name: string;
  description: string;
  version: number;
  mode: string;
  runtime: string;
  model: string;
  permissionMode: MindosPermissionMode;
  hidden: boolean;
  color?: string;
  steps?: number;
  preferredAgent?: string;
  skills: string[];
  mcp: string[];
  source: MindosAssistantOrigin;
  format: MindosAssistantFormat;
  deletable: boolean;
  paths: MindosAssistantPaths;
  prompt: MindosAssistantPromptPayload;
  health: MindosAssistantHealth;
  /**
   * Compatibility aliases for older Web code. New clients should use paths/prompt/health.
   */
  promptPath: string;
  profilePath: string;
  promptReady: boolean;
  profileReady: boolean;
  promptTitle?: string;
  promptPreview: string;
  profileError?: 'invalid_json' | 'unreadable' | 'invalid_frontmatter';
};

export type MindosAssistantsPayload = {
  root: typeof MINDOS_ASSISTANTS_ROOT;
  assistants: MindosAssistantLibraryItem[];
};

export type MindosAssistantWritePayload = {
  ok: true;
  id: string;
  paths: MindosAssistantPaths;
};

export type MindosAssistantDeletePayload = {
  ok: true;
  id: string;
};

export type MindosAssistantsServices = {
  mindRoot: string;
};

export function handleAssistantsGet(
  services: MindosAssistantsServices,
): MindosServerResponse<MindosAssistantsPayload | { error: string }> {
  try {
    return json({
      root: MINDOS_ASSISTANTS_ROOT,
      assistants: listLocalAssistants(services.mindRoot),
    }, { headers: privateCacheHeaders(10) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|outside root|absolute paths|symlink/i.test(message)) {
      return json({ error: 'Access denied' }, { status: 403 });
    }
    return json({ error: message }, { status: 500 });
  }
}

export function handleAssistantsPost(
  body: unknown,
  services: MindosAssistantsServices,
): MindosServerResponse<MindosAssistantWritePayload | { error: string }> {
  try {
    const record = objectBody(body);
    const assistantId = sanitizeAssistantId(record.id);
    if (!assistantId) {
      return json({ error: 'Invalid assistant id' }, { status: 400 });
    }

    if (isMindosBuiltinAssistantId(assistantId)) {
      return json({ error: 'Built-in assistants are managed by MindOS' }, { status: 409 });
    }

    ensureAssistantsRoot(services.mindRoot);

    const fileRelPath = assistantMarkdownPath(assistantId);
    const legacyRootRelPath = assistantLegacyRootPath(assistantId);
    const filePath = resolveSafe(services.mindRoot, fileRelPath);
    const legacyRootPath = resolveSafe(services.mindRoot, legacyRootRelPath);
    if (existsSync(filePath) || existsSync(legacyRootPath)) {
      return json({ error: 'Assistant already exists' }, { status: 409 });
    }
    resolveExistingSafe(services.mindRoot, fileRelPath);

    const name = sanitizeString(record.name, 80) ?? titleizeAssistantId(assistantId);
    const description = sanitizeString(record.description, 280) ?? '';
    const prompt = sanitizeMultiline(record.prompt) ?? defaultAssistantPrompt(name, description);
    const runtime = sanitizeRuntime(record.runtime) ?? 'mindos';
    const profile: AssistantMarkdownProfile = {
      name,
      description: description || 'Describe what this assistant should help with.',
      version: sanitizeAssistantVersion(record.version).version,
      mode: 'subagent',
      runtime,
      model: sanitizeString(record.model, 120) ?? 'default',
      permissionMode: sanitizePermissionMode(record.permissionMode ?? record.permission),
      hidden: readBoolean(record.hidden, false),
      color: sanitizeString(record.color, 48) ?? 'amber',
      steps: sanitizePositiveInteger(record.steps) ?? 12,
      skills: sanitizeStringArray(record.skills) ?? [],
      mcp: sanitizeStringArray(record.mcp) ?? [],
    };

    writeFileSync(
      filePath,
      serializeAssistantMarkdown(profile, prompt),
      'utf-8',
    );

    return json({
      ok: true,
      id: assistantId,
      paths: {
        root: MINDOS_ASSISTANTS_ROOT,
        profile: fileRelPath,
        prompt: fileRelPath,
        file: fileRelPath,
      },
    }, { status: 201 });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export function handleAssistantsDelete(
  body: unknown,
  services: MindosAssistantsServices,
): MindosServerResponse<MindosAssistantDeletePayload | { error: string }> {
  try {
    const record = objectBody(body);
    const assistantId = sanitizeAssistantId(record.id);
    if (!assistantId) {
      return json({ error: 'Invalid assistant id' }, { status: 400 });
    }

    if (isMindosBuiltinAssistantId(assistantId)) {
      return json({ error: 'Built-in assistants cannot be deleted' }, { status: 403 });
    }

    const fileRelPath = assistantMarkdownPath(assistantId);
    const filePath = resolveExistingSafe(services.mindRoot, fileRelPath);
    if (existsSync(filePath)) {
      if (!lstatSync(filePath).isFile()) {
        return json({ error: 'Assistant path is not a file' }, { status: 409 });
      }
      rmSync(filePath, { force: false });
      return json({ ok: true, id: assistantId });
    }

    const rootRelPath = assistantLegacyRootPath(assistantId);
    const rootPath = resolveExistingSafe(services.mindRoot, rootRelPath);
    if (!existsSync(rootPath)) {
      return json({ error: 'Assistant not found' }, { status: 404 });
    }
    if (!lstatSync(rootPath).isDirectory()) {
      return json({ error: 'Assistant path is not a directory' }, { status: 409 });
    }

    rmSync(rootPath, { recursive: true, force: false });
    return json({ ok: true, id: assistantId });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export function listLocalAssistants(mindRoot: string): MindosAssistantLibraryItem[] {
  const rootPath = resolveExistingSafe(mindRoot, MINDOS_ASSISTANTS_ROOT);
  if (!existsSync(rootPath)) return [];
  if (!statSync(rootPath).isDirectory()) return [];

  const entries = readdirSync(rootPath, { withFileTypes: true });
  const markdownIds = new Set<string>();
  const assistants: MindosAssistantLibraryItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const assistantId = entry.name.slice(0, -3);
    if (!SAFE_ASSISTANT_ID.test(assistantId)) continue;
    markdownIds.add(assistantId);
    assistants.push(readAssistantMarkdownFile(mindRoot, assistantId));
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_ASSISTANT_ID.test(entry.name) || markdownIds.has(entry.name)) continue;
    assistants.push(readAssistantDirectory(mindRoot, entry.name));
  }

  return assistants.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function isMindosBuiltinAssistantId(assistantId: string): boolean {
  return BUILTIN_ASSISTANT_IDS.has(assistantId);
}

function readAssistantMarkdownFile(mindRoot: string, assistantId: string): MindosAssistantLibraryItem {
  const filePath = assistantMarkdownPath(assistantId);
  const file = readAssistantPrompt(mindRoot, filePath);
  const parsed = parseAssistantMarkdown(file.content);
  const promptBody = file.tooLarge ? '' : parsed.body;
  const promptTitle = extractPromptTitle(promptBody);
  const fallbackName = promptTitle ?? titleizeAssistantId(assistantId);
  const source: MindosAssistantOrigin = isMindosBuiltinAssistantId(assistantId) ? 'builtin' : 'custom';
  const healthIssues = assistantMarkdownHealthIssues(parsed, file);
  const description = firstNonEmptyString(
    parsed.profile.description,
    makePreview(promptBody),
    'Local assistant profile.',
  );

  return {
    id: assistantId,
    name: firstNonEmptyString(parsed.profile.name, fallbackName),
    description,
    version: parsed.profile.version,
    mode: parsed.profile.mode,
    runtime: parsed.profile.runtime,
    model: parsed.profile.model,
    permissionMode: parsed.profile.permissionMode,
    hidden: parsed.profile.hidden,
    ...(parsed.profile.color ? { color: parsed.profile.color } : {}),
    ...(parsed.profile.steps ? { steps: parsed.profile.steps } : {}),
    preferredAgent: runtimeToPreferredAgent(parsed.profile.runtime),
    skills: parsed.profile.skills,
    mcp: parsed.profile.mcp,
    source,
    format: 'markdown',
    deletable: source === 'custom',
    paths: {
      root: MINDOS_ASSISTANTS_ROOT,
      profile: filePath,
      prompt: filePath,
      file: filePath,
    },
    prompt: {
      exists: file.exists,
      ...(promptBody ? { content: promptBody } : {}),
    },
    health: {
      state: healthIssues.length > 0 ? 'warning' : 'ready',
      issues: healthIssues,
    },
    promptPath: filePath,
    profilePath: filePath,
    promptReady: file.exists && !file.tooLarge && promptBody.trim().length > 0,
    profileReady: parsed.ready,
    ...(promptTitle ? { promptTitle } : {}),
    promptPreview: makePreview(promptBody),
    ...(parsed.error ? { profileError: parsed.error } : {}),
  };
}

function readAssistantDirectory(mindRoot: string, assistantId: string): MindosAssistantLibraryItem {
  const rootRelPath = assistantLegacyRootPath(assistantId);
  const promptPath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId, 'prompt.md');
  const profilePath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId, 'profile.json');
  const profile = readAssistantProfile(mindRoot, profilePath);
  const prompt = readAssistantPrompt(mindRoot, promptPath);
  const promptBody = stripLeadingFrontmatter(prompt.content);
  const promptTitle = extractPromptTitle(promptBody);
  const fallbackName = promptTitle ?? titleizeAssistantId(assistantId);
  const source: MindosAssistantOrigin = isMindosBuiltinAssistantId(assistantId) ? 'builtin' : 'custom';
  const healthIssues = legacyAssistantHealthIssues(profile, prompt);
  const description = firstNonEmptyString(
    profile.description,
    prompt.promptPreview,
    'Local assistant profile.',
  );
  const runtime = normalizeLegacyPreferredAgent(profile.preferredAgent);

  return {
    id: assistantId,
    name: firstNonEmptyString(profile.name, fallbackName),
    description,
    version: ASSISTANT_PROFILE_VERSION,
    mode: DEFAULT_ASSISTANT_PROFILE.mode,
    runtime,
    model: DEFAULT_ASSISTANT_PROFILE.model,
    permissionMode: DEFAULT_ASSISTANT_PROFILE.permissionMode,
    hidden: false,
    ...(profile.preferredAgent ? { preferredAgent: profile.preferredAgent } : {}),
    skills: profile.skills,
    mcp: profile.mcp,
    source,
    format: 'legacy-directory',
    deletable: source === 'custom',
    paths: {
      root: rootRelPath,
      profile: profilePath,
      prompt: promptPath,
    },
    prompt: {
      exists: prompt.exists,
      ...(prompt.content ? { content: prompt.content } : {}),
    },
    health: {
      state: healthIssues.length > 0 ? 'warning' : 'ready',
      issues: healthIssues,
    },
    promptPath,
    profilePath,
    promptReady: prompt.exists && !prompt.tooLarge,
    profileReady: profile.ready,
    ...(promptTitle ? { promptTitle } : {}),
    promptPreview: prompt.promptPreview,
    ...(profile.error ? { profileError: profile.error } : {}),
  };
}

type AssistantProfileReadResult = {
  ready: boolean;
  exists: boolean;
  name?: string;
  description?: string;
  schemaVersion: number;
  preferredAgent?: string;
  skills: string[];
  mcp: string[];
  error?: 'invalid_json' | 'unreadable';
};

type AssistantMarkdownProfile = {
  name?: string;
  description?: string;
  version: number;
  mode: string;
  runtime: string;
  model: string;
  permissionMode: MindosPermissionMode;
  hidden: boolean;
  color?: string;
  steps?: number;
  skills: string[];
  mcp: string[];
};

type AssistantMarkdownReadResult = {
  ready: boolean;
  profile: AssistantMarkdownProfile;
  body: string;
  missingFrontmatter: boolean;
  invalidVersion: boolean;
  missingDescription: boolean;
  error?: 'invalid_frontmatter';
};

function readAssistantProfile(mindRoot: string, profilePath: string): AssistantProfileReadResult {
  const result: AssistantProfileReadResult = {
    ready: false,
    exists: false,
    schemaVersion: 1,
    skills: [],
    mcp: [],
  };
  let resolvedPath: string;
  try {
    resolvedPath = resolveExistingSafe(mindRoot, profilePath);
  } catch {
    return result;
  }

  if (!existsSync(resolvedPath)) return result;

  try {
    if (!lstatSync(resolvedPath).isFile()) return result;
    const parsed = JSON.parse(readFileSync(resolvedPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...result, ready: true, error: 'invalid_json' };
    }
    const record = parsed as Record<string, unknown>;
    const schemaVersion = sanitizeSchemaVersion(record.schemaVersion);
    return {
      ready: true,
      exists: true,
      name: sanitizeString(record.name, 80),
      description: sanitizeString(record.description, 280) ?? sanitizeString(record.desc, 280),
      schemaVersion,
      preferredAgent: sanitizeString(record.preferredAgent, 120),
      skills: sanitizeStringArray(record.skills) ?? [],
      mcp: sanitizeStringArray(record.mcp) ?? [],
    };
  } catch (error) {
    if (error instanceof SyntaxError) return { ...result, ready: true, exists: true, error: 'invalid_json' };
    return { ...result, ready: true, exists: true, error: 'unreadable' };
  }
}

function readAssistantPrompt(
  mindRoot: string,
  promptPath: string,
): { exists: boolean; content: string; promptPreview: string; tooLarge?: { sizeBytes: number; maxBytes: number } } {
  let resolvedPath: string;
  try {
    resolvedPath = resolveExistingSafe(mindRoot, promptPath);
  } catch {
    return { exists: false, content: '', promptPreview: '' };
  }

  try {
    if (!existsSync(resolvedPath) || !lstatSync(resolvedPath).isFile()) {
      return { exists: false, content: '', promptPreview: '' };
    }
    const stat = statSync(resolvedPath);
    if (stat.size > MAX_PROMPT_BYTES) {
      return {
        exists: true,
        content: '',
        promptPreview: `Prompt is larger than ${Math.round(MAX_PROMPT_BYTES / 1024)} KB. Open the file to inspect it.`,
        tooLarge: {
          sizeBytes: stat.size,
          maxBytes: MAX_PROMPT_BYTES,
        },
      };
    }
    const content = readFileSync(resolvedPath, 'utf-8');
    return {
      exists: true,
      content,
      promptPreview: makePreview(stripLeadingFrontmatter(content)),
    };
  } catch {
    return { exists: false, content: '', promptPreview: '' };
  }
}

function parseAssistantMarkdown(content: string): AssistantMarkdownReadResult {
  const split = splitMarkdownFrontmatter(content);
  const rawVersion = split.fields.version;
  const version = sanitizeAssistantVersion(rawVersion);
  const name = sanitizeString(split.fields.name, 80);
  const description = sanitizeString(split.fields.description, 280);
  const color = sanitizeString(split.fields.color, 48);
  const steps = sanitizePositiveInteger(split.fields.steps);
  const profile: AssistantMarkdownProfile = {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    version: version.version,
    mode: sanitizeMode(split.fields.mode),
    runtime: sanitizeRuntime(split.fields.runtime) ?? DEFAULT_ASSISTANT_PROFILE.runtime,
    model: sanitizeString(split.fields.model, 120) ?? DEFAULT_ASSISTANT_PROFILE.model,
    permissionMode: sanitizePermissionMode(split.fields.permissionMode ?? split.fields.permission),
    hidden: readBoolean(split.fields.hidden, DEFAULT_ASSISTANT_PROFILE.hidden),
    ...(color ? { color } : {}),
    ...(steps ? { steps } : {}),
    skills: sanitizeStringArray(split.fields.skills) ?? [],
    mcp: sanitizeStringArray(split.fields.mcp) ?? [],
  };
  const hasInvalidVersion = rawVersion !== undefined && version.invalid;
  const ready = !split.invalid && !hasInvalidVersion && !split.missing;
  return {
    ready,
    profile,
    body: split.body,
    missingFrontmatter: split.missing,
    invalidVersion: hasInvalidVersion,
    missingDescription: !description,
    ...(split.invalid ? { error: 'invalid_frontmatter' as const } : {}),
  };
}

function splitMarkdownFrontmatter(content: string): {
  fields: Record<string, unknown>;
  body: string;
  missing: boolean;
  invalid: boolean;
} {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { fields: {}, body: content.trim(), missing: true, invalid: false };
  }
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return { fields: {}, body: content.trim(), missing: false, invalid: true };
  }

  const parsed = parseFrontmatterFields(match[1] ?? '');
  return {
    fields: parsed.fields,
    body: normalized.slice(match[0].length).replace(/^\n+/, '').trim(),
    missing: false,
    invalid: parsed.invalid,
  };
}

function parseFrontmatterFields(raw: string): { fields: Record<string, unknown>; invalid: boolean } {
  const fields: Record<string, unknown> = {};
  let invalid = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      invalid = true;
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      invalid = true;
      continue;
    }
    fields[key] = parseFrontmatterScalar(trimmed.slice(separator + 1).trim());
  }
  return { fields, invalid };
}

function parseFrontmatterScalar(value: string): unknown {
  if (!value) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1).replace(/''/g, "'");
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const items = rawItems
    .map((item) => sanitizeString(item, 96))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? Array.from(new Set(items)).slice(0, 12) : undefined;
}

function sanitizeAssistantId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SAFE_ASSISTANT_ID.test(normalized) ? normalized : undefined;
}

function sanitizeMultiline(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized ? normalized.slice(0, 64_000) : undefined;
}

function sanitizeSchemaVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return 1;
  return value;
}

function sanitizeAssistantVersion(value: unknown): { version: number; invalid: boolean } {
  if (value === undefined) return { version: ASSISTANT_PROFILE_VERSION, invalid: false };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { version: ASSISTANT_PROFILE_VERSION, invalid: true };
  }
  return { version: value, invalid: false };
}

function sanitizeMode(value: unknown): string {
  return value === 'subagent' ? 'subagent' : DEFAULT_ASSISTANT_PROFILE.mode;
}

function sanitizeRuntime(value: unknown): string | undefined {
  const runtime = sanitizeString(value, 80);
  if (!runtime) return undefined;
  if (runtime === 'mindos-agent') return 'mindos';
  if (runtime === 'claude') return 'claude-code';
  return runtime;
}

function normalizeLegacyPreferredAgent(value: string | undefined): string {
  return sanitizeRuntime(value) ?? DEFAULT_ASSISTANT_PROFILE.runtime;
}

function runtimeToPreferredAgent(runtime: string): string {
  return runtime === 'mindos' ? 'mindos-agent' : runtime;
}

function sanitizePermissionMode(value: unknown): MindosPermissionMode {
  return normalizeMindosPermissionMode(value, DEFAULT_ASSISTANT_PROFILE.permissionMode);
}

function sanitizePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stripLeadingFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return content.trim();
  const match = normalized.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (!match) return content.trim();
  return normalized.slice(match[0].length).replace(/^\n+/, '').trim();
}

function extractPromptTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return sanitizeString(match?.[1], 100);
}

function makePreview(content: string, maxLength = 180): string {
  const normalized = content
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function titleizeAssistantId(assistantId: string): string {
  return assistantId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || assistantId;
}

function firstNonEmptyString(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function objectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function ensureAssistantsRoot(mindRoot: string): void {
  resolveExistingSafe(mindRoot, MINDOS_ASSISTANTS_ROOT);
  const rootPath = resolveSafe(mindRoot, MINDOS_ASSISTANTS_ROOT);
  mkdirSync(rootPath, { recursive: true });
  resolveExistingSafe(mindRoot, MINDOS_ASSISTANTS_ROOT);
}

function assistantMarkdownPath(assistantId: string): string {
  return posix.join(MINDOS_ASSISTANTS_ROOT, `${assistantId}.md`);
}

function assistantLegacyRootPath(assistantId: string): string {
  return posix.join(MINDOS_ASSISTANTS_ROOT, assistantId);
}

function defaultAssistantPrompt(name: string, description: string): string {
  return `# ${name}

## Role

${description || 'Describe what this assistant should help with.'}

## Inputs

- Add the files, notes, or context this assistant should inspect.

## Output

Return a concise, reviewable result.

## Boundaries

- Prefer proposing changes before applying them.
- Do not read secrets or credentials.
`;
}

function serializeAssistantMarkdown(profile: AssistantMarkdownProfile, body: string): string {
  const frontmatter: Array<[string, string | number | boolean | undefined]> = [
    ['name', profile.name],
    ['description', profile.description],
    ['version', profile.version],
    ['mode', profile.mode],
    ['runtime', profile.runtime],
    ['model', profile.model],
    ['permissionMode', profile.permissionMode],
    ['hidden', profile.hidden],
    ['color', profile.color],
    ['steps', profile.steps],
    ['skills', profile.skills.length > 0 ? profile.skills.join(', ') : undefined],
    ['mcp', profile.mcp.length > 0 ? profile.mcp.join(', ') : undefined],
  ];
  const lines = frontmatter
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${key}: ${formatFrontmatterScalar(value)}`);
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return `---\n${lines.join('\n')}\n---\n\n${normalizedBody}\n`;
}

function formatFrontmatterScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (/^[A-Za-z0-9][A-Za-z0-9 ._,/-]*$/.test(value) && !/^(true|false|null)$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function assistantErrorResponse(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error);
  if (/access denied|outside root|absolute paths|symlink/i.test(message)) {
    return json({ error: 'Access denied' }, { status: 403 });
  }
  return json({ error: message }, { status: 500 });
}

function assistantMarkdownHealthIssues(
  parsed: AssistantMarkdownReadResult,
  prompt: ReturnType<typeof readAssistantPrompt>,
): MindosAssistantHealthIssue[] {
  const issues: MindosAssistantHealthIssue[] = [];
  if (!prompt.exists) issues.push({ code: 'missing_prompt' });
  if (parsed.missingFrontmatter) issues.push({ code: 'missing_frontmatter' });
  if (parsed.error === 'invalid_frontmatter') issues.push({ code: 'invalid_frontmatter' });
  if (parsed.invalidVersion) issues.push({ code: 'invalid_version' });
  if (parsed.missingDescription) issues.push({ code: 'missing_description' });
  if (prompt.tooLarge) {
    issues.push({
      code: 'prompt_too_large',
      sizeBytes: prompt.tooLarge.sizeBytes,
      maxBytes: prompt.tooLarge.maxBytes,
    });
  }
  return issues;
}

function legacyAssistantHealthIssues(
  profile: AssistantProfileReadResult,
  prompt: ReturnType<typeof readAssistantPrompt>,
): MindosAssistantHealthIssue[] {
  const issues: MindosAssistantHealthIssue[] = [];
  if (!prompt.exists) issues.push({ code: 'missing_prompt' });
  if (!profile.exists) issues.push({ code: 'missing_profile' });
  if (profile.error === 'invalid_json') issues.push({ code: 'invalid_profile' });
  if (profile.error === 'unreadable') issues.push({ code: 'unreadable_profile' });
  if (profile.schemaVersion !== 1) {
    issues.push({ code: 'unsupported_schema', schemaVersion: profile.schemaVersion });
  }
  if (prompt.tooLarge) {
    issues.push({
      code: 'prompt_too_large',
      sizeBytes: prompt.tooLarge.sizeBytes,
      maxBytes: prompt.tooLarge.maxBytes,
    });
  }
  return issues;
}
