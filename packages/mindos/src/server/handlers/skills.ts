import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { json, publicCacheHeaders, type MindosServerResponse } from '../response.js';

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
  | 'record-install';

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
  readSettings(): MindosSkillsSettings;
  writeSettings(settings: MindosSkillsSettings): void;
};

export type SkillsPayload = {
  skills: MindosSkillInfo[];
};

export function handleSkillsGet(services: SkillsHandlerServices): MindosServerResponse<SkillsPayload> {
  const disabled = new Set(services.disabledSkills ?? []);
  const byName = new Map<string, MindosSkillInfo>();

  for (const root of services.skillRoots) {
    for (const skill of readSkillsFromRoot(root, disabled)) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }

  const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return json({ skills }, {
    headers: publicCacheHeaders(300),
  });
}

export function handleSkillsPost(
  body: unknown,
  services: SkillsPostHandlerServices,
): MindosServerResponse<{ ok: true } | { content: string; description?: string } | { error: string }> {
  const payload = normalizeSkillsPostPayload(body);
  const { action, name } = payload;
  const settings = services.readSettings();

  if (name && !isValidSkillName(name)) {
    return json({ error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' }, { status: 400 });
  }

  switch (action) {
    case 'toggle':
      if (!name) return json({ error: 'name required' }, { status: 400 });
      return toggleSkill(name, payload.enabled, settings, services);

    case 'create':
      if (!name) return json({ error: 'name required' }, { status: 400 });
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
      {
        const userSkillsDir = resolveUserSkillsDirForWrite(services.mindRoot);
        if ('response' in userSkillsDir) return userSkillsDir.response;
        return updateUserSkill(name, payload.content, userSkillsDir.path);
      }

    case 'delete':
      if (!name) return json({ error: 'name required' }, { status: 400 });
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
      return readNativeSkill(name, payload.sourcePath, services.skillRoots);

    case 'record-install':
      return recordSkillInstall(payload, settings, services);

    default:
      return json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
  }
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

  for (const entry of readdirSync(root.path, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
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

function isValidSkillName(name: string): boolean {
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
  return json({ error: 'Skill not found' }, { status: 404 });
}

function readNativeSkill(
  name: string,
  sourcePath: string,
  skillRoots: MindosSkillRoot[],
): MindosServerResponse<{ content: string; description?: string } | { error: string }> {
  const nativeBase = resolve(sourcePath);
  if (!isRegisteredSkillRoot(nativeBase, skillRoots)) {
    return json({ error: 'Invalid sourcePath' }, { status: 400 });
  }
  const nativeSkillFile = resolve(nativeBase, name, 'SKILL.md');
  const rel = relative(nativeBase, nativeSkillFile);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return json({ error: 'Invalid path' }, { status: 400 });
  }
  if (!existsSync(nativeSkillFile)) {
    return json({ error: 'Skill not found' }, { status: 404 });
  }
  const content = readFileSync(nativeSkillFile, 'utf-8');
  return json({ content, description: parseSkillMd(content).description });
}

function isRegisteredSkillRoot(sourcePath: string, skillRoots: MindosSkillRoot[]): boolean {
  return skillRoots.some((root) => resolve(root.path) === sourcePath);
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
