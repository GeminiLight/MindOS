import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';

import { parseJsonc } from './jsonc.js';
import { MCP_AGENTS, SKILL_AGENT_REGISTRY, detectAgentPresence } from './mcp-agents.js';

const VALID_SKILL_NAMES = new Set(['mindos', 'mindos-zh']);

function expandUserPath(value, homeDir = homedir(), cwd = process.cwd()) {
  if (!value) return value;
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(homeDir, value.slice(2));
  if (isAbsolute(value)) return value;
  return resolve(cwd, value);
}

export function configPathCandidates(agent, scope) {
  const primary = scope === 'global' ? agent.global : agent.project;
  const readAlso = scope === 'global' ? agent.globalReadAlso : agent.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter(Boolean);
}

function readNestedRecord(obj, nestedPath) {
  let current = obj;
  for (const part of nestedPath.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = current[part];
  }
  return current && typeof current === 'object' ? current : null;
}

function readOwnRecord(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const value = obj[key];
  return value && typeof value === 'object' ? value : null;
}

function unquoteScalar(raw) {
  const value = String(raw || '').trim().replace(/,$/, '').trim();
  const match = value.match(/^["']([\s\S]*)["']$/);
  return match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : value;
}

function parseInlineArray(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body.split(',').map((part) => unquoteScalar(part)).filter(Boolean);
}

function parseInlineTomlObject(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return {};
  const entry = {};
  for (const part of trimmed.slice(1, -1).split(',')) {
    const match = part.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    entry[key] = value.trim().startsWith('[') ? parseInlineArray(value) : unquoteScalar(value);
  }
  return entry;
}

function parseTomlMcpEntry(content, sectionKey, serverName) {
  const target = `[${sectionKey}.${serverName}]`;
  const targetEnv = `[${sectionKey}.${serverName}.env]`;
  const targetEnvironment = `[${sectionKey}.${serverName}.environment]`;
  const targetHeaders = `[${sectionKey}.${serverName}.headers]`;
  const root = `[${sectionKey}]`;
  const entry = {};
  let found = false;
  let section = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (trimmed === target) {
        section = 'entry';
        found = true;
      } else if (trimmed === targetEnv) {
        section = 'env';
        entry.env = entry.env || {};
        found = true;
      } else if (trimmed === targetEnvironment) {
        section = 'environment';
        entry.environment = entry.environment || {};
        found = true;
      } else if (trimmed === targetHeaders) {
        section = 'headers';
        entry.headers = entry.headers || {};
        found = true;
      } else if (trimmed === root) {
        section = 'root';
      } else {
        section = null;
      }
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;

    if (section === 'root' && key === serverName) {
      Object.assign(entry, parseInlineTomlObject(rawValue));
      found = true;
      continue;
    }

    if (!['entry', 'env', 'environment', 'headers'].includes(section)) continue;
    const targetObj = section === 'entry' ? entry : entry[section];
    targetObj[key] = rawValue.trim().startsWith('[') ? parseInlineArray(rawValue) : unquoteScalar(rawValue);
  }

  return found ? entry : null;
}

function parseYamlScalar(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return parseInlineArray(trimmed);
  return unquoteScalar(trimmed);
}

function parseYamlMcpEntry(content, sectionKey, serverName) {
  const entry = {};
  let inSection = false;
  let inServer = false;
  let sectionChildIndent = -1;
  let serverChildIndent = -1;
  let nestedKey = null;

  for (const line of content.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0 && trimmed === `${sectionKey}:`) {
      inSection = true;
      inServer = false;
      sectionChildIndent = -1;
      continue;
    }
    if (indent === 0 && trimmed) {
      if (inServer) return entry;
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    if (sectionChildIndent < 0) sectionChildIndent = indent;
    if (indent === sectionChildIndent) {
      if (inServer) return entry;
      inServer = trimmed === `${serverName}:` || trimmed === `"${serverName}":`;
      nestedKey = null;
      continue;
    }
    if (!inServer) continue;

    if (serverChildIndent < 0) serverChildIndent = indent;
    if (indent === serverChildIndent) {
      const nested = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*$/);
      if (nested) {
        nestedKey = nested[1];
        entry[nestedKey] = entry[nestedKey] || {};
        continue;
      }
      nestedKey = null;
      const kv = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
      if (kv) entry[kv[1]] = parseYamlScalar(kv[2]);
      continue;
    }

    if (nestedKey && indent > serverChildIndent) {
      const kv = trimmed.match(/^([A-Za-z0-9_.-]+|"[^"]+")\s*:\s*(.+)$/);
      if (!kv) continue;
      entry[nestedKey][unquoteScalar(kv[1])] = parseYamlScalar(kv[2]);
    }
  }

  return inServer ? entry : null;
}

function readMcpEntryFromConfig(agent, scope, cfgPath, options) {
  const readFile = options.readFile ?? ((file) => readFileSync(file, 'utf-8'));
  const content = readFile(cfgPath);

  if (agent.format === 'toml') {
    return parseTomlMcpEntry(content, agent.key, 'mindos');
  }
  if (agent.format === 'yaml') {
    return parseYamlMcpEntry(content, agent.key, 'mindos');
  }

  const parsed = parseJsonc(content);
  const section = scope === 'global' && agent.globalNestedKey
    ? readNestedRecord(parsed, agent.globalNestedKey)
    : readOwnRecord(parsed, agent.key);
  return section?.mindos && typeof section.mindos === 'object' ? section.mindos : null;
}

export function detectMindosMcpConfig(agentKey, options = {}) {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { configured: false, error: `Unknown agent: ${agentKey}` };
  const pathExists = options.pathExists ?? existsSync;
  const homeDir = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const parseErrors = [];

  for (const scope of ['global', 'project']) {
    for (const candidate of configPathCandidates(agent, scope)) {
      const configPath = expandUserPath(candidate, homeDir, scope === 'project' ? cwd : process.cwd());
      if (!pathExists(configPath)) continue;
      try {
        const entry = readMcpEntryFromConfig(agent, scope, configPath, options);
        if (!entry) continue;
        return {
          configured: true,
          scope,
          configPath,
          source: candidate,
          entry,
          ...classifyMcpEntry(entry),
        };
      } catch (error) {
        parseErrors.push({
          scope,
          configPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    configured: false,
    parseErrors,
  };
}

function classifyMcpEntry(entry) {
  if (typeof entry.url === 'string' && entry.url.trim()) {
    return { transport: 'http', valid: true, issues: [] };
  }
  if (entry.type === 'stdio' || entry.type === 'local' || entry.command) {
    return validateStdioEntry(entry);
  }
  return { transport: 'unknown', valid: false, issues: ['MindOS MCP entry has no url or stdio command.'] };
}

function commandParts(entry) {
  const command = Array.isArray(entry.command) ? entry.command.map(String) : [String(entry.command || '')].filter(Boolean);
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  return { command, args, all: [...command, ...args] };
}

function isMindosCommand(value) {
  if (!value) return false;
  const base = basename(String(value).replace(/\\/g, '/')).toLowerCase();
  return base === 'mindos' || base === 'mindos.cmd';
}

function validateStdioEntry(entry) {
  const { command, all } = commandParts(entry);
  const firstCommand = command[0] || '';
  const issues = [];

  if (!isMindosCommand(firstCommand)) {
    issues.push('MindOS MCP stdio command must run `mindos`.');
  }
  if (!all.some((part, index) => index > 0 && part === 'mcp')) {
    issues.push('MindOS MCP stdio command must include the `mcp` argument.');
  }

  const env = entry.env || entry.environment;
  if (env && typeof env === 'object' && env.MCP_TRANSPORT && env.MCP_TRANSPORT !== 'stdio') {
    issues.push('MCP_TRANSPORT must be `stdio` when present.');
  }

  return {
    transport: 'stdio',
    valid: issues.length === 0,
    command: firstCommand,
    issues,
  };
}

export function getActiveSkillName(options = {}) {
  const configPath = options.configPath ?? resolve(options.homeDir ?? homedir(), '.mindos', 'config.json');
  const readFile = options.readFile ?? ((file) => readFileSync(file, 'utf-8'));
  try {
    const config = parseJsonc(readFile(configPath));
    if (Array.isArray(config.disabledSkills) && config.disabledSkills.includes('mindos')) {
      return 'mindos-zh';
    }
  } catch {
    // First-time diagnostics should still know which skill would be required.
  }
  return 'mindos';
}

function normalizeDir(value) {
  return normalize(value).replace(/[\\/]+$/g, '');
}

function resolveAgentRoot(agent, options = {}) {
  const homeDir = options.homeDir ?? homedir();
  const pathExists = options.pathExists ?? existsSync;
  const stat = options.stat ?? statSync;
  const globalConfigPath = agent.global ? expandUserPath(agent.global, homeDir) : null;
  const globalConfigDir = globalConfigPath ? dirname(globalConfigPath) : null;

  const expandedPresenceDirs = (agent.presenceDirs ?? []).map((entry) => expandUserPath(entry, homeDir));
  const matchingGlobalDir = expandedPresenceDirs.find((candidate) => {
    if (!globalConfigDir) return false;
    const normalizedCandidate = normalizeDir(candidate);
    const normalizedGlobal = normalizeDir(globalConfigDir);
    return normalizedGlobal === normalizedCandidate || normalizedGlobal.startsWith(`${normalizedCandidate}/`);
  });
  if (matchingGlobalDir) return matchingGlobalDir;

  for (const candidate of expandedPresenceDirs) {
    if (!pathExists(candidate)) continue;
    try {
      const info = stat(candidate);
      return info.isFile() ? dirname(candidate) : candidate;
    } catch {
      return candidate;
    }
  }

  if (expandedPresenceDirs[0]) return expandedPresenceDirs[0];
  return globalConfigDir ?? expandUserPath('~/.agents', homeDir);
}

export function resolveSkillWorkspaceProfile(agentKey, options = {}) {
  const registration = SKILL_AGENT_REGISTRY[agentKey] ?? { mode: 'unsupported' };
  if (registration.mode === 'universal') {
    return {
      mode: registration.mode,
      workspacePath: expandUserPath('~/.agents/skills', options.homeDir ?? homedir()),
    };
  }

  const agent = MCP_AGENTS[agentKey];
  const workspacePath = agent?.skillDir
    ? expandUserPath(agent.skillDir, options.homeDir ?? homedir())
    : resolve(resolveAgentRoot(agent ?? {}, options), 'skills');

  return {
    mode: registration.mode,
    skillAgentName: registration.skillAgentName,
    workspacePath,
  };
}

export function detectAgentInstalledSkills(agentKey, options = {}) {
  const profile = resolveSkillWorkspaceProfile(agentKey, options);
  const pathExists = options.pathExists ?? existsSync;
  const readDir = options.readDir ?? readdirSync;
  const workspacePath = profile.workspacePath;
  if (!pathExists(workspacePath)) return { skills: [], sourcePath: workspacePath };

  let entries = [];
  try {
    entries = readDir(workspacePath, { withFileTypes: true });
  } catch {
    return { skills: [], sourcePath: workspacePath };
  }

  const skills = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
    .filter((entry) => pathExists(resolve(workspacePath, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return { skills, sourcePath: workspacePath };
}

function defaultCommandExists(command) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function inspectCommandAvailability(mcp, options = {}) {
  if (mcp.transport !== 'stdio') {
    return { required: false, ok: true };
  }

  const command = mcp.command || 'mindos';
  const homeDir = options.homeDir ?? homedir();
  const pathExists = options.pathExists ?? existsSync;
  const commandExists = options.commandExists ?? defaultCommandExists;

  if (isAbsolute(command)) {
    return {
      required: true,
      command,
      ok: pathExists(command),
      source: pathExists(command) ? 'absolute-path' : 'missing-absolute-path',
    };
  }

  if (commandExists(command)) {
    return { required: true, command, ok: true, source: 'path' };
  }

  const shimPath = resolve(homeDir, '.mindos', 'bin', process.platform === 'win32' ? 'mindos.cmd' : 'mindos');
  const shimExists = pathExists(shimPath);
  return {
    required: true,
    command,
    ok: shimExists,
    source: shimExists ? 'mindos-shim' : 'missing',
    shimPath,
  };
}

function statusFromParts({ mcp, command, skill }) {
  if (!mcp.configured) return 'missing-mcp';
  if (!mcp.valid) return 'invalid-mcp';
  if (command.required && !command.ok) return 'missing-command';
  if (skill.required && !skill.installed) return 'missing-skill';
  return 'ready';
}

export function inspectAgentReadiness(agentKey, options = {}) {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) {
    return {
      key: agentKey,
      name: agentKey,
      present: false,
      ready: false,
      status: 'unknown-agent',
      issues: [`Unknown agent: ${agentKey}`],
      actions: [],
    };
  }

  const present = options.detectPresence ? options.detectPresence(agentKey) : detectAgentPresence(agentKey);
  const activeSkillName = options.skillName && VALID_SKILL_NAMES.has(options.skillName)
    ? options.skillName
    : getActiveSkillName(options);
  const mcp = detectMindosMcpConfig(agentKey, options);
  const command = inspectCommandAvailability(mcp, options);
  const profile = resolveSkillWorkspaceProfile(agentKey, options);
  const installedSkills = detectAgentInstalledSkills(agentKey, options);
  const skillInstalled = installedSkills.skills.includes(activeSkillName);
  const skill = {
    required: true,
    mode: profile.mode,
    skillAgentName: profile.skillAgentName,
    skillName: activeSkillName,
    installed: skillInstalled,
    workspacePath: profile.workspacePath,
    skillPath: resolve(profile.workspacePath, activeSkillName),
    installedSkills: installedSkills.skills,
  };
  const status = statusFromParts({ mcp, command, skill });
  const issues = [];
  const actions = [];

  if (!present) issues.push('Agent app was not detected from CLI or local data directories.');
  if (!mcp.configured) {
    issues.push('MindOS MCP is not configured for this agent.');
    actions.push(`mindos mcp install ${agentKey} -g -y`);
  } else if (!mcp.valid) {
    issues.push(...(mcp.issues ?? []));
    actions.push(`mindos mcp install ${agentKey} -g -y`);
  }
  if (command.required && !command.ok) {
    issues.push('The `mindos` command is not reachable from PATH and no ~/.mindos/bin shim was found.');
    actions.push('mindos doctor');
  }
  if (!skillInstalled) {
    issues.push(`MindOS Skill ${activeSkillName} is missing from ${profile.workspacePath}.`);
    actions.push(`mindos mcp install ${agentKey} -g -y`);
  }

  return {
    key: agentKey,
    name: agent.name,
    present,
    ready: status === 'ready',
    status,
    mcp,
    command,
    skill,
    issues,
    actions: [...new Set(actions)],
  };
}

export function inspectAllAgentReadiness(options = {}) {
  return Object.keys(MCP_AGENTS).map((key) => inspectAgentReadiness(key, options));
}
