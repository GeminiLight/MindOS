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
import { resolveExistingSafe, resolveSafe } from '../../foundation/security/index.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export const MINDOS_ASSISTANTS_ROOT = '.mindos/assistants';

const SAFE_ASSISTANT_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_PROMPT_BYTES = 256 * 1024;
const BUILTIN_ASSISTANT_IDS = new Set([
  'inbox-organizer',
  'daily-signal',
  'decision-synthesizer',
  'rule-keeper',
  'boundary-reviewer',
  'method-organizer',
  'checklist-builder',
  'tool-inventory',
  'resource-auditor',
]);

export type MindosAssistantProfileMetadata = {
  skills: string[];
  mcp: string[];
  preferredAgent?: string;
};

export type MindosAssistantOrigin = 'builtin' | 'custom';

export type MindosAssistantPaths = {
  root: string;
  profile: string;
  prompt: string;
};

export type MindosAssistantPromptPayload = {
  exists: boolean;
  content?: string;
};

export type MindosAssistantHealthIssue =
  | { code: 'missing_prompt' }
  | { code: 'missing_profile' }
  | { code: 'invalid_profile' }
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
  schemaVersion: 1;
  preferredAgent?: string;
  skills: string[];
  mcp: string[];
  source: MindosAssistantOrigin;
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
  profileError?: 'invalid_json' | 'unreadable';
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

    const rootRelPath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId);
    ensureAssistantsRoot(services.mindRoot);
    const rootPath = resolveSafe(services.mindRoot, rootRelPath);
    if (existsSync(rootPath)) {
      return json({ error: 'Assistant already exists' }, { status: 409 });
    }

    mkdirSync(rootPath, { recursive: false });
    resolveExistingSafe(services.mindRoot, rootRelPath);

    const name = sanitizeString(record.name, 80) ?? titleizeAssistantId(assistantId);
    const description = sanitizeString(record.description, 280) ?? '';
    const preferredAgent = sanitizeString(record.preferredAgent, 120) ?? 'mindos-agent';
    const profile = {
      name,
      description,
      schemaVersion: 1,
      preferredAgent,
      skills: sanitizeStringArray(record.skills) ?? [],
      mcp: sanitizeStringArray(record.mcp) ?? [],
    };
    const prompt = sanitizeMultiline(record.prompt) ?? defaultAssistantPrompt(name, description);

    writeFileSync(
      resolveSafe(services.mindRoot, posix.join(rootRelPath, 'profile.json')),
      `${JSON.stringify(profile, null, 2)}\n`,
      'utf-8',
    );
    writeFileSync(
      resolveSafe(services.mindRoot, posix.join(rootRelPath, 'prompt.md')),
      prompt.endsWith('\n') ? prompt : `${prompt}\n`,
      'utf-8',
    );

    return json({
      ok: true,
      id: assistantId,
      paths: {
        root: rootRelPath,
        profile: posix.join(rootRelPath, 'profile.json'),
        prompt: posix.join(rootRelPath, 'prompt.md'),
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

    const rootRelPath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId);
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

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_ASSISTANT_ID.test(entry.name))
    .map((entry) => readAssistantDirectory(mindRoot, entry.name))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function isMindosBuiltinAssistantId(assistantId: string): boolean {
  return BUILTIN_ASSISTANT_IDS.has(assistantId);
}

function readAssistantDirectory(mindRoot: string, assistantId: string): MindosAssistantLibraryItem {
  const rootRelPath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId);
  const promptPath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId, 'prompt.md');
  const profilePath = posix.join(MINDOS_ASSISTANTS_ROOT, assistantId, 'profile.json');
  const profile = readAssistantProfile(mindRoot, profilePath);
  const prompt = readAssistantPrompt(mindRoot, promptPath);
  const promptBody = stripLeadingFrontmatter(prompt.content);
  const promptTitle = extractPromptTitle(promptBody);
  const fallbackName = promptTitle ?? titleizeAssistantId(assistantId);
  const source: MindosAssistantOrigin = isMindosBuiltinAssistantId(assistantId) ? 'builtin' : 'custom';
  const healthIssues = assistantHealthIssues(profile, prompt);
  const description = firstNonEmptyString(
    profile.description,
    prompt.promptPreview,
    'Local assistant profile.',
  );

  return {
    id: assistantId,
    name: firstNonEmptyString(profile.name, fallbackName),
    description,
    schemaVersion: 1,
    ...(profile.preferredAgent ? { preferredAgent: profile.preferredAgent } : {}),
    skills: profile.skills,
    mcp: profile.mcp,
    source,
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

function stripLeadingFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return content.trim();
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return content.trim();
  const afterFence = normalized.slice(end + 4).replace(/^\n+/, '');
  return afterFence.trim();
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
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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

function assistantErrorResponse(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error);
  if (/access denied|outside root|absolute paths|symlink/i.test(message)) {
    return json({ error: 'Access denied' }, { status: 403 });
  }
  return json({ error: message }, { status: 500 });
}

function assistantHealthIssues(
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
