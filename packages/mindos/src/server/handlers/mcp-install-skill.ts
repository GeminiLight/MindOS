import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
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
  runCommand?(cmd: string, options: {
    encoding: 'utf-8';
    timeout: number;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
  }): string;
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

    const additionalAgents = filterAdditionalSkillAgents(
      Array.isArray(payload.agents) ? payload.agents : [],
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
      const cmd = buildMcpInstallSkillCommand(source, skill, additionalAgents);
      lastCmd = cmd;
      try {
        lastStdout = runCommand(cmd, {
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
    const registration = registry[key];
    if (!registration) return [key];
    if (registration.mode === 'unsupported' || registration.mode === 'universal') return [];
    return [registration.skillAgentName || key];
  });
}

export function buildMcpInstallSkillCommand(
  source: string,
  skill: string,
  additionalAgents: string[],
): string {
  const agentFlags = additionalAgents.length > 0
    ? additionalAgents.map((agent) => `-a ${agent}`).join(' ')
    : '-a universal';
  const quotedSource = /[/\\]/.test(source) ? `"${source}"` : source;
  return `npx skills add ${quotedSource} --skill ${skill} ${agentFlags} -g -y`;
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
  cmd: string,
  options: {
    encoding: 'utf-8';
    timeout: number;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
  },
): string {
  return execSync(cmd, options);
}
