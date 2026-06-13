import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { json, type MindosServerResponse } from '../response.js';
import {
  buildSkillMatrix,
  disableNativeSkill,
  enableNativeSkill,
  linkSkillToAgent,
  unlinkSkillFromAgent,
  type MindosSkillLinkAgent,
  type MindosSkillLinkOutcome,
  type MindosSkillMatrix,
} from './skill-links.js';

export type MindosSkillSource = 'builtin' | 'user';
export type MindosSkillOrigin = 'app-builtin' | 'mindos-user' | 'mindos-global' | 'agents-global' | 'custom' | 'project-builtin';

export type MindosSkillRoot = {
  path: string;
  source: MindosSkillSource;
  origin: MindosSkillOrigin;
  editable: boolean;
};

export type MindosSkillInfo = {
  name: string;
  description: string;
  path: string;
  source: MindosSkillSource;
  enabled: boolean;
  editable: boolean;
  origin: MindosSkillOrigin;
};

export type SkillsHandlerServices = {
  disabledSkills?: string[];
  skillRoots: MindosSkillRoot[];
};

export type MindosSkillsSettings = {
  disabledSkills?: string[];
  skillPaths?: {
    enableAgentsDir?: boolean;
    custom?: string[];
  };
  installedSkillAgents?: Array<{ agent: string; skill: string; path: string }>;
  [key: string]: unknown;
};

export type SkillsPostAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'toggle'
  | 'read'
  | 'read-native'
  | 'record-install'
  | 'link'
  | 'unlink'
  | 'disable-native'
  | 'enable-native';

export type SkillsPostPayload = {
  action?: SkillsPostAction | string;
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
  sourcePath?: string;
  agentKey?: string;
  installPath?: string;
};

export type SkillsPostHandlerServices = {
  mindRoot: string;
  skillRoots: MindosSkillRoot[];
  trustedNativeSkillRoots?: string[];
  readSettings(): MindosSkillsSettings;
  writeSettings(settings: MindosSkillsSettings): void;
  /** Downstream agents eligible for skill linking (present, skill-capable). Required for link/unlink. */
  listLinkAgents?(): MindosSkillLinkAgent[];
};

export type SkillsPayload = {
  skills: MindosSkillInfo[];
};

export function handleSkillsGet(services: SkillsHandlerServices): MindosServerResponse<SkillsPayload> {
  const disabled = new Set(services.disabledSkills ?? []);
  return json({ skills: collectSkillInfos(services.skillRoots, disabled) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Scan all skill roots and de-duplicate by name (first root wins). */
export function collectSkillInfos(skillRoots: MindosSkillRoot[], disabled: Set<string>): MindosSkillInfo[] {
  const byName = new Map<string, MindosSkillInfo>();
  for (const root of skillRoots) {
    for (const skill of readSkillsFromRoot(root, disabled)) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function handleSkillsPost(
  body: unknown,
  services: SkillsPostHandlerServices,
): MindosServerResponse<{ ok: true } | { content: string; description?: string } | { error: string }> {
  const payload = normalizeSkillsPostPayload(body);
  const { action, name } = payload;
  const settings = services.readSettings();

  if (name && !isSafeSkillName(name)) {
    return json({ error: 'Invalid skill name' }, { status: 400 });
  }

  switch (action) {
    case 'toggle':
      if (!name) return json({ error: 'name required' }, { status: 400 });
      return toggleSkill(name, payload.enabled, settings, services);

    case 'create':
      if (!name) return json({ error: 'name required' }, { status: 400 });
      if (!isWritableUserSkillName(name)) {
        return json({ error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' }, { status: 400 });
      }
      {
        const userSkillsDir = resolveUserSkillsDirForWrite(services.mindRoot);
        if ('response' in userSkillsDir) return userSkillsDir.response;
        return createUserSkill({
          name,
          description: payload.description,
          content: payload.content,
          userSkillsDir: userSkillsDir.path,
          skillRoots: services.skillRoots,
        });
      }

    case 'update':
      if (!name) return json({ error: 'name required' }, { status: 400 });
      if (!isWritableUserSkillName(name)) {
        return json({ error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' }, { status: 400 });
      }
      {
        const userSkillsDir = resolveUserSkillsDirForWrite(services.mindRoot);
        if ('response' in userSkillsDir) return userSkillsDir.response;
        return updateUserSkill(name, payload.content, userSkillsDir.path);
      }

    case 'delete':
      if (!name) return json({ error: 'name required' }, { status: 400 });
      if (!isWritableUserSkillName(name)) {
        return json({ error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' }, { status: 400 });
      }
      {
        const userSkillsDir = resolveUserSkillsDirForWrite(services.mindRoot);
        if ('response' in userSkillsDir) return userSkillsDir.response;
        return deleteUserSkill(name, userSkillsDir.path);
      }

    case 'read':
      if (!name) return json({ error: 'name required' }, { status: 400 });
      return readSkillByName(name, services.skillRoots);

    case 'read-native':
      if (!name || !payload.sourcePath) {
        return json({ error: 'name and sourcePath required' }, { status: 400 });
      }
      return readNativeSkill(name, payload.sourcePath, services.skillRoots, services.trustedNativeSkillRoots);

    case 'record-install':
      return recordSkillInstall(payload, settings, services);

    case 'link':
    case 'unlink':
    case 'disable-native':
    case 'enable-native':
      if (!name || !payload.agentKey) {
        return json({ error: 'name and agentKey required' }, { status: 400 });
      }
      return setSkillLinked(action, name, payload.agentKey, services);

    default:
      return json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
  }
}

/* ── Unified write interface for the (skill × agent) matrix (spec 4.3) ── */

function setSkillLinked(
  action: 'link' | 'unlink' | 'disable-native' | 'enable-native',
  name: string,
  agentKey: string,
  services: SkillsPostHandlerServices,
): MindosServerResponse<{ ok: true; result: string } | { error: string }> {
  const agents = services.listLinkAgents?.() ?? [];
  const agent = agents.find((candidate) => candidate.key === agentKey);
  if (!agent) {
    return json({ error: `Unknown or unavailable agent: ${agentKey}` }, { status: 404 });
  }
  const outcome = action === 'link'
    ? linkSkillToAgent(name, agent, services.skillRoots)
    : action === 'unlink'
      ? unlinkSkillFromAgent(name, agent, services.skillRoots)
      : action === 'disable-native'
        ? disableNativeSkill(name, agent)
        : enableNativeSkill(name, agent);
  return skillLinkOutcomeResponse(outcome);
}

function skillLinkOutcomeResponse(
  outcome: MindosSkillLinkOutcome,
): MindosServerResponse<{ ok: true; result: string } | { error: string }> {
  if (outcome.ok) return json({ ok: true, result: outcome.result });
  const status = outcome.code === 'skill-not-found' ? 404 : outcome.code === 'conflict' ? 409 : 500;
  return json({ error: outcome.message }, { status });
}

/* ── Unified read model for the (skill × agent) matrix (spec 4.2) ── */

export type SkillMatrixHandlerServices = {
  disabledSkills?: string[];
  skillRoots: MindosSkillRoot[];
  listLinkAgents(): MindosSkillLinkAgent[];
};

export function handleSkillMatrixGet(
  services: SkillMatrixHandlerServices,
): MindosServerResponse<MindosSkillMatrix> {
  const disabled = new Set(services.disabledSkills ?? []);
  const matrix = buildSkillMatrix({
    skills: collectSkillInfos(services.skillRoots, disabled),
    agents: services.listLinkAgents(),
    disabledSkills: services.disabledSkills,
  });
  return json(matrix, { headers: { 'Cache-Control': 'no-store' } });
}

function resolveUserSkillsDirForWrite(mindRoot: string):
  | { path: string }
  | { response: MindosServerResponse<{ error: string }> } {
  try {
    return { path: resolveUserSkillsDir(mindRoot) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|outside root|absolute paths/i.test(message)) return { response: json({ error: 'Access denied' }, { status: 403 }) };
    return { response: json({ error: message }, { status: 500 }) };
  }
}

function readSkillsFromRoot(root: MindosSkillRoot, disabled: Set<string>): MindosSkillInfo[] {
  if (!existsSync(root.path)) return [];
  if (root.origin === 'mindos-user' && lstatSync(root.path).isSymbolicLink()) return [];
  const skills: MindosSkillInfo[] = [];
  const directSkill = readDirectSkillFromRoot(root, disabled);
  if (directSkill) skills.push(directSkill);

  for (const entry of readdirSync(root.path, { withFileTypes: true })) {
    if (!isSkillDirectoryEntry(root, entry)) continue;
    const skillFile = join(root.path, entry.name, 'SKILL.md');
    if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue;
    const content = readFileSync(skillFile, 'utf-8');
    const parsed = parseSkillMd(content);
    const name = parsed.name || entry.name;
    skills.push({
      name,
      description: parsed.description || name,
      path: skillFile,
      source: root.source,
      enabled: !disabled.has(name),
      editable: root.editable,
      origin: root.origin,
    });
  }

  return skills;
}

function readDirectSkillFromRoot(root: MindosSkillRoot, disabled: Set<string>): MindosSkillInfo | null {
  const skillFile = join(root.path, 'SKILL.md');
  if (!existsSync(skillFile) || !statSync(skillFile).isFile()) return null;
  const content = readFileSync(skillFile, 'utf-8');
  const parsed = parseSkillMd(content);
  const name = parsed.name || basename(root.path);
  return {
    name,
    description: parsed.description || name,
    path: skillFile,
    source: root.source,
    enabled: !disabled.has(name),
    editable: root.editable,
    origin: root.origin,
  };
}

function isSkillDirectoryEntry(root: MindosSkillRoot, entry: import('node:fs').Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  if (root.origin === 'mindos-user') return false;

  try {
    return statSync(join(root.path, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

function resolveUserSkillsDir(mindRoot: string): string {
  if (!existsSync(mindRoot)) return join(mindRoot, '.skills');
  return resolveExistingSafe(mindRoot, '.skills');
}

function parseSkillMd(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter = match[1] ?? '';
  const result: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
  }
  return result;
}

function normalizeSkillsPostPayload(body: unknown): SkillsPostPayload {
  return body && typeof body === 'object' ? body as SkillsPostPayload : {};
}

function isSafeSkillName(name: string): boolean {
  return name.trim().length > 0
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0');
}

function isWritableUserSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

function toggleSkill(
  name: string,
  enabled: boolean | undefined,
  settings: MindosSkillsSettings,
  services: SkillsPostHandlerServices,
): MindosServerResponse<{ ok: true }> {
  const disabled = [...(settings.disabledSkills ?? [])];
  if (enabled === false) {
    if (!disabled.includes(name)) disabled.push(name);
  } else {
    const index = disabled.indexOf(name);
    if (index >= 0) disabled.splice(index, 1);
  }
  services.writeSettings({ ...settings, disabledSkills: disabled });
  return json({ ok: true });
}

function createUserSkill(options: {
  name: string;
  description?: string;
  content?: string;
  userSkillsDir: string;
  skillRoots: MindosSkillRoot[];
}): MindosServerResponse<{ ok: true } | { error: string }> {
  for (const root of options.skillRoots) {
    if (root.editable) continue;
    if (existsSync(join(root.path, options.name))) {
      return json({ error: 'A built-in skill with this name already exists' }, { status: 409 });
    }
  }

  const skillDir = join(options.userSkillsDir, options.name);
  if (existsSync(skillDir)) {
    return json({ error: 'A skill with this name already exists' }, { status: 409 });
  }

  mkdirSync(skillDir, { recursive: true });
  const fileContent = options.content && options.content.trimStart().startsWith('---')
    ? options.content
    : `---\nname: ${options.name}\ndescription: ${options.description || options.name}\n---\n\n${options.content || ''}`;
  writeFileSync(join(skillDir, 'SKILL.md'), fileContent, 'utf-8');
  return json({ ok: true });
}

function updateUserSkill(
  name: string,
  content: string | undefined,
  userSkillsDir: string,
): MindosServerResponse<{ ok: true } | { error: string }> {
  const skillDir = join(userSkillsDir, name);
  if (!existsSync(skillDir)) {
    return json({ error: 'Skill not found' }, { status: 404 });
  }
  if (content !== undefined) {
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
  }
  return json({ ok: true });
}

function deleteUserSkill(
  name: string,
  userSkillsDir: string,
): MindosServerResponse<{ ok: true } | { error: string }> {
  const skillDir = join(userSkillsDir, name);
  if (!existsSync(skillDir)) {
    return json({ error: 'Skill not found' }, { status: 404 });
  }
  rmSync(skillDir, { recursive: true, force: true });
  return json({ ok: true });
}

function readSkillByName(
  name: string,
  skillRoots: MindosSkillRoot[],
): MindosServerResponse<{ content: string } | { error: string }> {
  for (const root of skillRoots) {
    const skillFile = join(root.path, name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    return json({ content: readFileSync(skillFile, 'utf-8') });
  }
  for (const root of skillRoots) {
    const directSkillFile = join(root.path, 'SKILL.md');
    if (!existsSync(directSkillFile)) continue;
    const content = readFileSync(directSkillFile, 'utf-8');
    const parsed = parseSkillMd(content);
    if ((parsed.name || basename(root.path)) === name) return json({ content });
  }
  return json({ error: 'Skill not found' }, { status: 404 });
}

function readNativeSkill(
  name: string,
  sourcePath: string,
  skillRoots: MindosSkillRoot[],
  trustedNativeSkillRoots: string[] = [],
): MindosServerResponse<{ content: string; description?: string } | { error: string }> {
  const nativeBase = resolve(sourcePath);
  if (!isRegisteredSkillRoot(nativeBase, skillRoots, trustedNativeSkillRoots)) {
    return json({ error: 'Invalid sourcePath' }, { status: 400 });
  }
  const nativeSkillFile = resolve(nativeBase, name, 'SKILL.md');
  const rel = relative(nativeBase, nativeSkillFile);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return json({ error: 'Invalid path' }, { status: 400 });
  }
  if (!existsSync(nativeSkillFile)) {
    const directSkillFile = resolve(nativeBase, 'SKILL.md');
    if (!existsSync(directSkillFile)) return json({ error: 'Skill not found' }, { status: 404 });
    const directContent = readFileSync(directSkillFile, 'utf-8');
    const parsed = parseSkillMd(directContent);
    if ((parsed.name || basename(nativeBase)) !== name) {
      return json({ error: 'Skill not found' }, { status: 404 });
    }
    return json({ content: directContent, description: parsed.description });
  }
  const content = readFileSync(nativeSkillFile, 'utf-8');
  return json({ content, description: parseSkillMd(content).description });
}

function isRegisteredSkillRoot(sourcePath: string, skillRoots: MindosSkillRoot[], trustedNativeSkillRoots: string[]): boolean {
  if (skillRoots.some((root) => resolve(root.path) === sourcePath)) return true;
  return trustedNativeSkillRoots.some((root) => resolve(root) === sourcePath);
}

function recordSkillInstall(
  payload: SkillsPostPayload,
  settings: MindosSkillsSettings,
  services: SkillsPostHandlerServices,
): MindosServerResponse<{ ok: true } | { error: string }> {
  const agentKey = payload.agentKey;
  const skillName = payload.name;
  const installPath = payload.installPath;
  if (!agentKey || !skillName || !installPath) {
    return json({ error: 'agentKey, name, and installPath are required' }, { status: 400 });
  }

  const installed = Array.isArray(settings.installedSkillAgents)
    ? [...settings.installedSkillAgents]
    : [];
  const entry = { agent: agentKey, skill: skillName, path: installPath };
  const index = installed.findIndex((item) => item.agent === agentKey && item.skill === skillName);
  if (index >= 0) installed[index] = entry;
  else installed.push(entry);

  services.writeSettings({ ...settings, installedSkillAgents: installed });
  return json({ ok: true });
}
