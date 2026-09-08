import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { findUserOverride, getDetectableAgents, resolveAgentCommand } from './agent-descriptors.js';
import type { AcpAgentAdapterMetadata, AcpAgentOverride } from './agent-descriptors.js';

export interface InstalledAgent {
  id: string;
  name: string;
  binaryPath: string;
  resolvedCommand: {
    cmd: string;
    args: string[];
    source: 'user-override' | 'descriptor' | 'registry';
  };
  adapterMetadata?: AcpAgentAdapterMetadata;
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
  let homeExpanded = filePath;
  if (filePath === '~') {
    homeExpanded = os.homedir();
  } else if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    homeExpanded = path.resolve(os.homedir(), filePath.slice(2));
  }
  return homeExpanded.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name: string) => process.env[name] ?? match);
}

export function isPathLikeCommand(command: string): boolean {
  return command.startsWith('~/') || command.startsWith('~\\') || command.startsWith('/') || command.startsWith('./') || command.startsWith('../') || command.includes('\\') || /^[A-Za-z]:[\\/]/.test(command);
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

function parseResolvedPaths(stdout: string): string[] {
  const resolved: string[] = [];
  const add = (candidate: string) => {
    const expanded = expandHome(candidate);
    if (!isPathLikeCommand(expanded)) return;
    if (!resolved.includes(expanded)) resolved.push(expanded);
  };
  for (const line of stdout.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate) add(candidate);
  }
  return resolved;
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim().replace(/^"|"$/g, '');
    if (!trimmed) continue;
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function isExistingDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function envPathValue(env: NodeJS.ProcessEnv = process.env): string {
  return env.PATH ?? env.Path ?? env.path ?? '';
}

function splitEnvPath(value: string): string[] {
  return value.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function pathFromHome(...segments: string[]): string | null {
  try {
    const home = os.homedir();
    return home ? path.join(home, ...segments) : null;
  } catch {
    return null;
  }
}

function collectChildBinDirs(parentDir: string | null): string[] {
  if (!parentDir || !isExistingDirectory(parentDir)) return [];
  try {
    return fs.readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parentDir, entry.name, 'bin'))
      .filter(isExistingDirectory)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function supplementalPathEntries(env: NodeJS.ProcessEnv = process.env): string[] {
  const entries = [
    pathFromHome('.local', 'bin'),
    pathFromHome('bin'),
    pathFromHome('.npm-global', 'bin'),
    pathFromHome('.cargo', 'bin'),
    pathFromHome('.bun', 'bin'),
    pathFromHome('.deno', 'bin'),
    pathFromHome('.volta', 'bin'),
    pathFromHome('.asdf', 'shims'),
    pathFromHome('.nodenv', 'shims'),
    pathFromHome('.pyenv', 'shims'),
    pathFromHome('.local', 'share', 'pnpm'),
    pathFromHome('Library', 'pnpm'),
    pathFromHome('.codex', 'bin'),
    pathFromHome('.claude', 'bin'),
    pathFromHome('.claude', 'local'),
    pathFromHome('.gemini', 'bin'),
    pathFromHome('.qwen', 'bin'),
    pathFromHome('.kimi-code', 'bin'),
    ...collectChildBinDirs(pathFromHome('.nvm', 'versions', 'node')),
  ].filter((entry): entry is string => Boolean(entry));

  if (process.platform === 'win32') {
    const userProfile = env.USERPROFILE ?? env.HOME;
    const appData = env.APPDATA ?? (userProfile ? path.win32.join(userProfile, 'AppData', 'Roaming') : undefined);
    const localAppData = env.LOCALAPPDATA ?? (userProfile ? path.win32.join(userProfile, 'AppData', 'Local') : undefined);
    entries.push(
      ...(appData ? [path.win32.join(appData, 'npm')] : []),
      ...(localAppData ? [path.win32.join(localAppData, 'pnpm')] : []),
      ...(userProfile ? [
        path.win32.join(userProfile, 'scoop', 'shims'),
        path.win32.join(userProfile, '.cargo', 'bin'),
        path.win32.join(userProfile, '.bun', 'bin'),
        path.win32.join(userProfile, '.deno', 'bin'),
        path.win32.join(userProfile, '.volta', 'bin'),
      ] : []),
    );
  } else {
    entries.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin');
  }

  return dedupePathEntries(entries).filter(isExistingDirectory);
}

function commandSearchPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return dedupePathEntries([
    ...splitEnvPath(envPathValue(env)),
    ...supplementalPathEntries(env),
  ]);
}

function commandFileNames(command: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform !== 'win32') return [command];
  if (path.win32.extname(command)) return [command];
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return dedupePathEntries([command, ...extensions.map((extension) => `${command}${extension}`)]);
}

function lookupCommandPathFromSearchPaths(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return lookupCommandPathCandidatesFromSearchPaths(command, env)[0] ?? null;
}

function lookupCommandPathCandidatesFromSearchPaths(command: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  for (const dir of commandSearchPaths(env)) {
    for (const fileName of commandFileNames(command, env)) {
      const candidate = path.join(dir, fileName);
      if (!isExecutableFile(candidate)) continue;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
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

async function lookupCommandPathCandidatesCurrentEnv(command: string): Promise<string[]> {
  const stdout = await execFileText(process.platform === 'win32' ? 'where' : 'which', process.platform === 'win32' ? [command] : ['-a', command]);
  return stdout ? parseResolvedPaths(stdout) : [];
}

function lookupCommandPathCurrentEnvSync(command: string): string | null {
  const stdout = execFileTextSync(process.platform === 'win32' ? 'where' : 'which', [command]);
  return stdout ? parseResolvedPath(stdout) : null;
}

/**
 * Login shells (`zsh -lic` etc.) are by far the most expensive lookup here: each
 * spawn sources the user's rc files and costs 1-3s of wall clock, and the sync
 * variant blocks the event loop for that long. They are therefore the last
 * resort after the current PATH and the well-known install directories, and
 * their results (including misses) are memoised for a short window so that
 * readiness polling and agent spawns do not re-pay that cost on every call.
 */
const LOGIN_SHELL_LOOKUP_TTL_MS = 60_000;
const LOGIN_SHELL_MAX_CONCURRENCY = 4;

type LoginShellLookupMode = 'first' | 'all';

interface LoginShellLookupEntry {
  expiresAt: number;
  promise: Promise<string[]>;
  value?: string[];
}

const loginShellLookupCache = new Map<string, LoginShellLookupEntry>();
let loginShellActiveCount = 0;
const loginShellWaiters: Array<() => void> = [];

/** Test hook: forget memoised login-shell lookups. */
export function resetCommandPathLookupCache(): void {
  loginShellLookupCache.clear();
}

function loginShellLookupKey(mode: LoginShellLookupMode, command: string): string {
  return `${mode}\0${command}`;
}

function readLoginShellLookupCache(key: string): LoginShellLookupEntry | null {
  const entry = loginShellLookupCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    loginShellLookupCache.delete(key);
    return null;
  }
  return entry;
}

function writeLoginShellLookupCache(key: string, promise: Promise<string[]>, value?: string[]): LoginShellLookupEntry {
  const entry: LoginShellLookupEntry = {
    expiresAt: Date.now() + LOGIN_SHELL_LOOKUP_TTL_MS,
    promise,
    ...(value ? { value } : {}),
  };
  loginShellLookupCache.set(key, entry);
  void promise.then(
    (resolved) => {
      entry.value = resolved;
      entry.expiresAt = Date.now() + LOGIN_SHELL_LOOKUP_TTL_MS;
    },
    () => {
      if (loginShellLookupCache.get(key) === entry) loginShellLookupCache.delete(key);
    },
  );
  return entry;
}

async function withLoginShellSlot<T>(task: () => Promise<T>): Promise<T> {
  if (loginShellActiveCount < LOGIN_SHELL_MAX_CONCURRENCY) {
    loginShellActiveCount += 1;
  } else {
    // The releasing task hands its slot over directly, so the count stays put.
    await new Promise<void>((resolve) => loginShellWaiters.push(resolve));
  }
  try {
    return await task();
  } finally {
    const next = loginShellWaiters.shift();
    if (next) next();
    else loginShellActiveCount -= 1;
  }
}

async function runLoginShellLookup(mode: LoginShellLookupMode, command: string): Promise<string[]> {
  const results: string[] = [];
  for (const shell of getLoginShells()) {
    const script = mode === 'first'
      ? `command -v -- ${shellEscape(command)}`
      : `which -a ${shellEscape(command)}`;
    const stdout = await execFileText(shell, ['-lic', script]);
    if (!stdout) continue;
    if (mode === 'first') {
      const resolved = parseResolvedPath(stdout);
      if (resolved) return [resolved];
      continue;
    }
    for (const candidate of parseResolvedPaths(stdout)) {
      if (!results.includes(candidate)) results.push(candidate);
    }
  }
  return results;
}

function lookupLoginShell(mode: LoginShellLookupMode, command: string): Promise<string[]> {
  const key = loginShellLookupKey(mode, command);
  const cached = readLoginShellLookupCache(key);
  if (cached) return cached.promise;
  const promise = withLoginShellSlot(() => runLoginShellLookup(mode, command));
  return writeLoginShellLookupCache(key, promise).promise;
}

async function lookupCommandPathLoginShell(command: string): Promise<string | null> {
  return (await lookupLoginShell('first', command))[0] ?? null;
}

async function lookupCommandPathCandidatesLoginShell(command: string): Promise<string[]> {
  return lookupLoginShell('all', command);
}

function lookupCommandPathLoginShellSync(command: string): string | null {
  const settled = readLoginShellLookupCache(loginShellLookupKey('first', command))?.value
    ?? readLoginShellLookupCache(loginShellLookupKey('all', command))?.value;
  if (settled) return settled[0] ?? null;

  let resolved: string | null = null;
  for (const shell of getLoginShells()) {
    const stdout = execFileTextSync(shell, ['-lic', `command -v -- ${shellEscape(command)}`]);
    if (!stdout) continue;
    resolved = parseResolvedPath(stdout);
    if (resolved) break;
  }
  const value = resolved ? [resolved] : [];
  writeLoginShellLookupCache(loginShellLookupKey('first', command), Promise.resolve(value), value);
  return resolved;
}

export async function resolveCommandPath(command: string | undefined): Promise<string | null> {
  if (!command) return null;
  const direct = resolveDirectCommandPath(command);
  if (direct) return direct;
  const trimmed = command.trim();
  if (!trimmed || isPathLikeCommand(trimmed)) return null;
  return await lookupCommandPathCurrentEnv(trimmed)
    ?? lookupCommandPathFromSearchPaths(trimmed)
    ?? await lookupCommandPathLoginShell(trimmed);
}

export async function resolveCommandPathCandidates(command: string | undefined): Promise<string[]> {
  if (!command) return [];
  const direct = resolveDirectCommandPath(command);
  if (direct) return [direct];
  const trimmed = command.trim();
  if (!trimmed || isPathLikeCommand(trimmed)) return [];

  const candidates: string[] = [];
  const add = (candidate: string) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  for (const candidate of await lookupCommandPathCandidatesCurrentEnv(trimmed)) add(candidate);
  for (const candidate of lookupCommandPathCandidatesFromSearchPaths(trimmed)) add(candidate);
  // Only pay for login shells when nothing cheaper found the command at all.
  if (candidates.length === 0) {
    for (const candidate of await lookupCommandPathCandidatesLoginShell(trimmed)) add(candidate);
  }
  return candidates;
}

export function resolveCommandPathSync(command: string | undefined): string | null {
  if (!command) return null;
  const direct = resolveDirectCommandPath(command);
  if (direct) return direct;
  const trimmed = command.trim();
  if (!trimmed || isPathLikeCommand(trimmed)) return null;
  return lookupCommandPathCurrentEnvSync(trimmed)
    ?? lookupCommandPathFromSearchPaths(trimmed)
    ?? lookupCommandPathLoginShellSync(trimmed);
}

/**
 * One login shell per shell binary for a whole batch of commands. Detection
 * probes ~17 commands at once, most of which are not installed; resolving them
 * one by one used to spawn up to three login shells per command.
 */
async function runLoginShellBatchLookup(commands: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let remaining = [...commands];
  for (const shell of getLoginShells()) {
    if (remaining.length === 0) break;
    const script = remaining
      .map((command) => `p=$(command -v -- ${shellEscape(command)} 2>/dev/null) && printf '%s\\t%s\\n' ${shellEscape(command)} "$p"`)
      .join('; ');
    const stdout = await execFileText(shell, ['-lic', script]);
    if (!stdout) continue;
    for (const line of stdout.split(/\r?\n/)) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const command = line.slice(0, tab);
      if (found.has(command) || !remaining.includes(command)) continue;
      const resolved = parseResolvedPath(line.slice(tab + 1));
      if (resolved) found.set(command, resolved);
    }
    remaining = remaining.filter((command) => !found.has(command));
  }
  return found;
}

function lookupLoginShellBatch(commands: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const waits: Promise<void>[] = [];
  const fresh: string[] = [];
  for (const command of commands) {
    const cached = readLoginShellLookupCache(loginShellLookupKey('first', command));
    if (cached) {
      waits.push(cached.promise.then((value) => { results.set(command, value[0] ?? null); }));
      continue;
    }
    fresh.push(command);
  }
  if (fresh.length > 0) {
    const batch = withLoginShellSlot(() => runLoginShellBatchLookup(fresh));
    for (const command of fresh) {
      const promise = batch.then((found) => {
        const resolved = found.get(command);
        return resolved ? [resolved] : [];
      });
      writeLoginShellLookupCache(loginShellLookupKey('first', command), promise);
      waits.push(promise.then((value) => { results.set(command, value[0] ?? null); }));
    }
  }
  return Promise.all(waits).then(() => results);
}

async function lookupCommandPaths(commands: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(commands.map((command) => command.trim()).filter(Boolean))];
  const results = new Map<string, string | null>();
  const needLoginShell: string[] = [];

  await Promise.all(unique.map(async (command) => {
    const direct = resolveDirectCommandPath(command);
    if (direct) {
      results.set(command, direct);
      return;
    }
    if (isPathLikeCommand(command)) {
      results.set(command, null);
      return;
    }
    const cheap = await lookupCommandPathCurrentEnv(command) ?? lookupCommandPathFromSearchPaths(command);
    if (cheap) {
      results.set(command, cheap);
      return;
    }
    const settled = readLoginShellLookupCache(loginShellLookupKey('first', command))?.value
      ?? readLoginShellLookupCache(loginShellLookupKey('all', command))?.value;
    if (settled) {
      results.set(command, settled[0] ?? null);
      return;
    }
    needLoginShell.push(command);
  }));

  if (needLoginShell.length > 0) {
    const batch = await lookupLoginShellBatch(needLoginShell);
    for (const command of needLoginShell) results.set(command, batch.get(command) ?? null);
  }
  return results;
}

export async function detectLocalAcpAgents(
  options: LocalAcpDetectionOptions = {},
): Promise<{ installed: InstalledAgent[]; notInstalled: NotInstalledAgent[] }> {
  const agents = getDetectableAgents(options.overrides);

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

  const commandLookup = await lookupCommandPaths([
    ...plans.flatMap((plan) => plan.presenceCommands),
    ...plans.map((plan) => plan.resolved.cmd),
  ]);

  const installed: InstalledAgent[] = [];
  const notInstalled: NotInstalledAgent[] = [];

  for (const { agent, resolved, directOverridePath, presenceCommands } of plans) {
    if (!resolved.enabled) continue;

    const detectedCommandPath = presenceCommands.map((command) => commandLookup.get(command) ?? null).find(Boolean);
    const presencePath = directOverridePath
      ?? detectedCommandPath
      ?? resolveExistingPresenceDir(agent.presenceDirs);
    const launchPath = directOverridePath
      ?? commandLookup.get(resolved.cmd)
      ?? (presenceCommands.includes(resolved.cmd) ? detectedCommandPath : null)
      ?? null;

    if (presencePath && launchPath) {
      installed.push({
        id: agent.id,
        name: agent.name,
        binaryPath: launchPath,
        resolvedCommand: { cmd: resolved.cmd, args: resolved.args, source: resolved.source },
        ...(agent.adapterMetadata ? { adapterMetadata: agent.adapterMetadata } : {}),
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
