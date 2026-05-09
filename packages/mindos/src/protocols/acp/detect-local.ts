import fs from 'fs';
import os from 'os';
import { execFile, execFileSync } from 'child_process';
import { findUserOverride, getDetectableAgents, resolveAgentCommand } from './agent-descriptors.js';
import type { AcpAgentOverride } from './agent-descriptors.js';

export interface InstalledAgent {
  id: string;
  name: string;
  binaryPath: string;
  resolvedCommand: {
    cmd: string;
    args: string[];
    source: 'user-override' | 'descriptor' | 'registry';
  };
}

export interface NotInstalledAgent {
  id: string;
  name: string;
  installCmd: string;
  packageName?: string;
}

export interface LocalAcpDetectionOptions {
  overrides?: Record<string, AcpAgentOverride>;
}

export function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return `${os.homedir()}/${filePath.slice(2)}`;
  return filePath;
}

export function isPathLikeCommand(command: string): boolean {
  return command.startsWith('~/') || command.startsWith('/') || command.startsWith('./') || command.startsWith('../') || command.includes('\\') || /^[A-Za-z]:[\\/]/.test(command);
}

export function resolveDirectCommandPath(command: string | undefined): string | null {
  if (!command) return null;
  const trimmed = command.trim();
  if (!trimmed || !isPathLikeCommand(trimmed)) return null;
  const expanded = expandHome(trimmed);
  return fs.existsSync(expanded) ? expanded : null;
}

export function resolveExistingPresenceDir(paths: string[] | undefined): string | null {
  if (!paths || paths.length === 0) return null;
  for (const candidate of paths) {
    const expanded = expandHome(candidate);
    if (fs.existsSync(expanded)) return expanded;
  }
  return null;
}

function parseResolvedPath(stdout: string): string | null {
  const candidates = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const expanded = expandHome(candidate);
    if (isPathLikeCommand(expanded) && fs.existsSync(expanded)) return expanded;
  }
  for (const candidate of candidates) {
    if (isPathLikeCommand(candidate)) return expandHome(candidate);
  }
  return null;
}

function shellEscape(command: string): string {
  return `'${command.replace(/'/g, `'\\''`)}'`;
}

function getLoginShells(): string[] {
  if (process.platform === 'win32') return [];
  return [...new Set([
    process.env.SHELL,
    process.platform === 'darwin' ? '/bin/zsh' : undefined,
    '/bin/bash',
    '/bin/sh',
  ].filter((shell): shell is string => Boolean(shell)))];
}

function execFileText(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf-8', timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
  });
}

function execFileTextSync(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf-8', timeout: 3000 });
  } catch {
    return null;
  }
}

async function lookupCommandPathCurrentEnv(command: string): Promise<string | null> {
  const stdout = await execFileText(process.platform === 'win32' ? 'where' : 'which', [command]);
  return stdout ? parseResolvedPath(stdout) : null;
}

function lookupCommandPathCurrentEnvSync(command: string): string | null {
  const stdout = execFileTextSync(process.platform === 'win32' ? 'where' : 'which', [command]);
  return stdout ? parseResolvedPath(stdout) : null;
}

async function lookupCommandPathLoginShell(command: string): Promise<string | null> {
  for (const shell of getLoginShells()) {
    const stdout = await execFileText(shell, ['-lic', `command -v -- ${shellEscape(command)}`]);
    if (!stdout) continue;
    const resolved = parseResolvedPath(stdout);
    if (resolved) return resolved;
  }
  return null;
}

function lookupCommandPathLoginShellSync(command: string): string | null {
  for (const shell of getLoginShells()) {
    const stdout = execFileTextSync(shell, ['-lic', `command -v -- ${shellEscape(command)}`]);
    if (!stdout) continue;
    const resolved = parseResolvedPath(stdout);
    if (resolved) return resolved;
  }
  return null;
}

export async function resolveCommandPath(command: string | undefined): Promise<string | null> {
  if (!command) return null;
  const direct = resolveDirectCommandPath(command);
  if (direct) return direct;
  const trimmed = command.trim();
  if (!trimmed || isPathLikeCommand(trimmed)) return null;
  return await lookupCommandPathCurrentEnv(trimmed) ?? await lookupCommandPathLoginShell(trimmed);
}

export function resolveCommandPathSync(command: string | undefined): string | null {
  if (!command) return null;
  const direct = resolveDirectCommandPath(command);
  if (direct) return direct;
  const trimmed = command.trim();
  if (!trimmed || isPathLikeCommand(trimmed)) return null;
  return lookupCommandPathCurrentEnvSync(trimmed) ?? lookupCommandPathLoginShellSync(trimmed);
}

async function lookupCommandPaths(commands: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(commands.map((command) => command.trim()).filter(Boolean))];
  const entries = await Promise.all(unique.map(async (command) => [command, await resolveCommandPath(command)] as const));
  return new Map(entries);
}

export async function detectLocalAcpAgents(
  options: LocalAcpDetectionOptions = {},
): Promise<{ installed: InstalledAgent[]; notInstalled: NotInstalledAgent[] }> {
  const agents = getDetectableAgents();

  const plans = agents.map((agent) => {
    const userOverride = findUserOverride(agent.id, options.overrides);
    const resolved = resolveAgentCommand(agent.id, undefined, userOverride);
    const directOverridePath = resolveDirectCommandPath(userOverride?.command);
    const presenceCommands = [...new Set([
      ...(agent.detectCommands ?? [agent.binary]),
      ...(userOverride?.command && !isPathLikeCommand(userOverride.command) ? [userOverride.command] : []),
    ])];
    return { agent, resolved, directOverridePath, presenceCommands };
  });

  const presenceLookup = await lookupCommandPaths(plans.flatMap((plan) => plan.presenceCommands));
  const launchLookup = await lookupCommandPaths(plans.map((plan) => plan.resolved.cmd));

  const installed: InstalledAgent[] = [];
  const notInstalled: NotInstalledAgent[] = [];

  for (const { agent, resolved, directOverridePath, presenceCommands } of plans) {
    const detectedCommandPath = presenceCommands.map((command) => presenceLookup.get(command) ?? null).find(Boolean);
    const presencePath = directOverridePath
      ?? detectedCommandPath
      ?? resolveExistingPresenceDir(agent.presenceDirs);
    const launchPath = directOverridePath
      ?? launchLookup.get(resolved.cmd)
      ?? (presenceCommands.includes(resolved.cmd) ? detectedCommandPath : null)
      ?? null;

    if (presencePath && launchPath) {
      installed.push({
        id: agent.id,
        name: agent.name,
        binaryPath: launchPath,
        resolvedCommand: { cmd: resolved.cmd, args: resolved.args, source: resolved.source },
      });
    } else {
      const packageName = agent.installCmd?.match(/npm install -g (.+)/)?.[1];
      notInstalled.push({
        id: agent.id,
        name: agent.name,
        installCmd: agent.installCmd ?? (packageName ? `npm install -g ${packageName}` : ''),
        packageName,
      });
    }
  }

  return { installed, notInstalled };
}
