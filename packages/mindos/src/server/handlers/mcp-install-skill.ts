import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosSkillAgentRegistration } from './mcp-install.js';

export type MindosMcpInstallSkillRequest = {
  skill?: string;
  agents?: string[] | null;
};

export type MindosMcpInstallSkillServices = {
  skillAgentRegistry?: Record<string, MindosSkillAgentRegistration>;
  projectRoot?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  pathExists?(path: string): boolean;
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

export type MindosMcpInstallSkillResult =
  | {
      ok: true;
      skill: string;
      agents: string[];
      cmd: string;
      stdout: string;
    }
  | {
      ok: false;
      skill: string;
      agents: string[];
      cmd: string;
      stdout: string;
      stderr: string;
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

    const additionalAgents = filterAdditionalSkillAgents(
      requestedAgents.map((agent) => agent.trim()),
      services.skillAgentRegistry ?? {},
    );

    const sources = [GITHUB_SOURCE];
    const localDir = findLocalSkillsDir(services);
    if (localDir) sources.push(localDir);

    let lastCmd = '';
    let lastStdout = '';
    let lastStderr = '';
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
          cmd,
          stdout: lastStdout.trim(),
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
      cmd: lastCmd,
      stdout: lastStdout,
      stderr: lastStderr,
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

function findLocalSkillsDir(services: MindosMcpInstallSkillServices): string | null {
  const projectRoot = services.projectRoot ?? process.cwd();
  const cwd = services.cwd ?? process.cwd();
  const pathExists = services.pathExists ?? existsSync;
  const candidates = [
    resolve(cwd, 'data/skills'),
    join(projectRoot, 'skills'),
    join(projectRoot, 'packages', 'web', 'data', 'skills'),
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

function normalizeInstallSkillRequest(body: unknown): MindosMcpInstallSkillRequest {
  return body && typeof body === 'object' ? body as MindosMcpInstallSkillRequest : {};
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
