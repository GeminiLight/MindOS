import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CODEX_ENV_SHELL_TIMEOUT_MS = 3000;
const CODEX_ENV_VALUE_START = '__MINDOS_CODEX_ENV_VALUE_START__';
const CODEX_ENV_VALUE_END = '__MINDOS_CODEX_ENV_VALUE_END__';

export type CodexEnvMap = Record<string, string | undefined>;

export type CodexShellEnvValueReader = (
  key: string,
  env: CodexEnvMap,
) => string | undefined;

type EnvExecFileSync = (
  command: string,
  args: string[],
  options: {
    encoding: 'utf8';
    env: NodeJS.ProcessEnv;
    stdio: ['ignore', 'pipe', 'ignore'];
    timeout: number;
    windowsHide?: boolean;
  },
) => string;

export type CodexProviderEnvironmentResolution = {
  envKey?: string;
  value?: string;
  source: 'none' | 'process' | 'login-shell';
};

export function buildCodexAppServerEnv(input: {
  baseEnv?: CodexEnvMap;
  overrideEnv?: CodexEnvMap;
  configText?: string;
  configPath?: string;
  readShellEnvValue?: CodexShellEnvValueReader;
} = {}): NodeJS.ProcessEnv {
  const env: CodexEnvMap = {
    ...(input.baseEnv ?? process.env),
    ...(input.overrideEnv ?? {}),
  };
  const resolution = resolveCodexProviderEnvironment({
    env,
    configText: input.configText,
    configPath: input.configPath,
    readShellEnvValue: input.readShellEnvValue,
  });
  if (resolution.envKey && resolution.value && !env[resolution.envKey]) {
    env[resolution.envKey] = resolution.value;
  }
  return env as NodeJS.ProcessEnv;
}

export function resolveCodexProviderEnvironment(input: {
  env?: CodexEnvMap;
  configText?: string;
  configPath?: string;
  readShellEnvValue?: CodexShellEnvValueReader;
} = {}): CodexProviderEnvironmentResolution {
  const env = input.env ?? process.env;
  const configText = input.configText ?? readCodexConfigText(input.configPath, env);
  const envKey = configText ? extractCodexProviderEnvKey(configText) : undefined;
  if (!envKey) return { source: 'none' };

  const value = env[envKey];
  if (value) return { envKey, value, source: 'process' };

  const shellValue = (input.readShellEnvValue ?? readLoginShellEnvValue)(envKey, env);
  if (shellValue) return { envKey, value: shellValue, source: 'login-shell' };

  return { envKey, source: 'none' };
}

export function readCodexConfigText(configPath: string | undefined, env: CodexEnvMap = process.env): string | undefined {
  const resolvedPath = configPath ?? join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
  try {
    if (!existsSync(resolvedPath)) return undefined;
    return readFileSync(resolvedPath, 'utf8');
  } catch {
    return undefined;
  }
}

export function extractCodexProviderEnvKey(configText: string): string | undefined {
  const provider = extractTomlStringValue(configText, 'model_provider');
  if (!provider) return undefined;
  const providerSection = extractTomlSection(configText, `model_providers.${provider}`);
  if (!providerSection) return undefined;
  return extractTomlStringValue(providerSection, 'env_key');
}

// Login-shell probes are synchronous and can stack up to several seconds per
// shell candidate, blocking the event loop on every runtime spawn. Persistent
// shell environments do not change within a process lifetime, so both hits
// and misses are cached.
const loginShellEnvValueCache = new Map<string, string | undefined>();

export function clearLoginShellEnvValueCache(): void {
  loginShellEnvValueCache.clear();
}

export function readLoginShellEnvValue(
  key: string,
  env: CodexEnvMap = process.env,
  read: (key: string, env: CodexEnvMap) => string | undefined = (k, e) => readPlatformEnvironmentValue({ key: k, env: e }),
): string | undefined {
  if (loginShellEnvValueCache.has(key)) return loginShellEnvValueCache.get(key);
  const value = read(key, env);
  loginShellEnvValueCache.set(key, value);
  return value;
}

export function readPlatformEnvironmentValue(input: {
  key: string;
  env?: CodexEnvMap;
  platform?: NodeJS.Platform;
  execFile?: EnvExecFileSync;
}): string | undefined {
  const key = input.key;
  if (!isSafeEnvKey(key)) return undefined;
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const execFile = input.execFile ?? (execFileSync as EnvExecFileSync);

  if (platform === 'win32') {
    return readWindowsPersistentEnvValue(key, env, execFile);
  }

  if (platform === 'darwin') {
    const launchdValue = readDarwinLaunchdEnvValue(key, env, execFile);
    if (launchdValue) return launchdValue;
  }

  return readPosixLoginShellEnvValue(key, env, platform, execFile);
}

function readPosixLoginShellEnvValue(
  key: string,
  env: CodexEnvMap,
  platform: NodeJS.Platform,
  execFile: EnvExecFileSync,
): string | undefined {
  const command = `printf '${CODEX_ENV_VALUE_START}'; if [ -n "\${${key}+x}" ]; then printf '%s' "$${key}"; fi; printf '${CODEX_ENV_VALUE_END}'`;
  for (const shell of getLoginShells(env, platform)) {
    for (const args of getLoginShellArgs(command)) {
      try {
        const output = execFile(shell, args, {
          encoding: 'utf8',
          env: env as NodeJS.ProcessEnv,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: CODEX_ENV_SHELL_TIMEOUT_MS,
        });
        const value = extractLoginShellEnvValue(output);
        if (value) return value;
      } catch {
        // Try the next shell invocation candidate.
      }
    }
  }
  return undefined;
}

export function extractLoginShellEnvValue(output: string): string | undefined {
  const start = output.indexOf(CODEX_ENV_VALUE_START);
  if (start < 0) return undefined;
  const valueStart = start + CODEX_ENV_VALUE_START.length;
  const end = output.indexOf(CODEX_ENV_VALUE_END, valueStart);
  if (end < 0) return undefined;
  return output.slice(valueStart, end);
}

export function extractWindowsRegistryEnvValue(output: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`^${escapedKey}\\s+REG_\\w+\\s+(.+)$`, 'i');
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(pattern);
    const value = match?.[1];
    if (value) return value;
  }
  return undefined;
}

function readDarwinLaunchdEnvValue(
  key: string,
  env: CodexEnvMap,
  execFile: EnvExecFileSync,
): string | undefined {
  try {
    const output = execFile('launchctl', ['getenv', key], {
      encoding: 'utf8',
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: CODEX_ENV_SHELL_TIMEOUT_MS,
    });
    const value = stripOneTrailingNewline(output);
    return value || undefined;
  } catch {
    return undefined;
  }
}

function readWindowsPersistentEnvValue(
  key: string,
  env: CodexEnvMap,
  execFile: EnvExecFileSync,
): string | undefined {
  const powershellValue = readWindowsPowerShellEnvValue(key, env, execFile);
  if (powershellValue) return powershellValue;
  return readWindowsRegistryEnvValue(key, env, execFile);
}

function readWindowsPowerShellEnvValue(
  key: string,
  env: CodexEnvMap,
  execFile: EnvExecFileSync,
): string | undefined {
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$name = ${quotePowerShellString(key)}`,
    `foreach ($target in @("User", "Machine")) {`,
    '  $value = [Environment]::GetEnvironmentVariable($name, $target)',
    '  if ($null -ne $value -and $value.Length -gt 0) {',
    `    [Console]::Write(${quotePowerShellString(CODEX_ENV_VALUE_START)})`,
    '    [Console]::Write($value)',
    `    [Console]::Write(${quotePowerShellString(CODEX_ENV_VALUE_END)})`,
    '    exit 0',
    '  }',
    '}',
    `[Console]::Write(${quotePowerShellString(CODEX_ENV_VALUE_START)})`,
    `[Console]::Write(${quotePowerShellString(CODEX_ENV_VALUE_END)})`,
  ].join('; ');

  for (const command of getWindowsPowerShellCommands(env)) {
    try {
      const output = execFile(command, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ], {
        encoding: 'utf8',
        env: env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: CODEX_ENV_SHELL_TIMEOUT_MS,
        windowsHide: true,
      });
      const value = extractLoginShellEnvValue(output);
      if (value) return value;
      if (value === '') break;
    } catch {
      // Try the next PowerShell executable candidate.
    }
  }
  return undefined;
}

function readWindowsRegistryEnvValue(
  key: string,
  env: CodexEnvMap,
  execFile: EnvExecFileSync,
): string | undefined {
  const roots = [
    'HKCU\\Environment',
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  ];
  for (const root of roots) {
    try {
      const output = execFile('reg.exe', ['query', root, '/v', key], {
        encoding: 'utf8',
        env: env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: CODEX_ENV_SHELL_TIMEOUT_MS,
        windowsHide: true,
      });
      const value = extractWindowsRegistryEnvValue(output, key);
      if (value) return value;
    } catch {
      // Try the next registry scope.
    }
  }
  return undefined;
}

function isSafeEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    && key !== '__proto__'
    && key !== 'constructor'
    && key !== 'prototype';
}

function getLoginShells(env: CodexEnvMap, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return [];
  return [...new Set([
    env.SHELL,
    platform === 'darwin' ? '/bin/zsh' : undefined,
    '/bin/bash',
    '/bin/sh',
  ].filter((shell): shell is string => Boolean(shell)))];
}

function getLoginShellArgs(command: string): string[][] {
  return [
    ['-lc', command],
    ['-lic', command],
  ];
}

function getWindowsPowerShellCommands(env: CodexEnvMap): string[] {
  const systemRoot = trimWindowsPath(env.SystemRoot ?? env.WINDIR);
  return [...new Set([
    systemRoot ? `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : undefined,
    'powershell.exe',
    'pwsh.exe',
    'pwsh',
  ].filter((command): command is string => Boolean(command)))];
}

function trimWindowsPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/[\\/]+$/, '') : undefined;
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function stripOneTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}

function extractTomlStringValue(text: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const match = text.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]*)"\\s*$`, 'm'));
  return match?.[1]?.trim() || undefined;
}

function extractTomlSection(text: string, sectionName: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const targetHeader = `[${sectionName}]`;
  const sectionLines: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (inSection) break;
      inSection = trimmed === targetHeader;
      continue;
    }
    if (inSection) sectionLines.push(line);
  }
  return inSection ? sectionLines.join('\n') : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
