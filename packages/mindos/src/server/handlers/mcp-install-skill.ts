import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import type { Dirent, Stats } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, join, normalize, resolve } from 'path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosSkillAgentRegistration } from './mcp-install.js';
import type { MindosMcpAgentRegistryDef } from './mcp-agents.js';

export type MindosMcpInstallSkillRequest = {
  skill?: string;
  agents?: string[] | null;
};

export type MindosMcpInstallSkillServices = {
  skillAgentRegistry?: Record<string, MindosSkillAgentRegistration>;
  agents?: Record<string, MindosMcpAgentRegistryDef>;
  projectRoot?: string;
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  pathExists?(path: string): boolean;
  readDir?(path: string, options: { withFileTypes: true }): Dirent[];
  stat?(path: string): Stats;
  makeDir?(path: string, options: { recursive: true }): void;
  copyFile?(source: string, target: string): void;
  runCommand?(command: string, args: string[], options: {
    encoding: 'utf-8';
    timeout: number;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
  }): string;
};

export type MindosNpxInvocationOptions = {
  env?: NodeJS.ProcessEnv;
  nodeExecPath?: string;
  pathExists?(path: string): boolean;
  platform?: NodeJS.Platform;
};

export type MindosNpxInvocation = {
  command: string;
  args: string[];
};

export type MindosMcpInstallSkillLocalResult = {
  agent: string;
  name: string;
  mode: 'universal' | 'additional' | 'unsupported';
  status: 'exists' | 'copied' | 'repaired' | 'missing-source' | 'unknown-agent' | 'failed';
  workspacePath?: string;
  skillPath?: string;
  message?: string;
};

export type MindosMcpInstallSkillResult =
  | {
      ok: true;
      skill: string;
      agents: string[];
      method: 'local-copy' | 'npx';
      cmd: string;
      stdout: string;
      results?: MindosMcpInstallSkillLocalResult[];
    }
  | {
      ok: false;
      skill: string;
      agents: string[];
      method: 'local-copy' | 'npx';
      cmd: string;
      stdout: string;
      stderr: string;
      results?: MindosMcpInstallSkillLocalResult[];
    }
  | { error: string };

const GITHUB_SOURCE = 'GeminiLight/MindOS';
const VALID_SKILLS = new Set(['mindos', 'mindos-zh']);

export function handleMcpInstallSkillPost(
  body: unknown,
  services: MindosMcpInstallSkillServices = {},
): MindosServerResponse<MindosMcpInstallSkillResult> {
  try {
    const payload = normalizeInstallSkillRequest(body);
    const skill = payload.skill;

    if (!skill || !VALID_SKILLS.has(skill)) {
      return json({ error: 'Invalid skill name' }, { status: 400 });
    }

    const requestedAgents = Array.isArray(payload.agents) ? payload.agents : [];
    const invalidAgent = requestedAgents.find((agent) => (
      typeof agent !== 'string' || !isValidSkillAgentName(agent.trim())
    ));
    if (invalidAgent !== undefined) {
      return json({ error: 'Invalid agent name' }, { status: 400 });
    }

    const requestedAgentKeys = [...new Set(requestedAgents.map((agent) => agent.trim()))];
    const additionalAgents = filterAdditionalSkillAgents(
      requestedAgentKeys,
      services.skillAgentRegistry ?? {},
    );

    const localInstall = installSkillFromLocalSource(skill, requestedAgentKeys, services);
    if (localInstall.attempted && localInstall.ok) {
      return json({
        ok: true,
        skill,
        agents: requestedAgentKeys,
        method: 'local-copy',
        cmd: localInstall.cmd,
        stdout: localInstall.stdout,
        results: localInstall.results,
      });
    }

    const sources = [GITHUB_SOURCE];
    if (localInstall.sourceRoot) sources.push(localInstall.sourceRoot);

    let lastCmd = '';
    let lastStdout = '';
    let lastStderr = localInstall.stderr ?? '';
    const runCommand = services.runCommand ?? defaultRunCommand;

    for (const source of sources) {
      const args = buildMcpInstallSkillArgs(source, skill, additionalAgents);
      const cmd = formatCommandForDisplay('npx', args);
      lastCmd = cmd;
      try {
        lastStdout = runCommand('npx', args, {
          encoding: 'utf-8',
          timeout: 30_000,
          env: { ...process.env, ...(services.env ?? {}), NODE_ENV: 'production' },
          stdio: 'pipe',
        });
        return json({
          ok: true,
          skill,
          agents: additionalAgents,
          method: 'npx',
          cmd,
          stdout: lastStdout.trim(),
          ...(localInstall.results ? { results: localInstall.results } : {}),
        });
      } catch (error) {
        const commandError = error as { stdout?: string; stderr?: string; message?: string };
        lastStdout = commandError.stdout || '';
        lastStderr = commandError.stderr || commandError.message || 'Unknown error';
      }
    }

    return json({
      ok: false,
      skill,
      agents: additionalAgents,
      method: lastCmd ? 'npx' : 'local-copy',
      cmd: lastCmd,
      stdout: lastStdout,
      stderr: lastStderr,
      ...(localInstall.results ? { results: localInstall.results } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function filterAdditionalSkillAgents(
  agentKeys: string[],
  registry: Record<string, MindosSkillAgentRegistration>,
): string[] {
  return agentKeys.flatMap((key) => {
    if (!isValidSkillAgentName(key)) return [];
    const registration = Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
    if (!registration) return [key];
    if (registration.mode === 'unsupported' || registration.mode === 'universal') return [];
    const skillAgentName = registration.skillAgentName || key;
    return isValidSkillAgentName(skillAgentName) ? [skillAgentName] : [];
  });
}

function isValidSkillAgentName(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    && value !== '__proto__'
    && value !== 'prototype'
    && value !== 'constructor'
  );
}

export function buildMcpInstallSkillCommand(
  source: string,
  skill: string,
  additionalAgents: string[],
): string {
  return formatCommandForDisplay('npx', buildMcpInstallSkillArgs(source, skill, additionalAgents));
}

export function buildMcpInstallSkillArgs(
  source: string,
  skill: string,
  additionalAgents: string[],
): string[] {
  const agents = additionalAgents.length > 0 ? additionalAgents : ['universal'];
  return [
    'skills',
    'add',
    source,
    '--skill',
    skill,
    ...agents.flatMap((agent) => ['-a', agent]),
    '-g',
    '-y',
  ];
}

type LocalSkillInstallAttempt = {
  attempted: boolean;
  ok: boolean;
  sourceRoot?: string;
  cmd: string;
  stdout: string;
  stderr?: string;
  results?: MindosMcpInstallSkillLocalResult[];
};

type LocalSkillInstallTarget = {
  agent: string;
  name: string;
  mode: 'universal' | 'additional' | 'unsupported';
  workspacePath: string;
};

function installSkillFromLocalSource(
  skill: string,
  agentKeys: string[],
  services: MindosMcpInstallSkillServices,
): LocalSkillInstallAttempt {
  const sourceRoot = findLocalSkillSourceRoot(skill, services);
  if (!sourceRoot) {
    return {
      attempted: false,
      ok: false,
      cmd: '',
      stdout: '',
      stderr: `Packaged skill ${skill} was not found.`,
    };
  }

  const targets = resolveLocalInstallTargets(agentKeys, services);
  const results = targets.map((target) => {
    if (!target.workspacePath) {
      return {
        agent: target.agent,
        name: target.name,
        mode: target.mode,
        status: 'unknown-agent',
        message: `Unknown agent: ${target.agent}`,
      } satisfies MindosMcpInstallSkillLocalResult;
    }
    return copyLocalSkill(skill, sourceRoot, target, services);
  });
  const ok = results.every((result) => (
    result.status === 'exists'
    || result.status === 'copied'
    || result.status === 'repaired'
  ));
  const statusSummary = results.map((result) => `${result.agent}:${result.status}`).join(', ');

  return {
    attempted: true,
    ok,
    sourceRoot,
    cmd: [
      'local-copy',
      formatArgForDisplay(sourceRoot),
      '--skill',
      formatArgForDisplay(skill),
      ...agentKeys.map((agent) => ['--agent', formatArgForDisplay(agent)]).flat(),
    ].join(' '),
    stdout: statusSummary ? `Installed ${skill}: ${statusSummary}` : `Installed ${skill}`,
    stderr: ok ? '' : results.find((result) => result.message)?.message ?? 'Local skill installation failed.',
    results,
  };
}

function resolveLocalInstallTargets(
  agentKeys: string[],
  services: MindosMcpInstallSkillServices,
): LocalSkillInstallTarget[] {
  if (agentKeys.length === 0) {
    return [{
      agent: 'universal',
      name: 'Universal Agents',
      mode: 'universal',
      workspacePath: expandUserPath('~/.agents/skills', services.homeDir),
    }];
  }

  return agentKeys.map((agentKey) => {
    const agent = services.agents?.[agentKey];
    if (!agent) {
      return {
        agent: agentKey,
        name: agentKey,
        mode: 'unsupported' as const,
        workspacePath: '',
      };
    }

    const profile = resolveSkillWorkspaceProfile(agentKey, agent, services);
    return {
      agent: agentKey,
      name: agent.name,
      mode: profile.mode,
      workspacePath: profile.workspacePath,
    };
  });
}

function resolveSkillWorkspaceProfile(
  agentKey: string,
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpInstallSkillServices,
): {
  mode: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
  workspacePath: string;
} {
  const registration = services.skillAgentRegistry?.[agentKey] ?? { mode: 'unsupported' as const };
  if (registration.mode === 'universal') {
    return {
      mode: registration.mode,
      workspacePath: expandUserPath('~/.agents/skills', services.homeDir),
    };
  }

  return {
    mode: registration.mode,
    skillAgentName: registration.skillAgentName,
    workspacePath: agent.skillDir
      ? expandUserPath(agent.skillDir, services.homeDir)
      : join(resolveAgentRoot(agent, services), 'skills'),
  };
}

function resolveAgentRoot(
  agent: MindosMcpAgentRegistryDef,
  services: MindosMcpInstallSkillServices,
): string {
  const homeDir = services.homeDir ?? homedir();
  const pathExists = services.pathExists ?? existsSync;
  const stat = services.stat ?? statSync;
  const globalConfigPath = agent.global ? expandUserPath(agent.global, homeDir) : null;
  const globalConfigDir = globalConfigPath ? dirname(globalConfigPath) : null;
  const presenceDirs = (agent.presenceDirs ?? []).map((entry) => expandUserPath(entry, homeDir));
  const matchingGlobalDir = presenceDirs.find((candidate) => {
    if (!globalConfigDir) return false;
    const normalizedCandidate = normalizeDir(candidate);
    const normalizedGlobal = normalizeDir(globalConfigDir);
    return normalizedGlobal === normalizedCandidate || normalizedGlobal.startsWith(`${normalizedCandidate}/`);
  });
  if (matchingGlobalDir) return matchingGlobalDir;

  for (const candidate of presenceDirs) {
    if (!pathExists(candidate)) continue;
    try {
      const info = stat(candidate);
      return info.isFile() ? dirname(candidate) : candidate;
    } catch {
      return candidate;
    }
  }

  return presenceDirs[0] ?? globalConfigDir ?? expandUserPath('~/.agents', homeDir);
}

function copyLocalSkill(
  skill: string,
  sourceRoot: string,
  target: LocalSkillInstallTarget,
  services: MindosMcpInstallSkillServices,
): MindosMcpInstallSkillLocalResult {
  const pathExists = services.pathExists ?? existsSync;
  const stat = services.stat ?? statSync;
  const sourceDir = join(sourceRoot, skill);
  const sourceSkillFile = join(sourceDir, 'SKILL.md');
  const targetDir = join(target.workspacePath, skill);
  const targetSkillFile = join(targetDir, 'SKILL.md');

  if (!pathExists(sourceSkillFile)) {
    return {
      agent: target.agent,
      name: target.name,
      mode: target.mode,
      status: 'missing-source',
      workspacePath: target.workspacePath,
      skillPath: targetSkillFile,
      message: `Packaged skill ${skill} was not found.`,
    };
  }
  if (pathExists(targetSkillFile)) {
    return {
      agent: target.agent,
      name: target.name,
      mode: target.mode,
      status: 'exists',
      workspacePath: target.workspacePath,
      skillPath: targetSkillFile,
    };
  }

  let repaired = false;
  if (pathExists(targetDir)) {
    try {
      repaired = stat(targetDir).isDirectory();
    } catch {
      repaired = true;
    }
  }

  try {
    copyDirSync(sourceDir, targetDir, services);
    return {
      agent: target.agent,
      name: target.name,
      mode: target.mode,
      status: repaired ? 'repaired' : 'copied',
      workspacePath: target.workspacePath,
      skillPath: targetSkillFile,
    };
  } catch (error) {
    return {
      agent: target.agent,
      name: target.name,
      mode: target.mode,
      status: 'failed',
      workspacePath: target.workspacePath,
      skillPath: targetSkillFile,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function copyDirSync(
  sourceDir: string,
  targetDir: string,
  services: MindosMcpInstallSkillServices,
): void {
  const readDir = services.readDir ?? readdirSync;
  const makeDir = services.makeDir ?? mkdirSync;
  const copyFile = services.copyFile ?? copyFileSync;

  makeDir(targetDir, { recursive: true });
  for (const entry of readDir(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(sourcePath, targetPath, services);
    } else {
      copyFile(sourcePath, targetPath);
    }
  }
}

export function resolveNpxInvocation(
  args: string[],
  options: MindosNpxInvocationOptions = {},
): MindosNpxInvocation {
  const env = options.env ?? process.env;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const pathExists = options.pathExists ?? existsSync;
  const npxCliPath = findNpxCliPath(nodeExecPath, env, pathExists);

  if (npxCliPath) {
    return { command: nodeExecPath, args: [npxCliPath, ...args] };
  }

  if ((options.platform ?? process.platform) === 'win32') {
    throw new Error('Unable to locate npm npx-cli.js for shell-free skill installation on Windows');
  }

  return { command: 'npx', args };
}

function formatCommandForDisplay(command: string, args: string[]): string {
  return [command, ...args].map(formatArgForDisplay).join(' ');
}

function formatArgForDisplay(arg: string): string {
  if (/^[A-Za-z0-9._=-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

function findLocalSkillSourceRoot(skill: string, services: MindosMcpInstallSkillServices): string | null {
  const projectRoot = services.projectRoot ?? process.cwd();
  const cwd = services.cwd ?? process.cwd();
  const pathExists = services.pathExists ?? existsSync;
  const candidates = [
    resolve(cwd, 'data/skills'),
    join(projectRoot, 'skills'),
    join(projectRoot, 'packages', 'web', 'data', 'skills'),
  ];

  for (const candidate of candidates) {
    if (pathExists(join(candidate, skill, 'SKILL.md'))) return candidate;
  }
  return null;
}

function normalizeInstallSkillRequest(body: unknown): MindosMcpInstallSkillRequest {
  return body && typeof body === 'object' ? body as MindosMcpInstallSkillRequest : {};
}

function expandUserPath(value: string, homeDir = homedir(), cwd = process.cwd()): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(homeDir, value.slice(2));
  if (isAbsolute(value)) return value;
  return resolve(cwd, value);
}

function normalizeDir(value: string): string {
  return normalize(value).replace(/[\\/]+$/g, '');
}

function defaultRunCommand(
  command: string,
  args: string[],
  options: {
    encoding: 'utf-8';
    timeout: number;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
  },
): string {
  const invocation = command === 'npx'
    ? resolveNpxInvocation(args, { env: options.env })
    : { command, args };
  return execFileSync(invocation.command, invocation.args, options);
}

function findNpxCliPath(
  nodeExecPath: string,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string | null {
  const candidates = new Set<string>();
  if (env.npm_execpath) {
    candidates.add(join(dirname(env.npm_execpath), 'npx-cli.js'));
  }

  const nodeDir = dirname(nodeExecPath);
  candidates.add(join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'));
  candidates.add(resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'));

  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate;
  }
  return null;
}
