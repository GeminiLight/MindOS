/**
 * CLI agent-readiness inspection (`mindos doctor agents`, `mindos agent …`).
 *
 * Orchestration only: the config parsers, the agent/skill registries, the
 * hidden-root + skill-workspace resolution and the presence probes all come
 * from the generated agent-config bundle (the same source the product server
 * and Web host use). This file keeps just the CLI-specific readiness model:
 * classifying the MindOS MCP entry, checking the `mindos` command is reachable
 * and reporting issues/actions per agent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';

import { loadAgentConfigBundle } from './agent-config.js';
import { MCP_AGENTS, SKILL_AGENT_REGISTRY, detectAgentPresence } from './mcp-agents.js';

const {
  configPathCandidates,
  defaultCommandExists,
  entryLocation,
  listInstalledSkillNames,
  parseJsonc,
  readMcpServerEntryFromText,
  resolveAgentConfigProbes,
  resolveSkillWorkspaceProfile: coreResolveSkillWorkspaceProfile,
} = await loadAgentConfigBundle();

const VALID_SKILL_NAMES = new Set(['mindos', 'mindos-zh']);

/** CLI path expansion: `~` against homeDir, relative project paths against cwd. */
function expandUserPath(value, homeDir = homedir(), cwd = process.cwd()) {
  if (!value) return value;
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(homeDir, value.slice(2));
  if (isAbsolute(value)) return value;
  return resolve(cwd, value);
}

export { configPathCandidates };

/** Probes for the core resolvers, honouring the CLI's injectable fs hooks. */
function probesFrom(options = {}) {
  return resolveAgentConfigProbes({
    homeDir: options.homeDir,
    pathExists: options.pathExists,
    readTextFile: options.readFile,
    stat: options.stat,
  });
}

function readMcpEntryFromConfig(agent, scope, cfgPath, options) {
  const readFile = options.readFile ?? ((file) => readFileSync(file, 'utf-8'));
  return readMcpServerEntryFromText(readFile(cfgPath), entryLocation(agent, scope), 'mindos');
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
        return { configured: true, scope, configPath, source: candidate, entry, ...classifyMcpEntry(entry) };
      } catch (error) {
        parseErrors.push({ scope, configPath, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { configured: false, parseErrors };
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

  return { transport: 'stdio', valid: issues.length === 0, command: firstCommand, issues };
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

/** Skill workspace for `agentKey`; delegates the resolution rule to the core adapter layer. */
export function resolveSkillWorkspaceProfile(agentKey, options = {}) {
  const def = MCP_AGENTS[agentKey] ?? {};
  const registration = SKILL_AGENT_REGISTRY[agentKey] ?? { mode: 'unsupported' };
  return coreResolveSkillWorkspaceProfile(agentKey, def, registration, probesFrom(options));
}

export function detectAgentInstalledSkills(agentKey, options = {}) {
  const profile = resolveSkillWorkspaceProfile(agentKey, options);
  const skills = listInstalledSkillNames(profile.workspacePath, probesFrom(options), { requireSkillFile: true });
  return { skills, sourcePath: profile.workspacePath };
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
