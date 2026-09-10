import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentConfigProbes, AgentDirent, AgentFileStat } from './types.js';

/** Every probe resolved to a callable, plus whether they are all the real `node:fs` defaults. */
export type ResolvedAgentConfigProbes = {
  homeDir: string;
  projectRoot?: string;
  pathExists(path: string): boolean;
  readTextFile(path: string): string;
  readDir(path: string): AgentDirent[];
  stat(path: string): AgentFileStat;
  commandExists(command: string): boolean;
  /**
   * True when no filesystem or process probe was injected. The process-wide
   * presence and config-read caches are only correct against the real
   * filesystem, so they switch off as soon as a host or test injects one.
   */
  usesRealFs: boolean;
};

export function defaultCommandExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function resolveAgentConfigProbes(probes: AgentConfigProbes = {}): ResolvedAgentConfigProbes {
  const usesRealFs = !probes.pathExists && !probes.readTextFile && !probes.readDir && !probes.stat && !probes.commandExists;
  return {
    homeDir: probes.homeDir ?? homedir(),
    projectRoot: probes.projectRoot,
    pathExists: probes.pathExists ?? existsSync,
    readTextFile: probes.readTextFile ?? ((path) => readFileSync(path, 'utf-8')),
    readDir: probes.readDir ?? ((path) => readdirSync(path, { withFileTypes: true })),
    stat: probes.stat ?? statSync,
    commandExists: probes.commandExists ?? defaultCommandExists,
    usesRealFs,
  };
}
