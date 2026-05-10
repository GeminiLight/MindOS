import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosRuntimeSettings, MindosRuntimeSkillRoot } from '../runtime.js';

export type CustomAgentDef = {
  name: string;
  key: string;
  baseDir: string;
  global: string;
  project?: string | null;
  configKey: string;
  format: 'json' | 'toml';
  preferredTransport: 'stdio' | 'http';
  presenceDirs: string[];
  presenceCli?: string;
  globalNestedKey?: string;
  skillDir?: string;
};

export type CustomAgentSettings = MindosRuntimeSettings & {
  customAgents?: unknown;
};

export type CustomAgentSettingsServices = {
  readSettings: () => CustomAgentSettings;
  writeSettings: (settings: CustomAgentSettings) => void;
  builtInAgentKeys?: string[];
};

export type CustomAgentDetectPayload = {
  baseDir?: string;
};

export type DetectCustomAgentResult = {
  exists: boolean;
  detectedConfig?: string;
  detectedFormat?: 'json' | 'toml';
  detectedConfigKey?: string;
  hasSkillsDir: boolean;
  detectedSkillDir?: string;
  skillCount?: number;
  skillNames?: string[];
  mcpServers?: string[];
  mcpParseError?: string;
  suggestedName?: string;
};

export type AgentCopySkillPayload = {
  skillName?: string;
  targetPath?: string;
};

export type AgentCopySkillServices = {
  skillRoots: MindosRuntimeSkillRoot[];
  homeDir?: string;
  copyDirectory?: (sourcePath: string, targetPath: string) => Promise<void>;
};

const DEFAULT_BUILT_IN_AGENT_KEYS = [
  'mindos',
  'claude-code',
  'cursor',
  'windsurf',
  'cline',
  'trae',
  'gemini-cli',
  'openclaw',
  'codebuddy',
  'iflow-cli',
  'kimi-cli',
  'opencode',
  'pi',
  'augment',
  'qwen-code',
  'qoder',
  'trae-cn',
  'roo',
  'github-copilot',
  'codex',
  'antigravity',
  'qclaw',
  'workbuddy',
  'lingma',
  'copaw',
  'hermes',
];

export function slugifyCustomAgentName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  return slug || '';
}

export function generateUniqueCustomAgentKey(name: string, existingKeys: Set<string>): string {
  const base = slugifyCustomAgentName(name);

  if (!base) {
    let n = 1;
    while (existingKeys.has(`custom-${n}`)) n += 1;
    return `custom-${n}`;
  }

  if (!existingKeys.has(base)) return base;

  let n = 2;
  while (existingKeys.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function inferCustomAgentDefaults(name: string, baseDir: string): Omit<CustomAgentDef, 'key'> {
  const dir = ensureAgentDirTrailingSeparator(baseDir);
  return {
    name,
    baseDir: dir,
    global: appendAgentPathSegment(dir, 'mcp.json'),
    project: null,
    configKey: 'mcpServers',
    format: 'json',
    preferredTransport: 'stdio',
    presenceDirs: [dir],
    skillDir: appendAgentPathSegment(dir, 'skills/'),
  };
}

function hasAgentTrailingSeparator(input: string): boolean {
  return input.endsWith('/') || input.endsWith('\\');
}

function ensureAgentDirTrailingSeparator(input: string): string {
  return hasAgentTrailingSeparator(input) ? input : `${input}/`;
}

function appendAgentPathSegment(baseDir: string, segment: string): string {
  return `${ensureAgentDirTrailingSeparator(baseDir)}${segment}`;
}

function isAgentAbsoluteInputPath(input: string): boolean {
  if (input.startsWith('~/') || input.startsWith('~\\') || input.startsWith('/')) return true;
  if (process.platform === 'win32' && (/^[A-Z]:[\\/]/i.test(input) || input.startsWith('\\\\'))) return true;
  return false;
}

export function validateCustomAgentInput(
  input: { name?: string; baseDir?: string; key?: string },
  existingKeys: Set<string>,
  builtInAgentKeys: Set<string>,
  isEdit = false,
): string | null {
  if (!input.name?.trim()) return 'Agent name is required';
  if (!input.baseDir?.trim()) return 'Config directory is required';

  const dir = input.baseDir.trim();
  if (!isAgentAbsoluteInputPath(dir)) return 'Must be an absolute path (e.g. ~/.qclaw/)';

  if (!isEdit) {
    const key = input.key || slugifyCustomAgentName(input.name.trim());
    if (!key) return 'Cannot generate a valid key from this name';
    if (builtInAgentKeys.has(key)) return `Conflicts with built-in agent "${key}"`;
    if (existingKeys.has(key)) return `An agent with key "${key}" already exists`;
  }

  return null;
}

export function loadCustomAgentsFromSettings(settings: CustomAgentSettings): CustomAgentDef[] {
  const raw = settings.customAgents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is CustomAgentDef => {
    if (item == null || typeof item !== 'object') return false;
    const obj = item as Record<string, unknown>;
    return typeof obj.name === 'string' && typeof obj.key === 'string' && typeof obj.baseDir === 'string';
  });
}

export function handleCustomAgentsPost(
  body: Partial<CustomAgentDef> & { name?: string; baseDir?: string },
  services: CustomAgentSettingsServices,
): MindosServerResponse<{ agent: CustomAgentDef } | { error: string }> {
  try {
    const { name, baseDir, ...overrides } = body;
    if (!name?.trim() || !baseDir?.trim()) {
      return json({ error: 'name and baseDir are required' }, { status: 400 });
    }

    const settings = services.readSettings();
    const customs = loadCustomAgentsFromSettings(settings);
    const builtInAgentKeys = new Set(services.builtInAgentKeys ?? DEFAULT_BUILT_IN_AGENT_KEYS);
    const existingKeys = new Set([...builtInAgentKeys, ...customs.map((agent) => agent.key)]);
    const key = overrides.key?.trim() || generateUniqueCustomAgentKey(name.trim(), existingKeys);

    const error = validateCustomAgentInput({ name, baseDir, key }, existingKeys, builtInAgentKeys);
    if (error) return json({ error }, { status: 400 });

    const defaults = inferCustomAgentDefaults(name.trim(), baseDir.trim());
    const agent: CustomAgentDef = {
      ...defaults,
      key,
      ...(overrides.global && { global: overrides.global }),
      ...(overrides.project !== undefined && { project: overrides.project }),
      ...(overrides.configKey && { configKey: overrides.configKey }),
      ...(overrides.format && { format: overrides.format }),
      ...(overrides.preferredTransport && { preferredTransport: overrides.preferredTransport }),
      ...(overrides.presenceDirs && { presenceDirs: overrides.presenceDirs }),
      ...(overrides.presenceCli && { presenceCli: overrides.presenceCli }),
      ...(overrides.globalNestedKey && { globalNestedKey: overrides.globalNestedKey }),
      ...(overrides.skillDir && { skillDir: overrides.skillDir }),
    };

    services.writeSettings({ ...settings, customAgents: [...customs, agent] });
    return json({ agent }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleCustomAgentsPut(
  body: Partial<CustomAgentDef> & { key?: string },
  services: CustomAgentSettingsServices,
): MindosServerResponse<{ agent: CustomAgentDef } | { error: string }> {
  try {
    const { key, ...updates } = body;
    if (!key) return json({ error: 'key is required' }, { status: 400 });

    const settings = services.readSettings();
    const customs = loadCustomAgentsFromSettings(settings);
    const idx = customs.findIndex((agent) => agent.key === key);
    if (idx === -1) return json({ error: `Custom agent "${key}" not found` }, { status: 404 });

    if (updates.format && !['json', 'toml'].includes(updates.format)) {
      return json({ error: 'format must be "json" or "toml"' }, { status: 400 });
    }
    if (updates.preferredTransport && !['stdio', 'http'].includes(updates.preferredTransport)) {
      return json({ error: 'preferredTransport must be "stdio" or "http"' }, { status: 400 });
    }
    if (updates.baseDir) {
      const dir = updates.baseDir.trim();
      if (!isAgentAbsoluteInputPath(dir)) {
        return json({ error: 'baseDir must be an absolute path' }, { status: 400 });
      }
    }

    const existing = customs[idx];
    if (!existing) return json({ error: `Custom agent "${key}" not found` }, { status: 404 });

    const updated: CustomAgentDef = {
      ...existing,
      ...(updates.name && { name: updates.name }),
      ...(updates.baseDir && { baseDir: updates.baseDir }),
      ...(updates.global && { global: updates.global }),
      ...(updates.project !== undefined && { project: updates.project }),
      ...(updates.configKey && { configKey: updates.configKey }),
      ...(updates.format && { format: updates.format }),
      ...(updates.preferredTransport && { preferredTransport: updates.preferredTransport }),
      ...(updates.presenceCli !== undefined && { presenceCli: updates.presenceCli || undefined }),
      ...(updates.globalNestedKey !== undefined && { globalNestedKey: updates.globalNestedKey || undefined }),
      ...(updates.skillDir !== undefined && { skillDir: updates.skillDir || undefined }),
    };

    if (updates.presenceDirs) {
      updated.presenceDirs = updates.presenceDirs;
    } else if (updates.baseDir) {
      updated.presenceDirs = [ensureAgentDirTrailingSeparator(updates.baseDir)];
    }

    if (!updates.skillDir && updates.baseDir) {
      updated.skillDir = appendAgentPathSegment(updates.baseDir, 'skills/');
    }

    const nextAgents = customs.slice();
    nextAgents[idx] = updated;
    services.writeSettings({ ...settings, customAgents: nextAgents });
    return json({ agent: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleCustomAgentsDelete(
  body: { key?: string },
  services: CustomAgentSettingsServices,
): MindosServerResponse<{ removed: string } | { error: string }> {
  try {
    const { key } = body;
    if (!key) return json({ error: 'key is required' }, { status: 400 });

    const settings = services.readSettings();
    const customs = loadCustomAgentsFromSettings(settings);
    const filtered = customs.filter((agent) => agent.key !== key);
    if (filtered.length === customs.length) {
      return json({ error: `Custom agent "${key}" not found` }, { status: 404 });
    }

    services.writeSettings({ ...settings, customAgents: filtered });
    return json({ removed: key });
  } catch (error) {
    return errorResponse(error);
  }
}

export function expandAgentHome(input: string, homeDir = homedir()): string {
  return input.startsWith('~/') || input.startsWith('~\\') ? resolve(homeDir, input.slice(2)) : input;
}

function parseJsonc(text: string): Record<string, unknown> {
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (match, comment) => comment ? '' : match);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.trim()) return {};
  return JSON.parse(stripped) as Record<string, unknown>;
}

function parseJsonMcpServers(content: string, key: string): string[] {
  try {
    const config = parseJsonc(content);
    const servers = config[key];
    if (servers && typeof servers === 'object') {
      return Object.keys(servers).sort((a, b) => a.localeCompare(b));
    }
  } catch {
    return [];
  }
  return [];
}

function parseTomlMcpServers(content: string, sectionKey: string): string[] {
  const names = new Set<string>();
  const lines = content.split('\n');
  const sectionPrefix = `${sectionKey}.`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) continue;
    const section = trimmed.slice(1, -1).trim();
    if (!section.startsWith(sectionPrefix)) continue;
    const name = section.slice(sectionPrefix.length).split('.')[0]?.trim();
    if (name) names.add(name);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function detectConfigFormat(configPath: string): 'json' | 'toml' {
  return configPath.toLowerCase().endsWith('.toml') ? 'toml' : 'json';
}

export function detectCustomAgentProfile(
  baseDir: string,
  configPath: string,
  configKey: string,
  homeDir = homedir(),
): {
  mcpServers: string[];
  skillNames: string[];
  skillDir: string;
  configFormat: 'json' | 'toml';
  parseError?: string;
} {
  const expanded = expandAgentHome(baseDir, homeDir);
  const configAbsPath = expandAgentHome(configPath, homeDir);
  const configFormat = detectConfigFormat(configPath);
  const result: {
    mcpServers: string[];
    skillNames: string[];
    skillDir: string;
    configFormat: 'json' | 'toml';
    parseError?: string;
  } = {
    mcpServers: [],
    skillNames: [],
    skillDir: '',
    configFormat,
  };

  if (existsSync(configAbsPath)) {
    try {
      const content = readFileSync(configAbsPath, 'utf-8');
      result.mcpServers = configFormat === 'json'
        ? parseJsonMcpServers(content, configKey)
        : parseTomlMcpServers(content, configKey);
    } catch (error) {
      result.parseError = `Failed to parse MCP config: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  const skillDirPath = join(expanded, 'skills');
  result.skillDir = appendAgentPathSegment(baseDir, 'skills/');
  if (!existsSync(skillDirPath)) return result;

  try {
    result.skillNames = readdirSync(skillDirPath, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    // Keep empty skill list when the skill directory exists but is unreadable.
  }

  return result;
}

export function detectCustomAgentBaseDir(baseDir: string, homeDir = homedir()): DetectCustomAgentResult {
  const expanded = expandAgentHome(baseDir, homeDir);

  if (!existsSync(expanded)) {
    const dirName = basename(expanded.replace(/[\\/]+$/, ''));
    return {
      exists: false,
      hasSkillsDir: false,
      suggestedName: dirName.charAt(0).toUpperCase() + dirName.slice(1),
    };
  }

  const result: DetectCustomAgentResult = {
    exists: true,
    hasSkillsDir: false,
  };

  const dirName = basename(expanded.replace(/[\\/]+$/, ''));
  result.suggestedName = dirName.charAt(0).toUpperCase() + dirName.slice(1);

  const skillsPath = join(expanded, 'skills');
  if (existsSync(skillsPath)) {
    result.hasSkillsDir = true;
    result.detectedSkillDir = appendAgentPathSegment(baseDir, 'skills/');
    try {
      const skillNames = readdirSync(skillsPath, { withFileTypes: true })
        .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      result.skillCount = skillNames.length;
      result.skillNames = skillNames;
    } catch {
      result.skillCount = 0;
    }
  }

  let entries: string[];
  try {
    entries = readdirSync(expanded).slice(0, 20);
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = join(expanded, entry);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size > 1_000_000) continue;
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      if ('mcpServers' in raw) {
        result.detectedConfig = appendAgentPathSegment(baseDir, entry);
        result.detectedFormat = 'json';
        result.detectedConfigKey = 'mcpServers';
        return result;
      }
      if ('servers' in raw) {
        result.detectedConfig = appendAgentPathSegment(baseDir, entry);
        result.detectedFormat = 'json';
        result.detectedConfigKey = 'servers';
        return result;
      }
    } catch {
      // Skip unparseable files.
    }
  }

  for (const entry of entries) {
    if (!entry.endsWith('.toml')) continue;
    const filePath = join(expanded, entry);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size > 1_000_000) continue;
      const lines = readFileSync(filePath, 'utf-8').split('\n').slice(0, 50);
      for (const line of lines) {
        if (/^\s*\[mcp_servers/i.test(line) || /^\s*\[mcpServers/i.test(line)) {
          const lower = line.toLowerCase();
          result.detectedConfig = appendAgentPathSegment(baseDir, entry);
          result.detectedFormat = 'toml';
          result.detectedConfigKey = lower.includes('mcp_servers') ? 'mcp_servers' : 'mcpServers';
          return result;
        }
      }
    } catch {
      // Skip unreadable files.
    }
  }

  return result;
}

export function handleCustomAgentDetectPost(
  body: CustomAgentDetectPayload,
  options: { homeDir?: string } = {},
): MindosServerResponse<DetectCustomAgentResult | { error: string }> {
  try {
    if (!body.baseDir?.trim()) return json({ error: 'baseDir is required' }, { status: 400 });
    const dir = body.baseDir.trim();
    if (!isAgentAbsoluteInputPath(dir)) {
      return json({ error: 'baseDir must be an absolute path (e.g. ~/.qclaw/)' }, { status: 400 });
    }

    const result = detectCustomAgentBaseDir(dir, options.homeDir);
    if (result.detectedConfig && result.detectedConfigKey) {
      const profile = detectCustomAgentProfile(dir, result.detectedConfig, result.detectedConfigKey, options.homeDir);
      result.mcpServers = profile.mcpServers;
      result.skillNames = profile.skillNames;
      if (profile.parseError) result.mcpParseError = profile.parseError;
    }

    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

async function copyDirectoryRecursive(sourcePath: string, targetPath: string): Promise<void> {
  mkdirSync(targetPath, { recursive: true });
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const from = join(sourcePath, entry.name);
    const to = join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(from, to);
    } else if (entry.isFile()) {
      writeFileSync(to, readFileSync(from));
    }
  }
}

function findSkillSourcePath(skillName: string, skillRoots: MindosRuntimeSkillRoot[]): string | null {
  for (const root of skillRoots) {
    const candidate = join(root.path, skillName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function handleAgentCopySkillPost(
  body: AgentCopySkillPayload,
  services: AgentCopySkillServices,
): Promise<MindosServerResponse<{ success: true; skillName: string; targetPath: string } | { error: string }>> {
  try {
    if (!body.skillName?.trim()) return json({ error: 'skillName is required' }, { status: 400 });
    if (!body.targetPath?.trim()) return json({ error: 'targetPath is required' }, { status: 400 });

    const skillName = body.skillName.trim();
    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
      return json({ error: 'Invalid skill name' }, { status: 400 });
    }

    const targetPath = body.targetPath.trim();
    if (targetPath.includes('..')) return json({ error: 'Invalid target path' }, { status: 400 });
    if (!isAgentAbsoluteInputPath(targetPath)) {
      return json({ error: 'Target path must be absolute (starting with / or ~/)' }, { status: 400 });
    }

    const sourcePath = findSkillSourcePath(skillName, services.skillRoots);
    if (!sourcePath) return json({ error: `Skill "${skillName}" not found` }, { status: 404 });

    const homeDir = services.homeDir ?? homedir();
    const expandedTargetPath = expandAgentHome(targetPath, homeDir).replace(/\/$/, '');
    const targetSkillPath = join(expandedTargetPath, skillName);
    if (existsSync(targetSkillPath)) {
      return json({ error: `Skill "${skillName}" already exists in target directory` }, { status: 409 });
    }

    mkdirSync(dirname(targetSkillPath), { recursive: true });
    await (services.copyDirectory ?? copyDirectoryRecursive)(sourcePath, targetSkillPath);
    return json({ success: true, skillName, targetPath: targetSkillPath });
  } catch (error) {
    return errorResponse(error);
  }
}
