import {
  readLoginShellEnvValue,
  type CodexEnvMap,
  type CodexShellEnvValueReader,
} from './codex-env.js';

export type AgentRuntimeEnvironmentSettings = {
  keys?: string[];
};

export type AgentRuntimeEnvResolution = {
  env: NodeJS.ProcessEnv;
  overlay: Record<string, string>;
  keys: string[];
  injectedKeys: string[];
  missingKeys: string[];
};

export function parseAgentRuntimeEnvironmentSettings(raw: unknown): AgentRuntimeEnvironmentSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const keys = normalizeAgentRuntimeEnvKeys(source.keys);
  return keys.length > 0 ? { keys } : undefined;
}

export function normalizeAgentRuntimeEnvKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(isSafeEnvKey))];
}

export function resolveAgentRuntimeEnvOverlay(input: {
  baseEnv?: CodexEnvMap;
  overrideEnv?: CodexEnvMap;
  settings?: AgentRuntimeEnvironmentSettings;
  keys?: string[];
  readShellEnvValue?: CodexShellEnvValueReader;
} = {}): Omit<AgentRuntimeEnvResolution, 'env'> {
  const baseEnv: CodexEnvMap = {
    ...(input.baseEnv ?? process.env),
    ...(input.overrideEnv ?? {}),
  };
  const keys = normalizeAgentRuntimeEnvKeys(input.keys ?? input.settings?.keys ?? []);
  const readShellEnvValue = input.readShellEnvValue ?? readLoginShellEnvValue;
  const overlay: Record<string, string> = {};
  const injectedKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const key of keys) {
    if (baseEnv[key]) continue;
    const value = readShellEnvValue(key, baseEnv);
    if (value) {
      overlay[key] = value;
      injectedKeys.push(key);
    } else {
      missingKeys.push(key);
    }
  }

  return { overlay, keys, injectedKeys, missingKeys };
}

export function buildAgentRuntimeEnv(input: {
  baseEnv?: CodexEnvMap;
  overrideEnv?: CodexEnvMap;
  settings?: AgentRuntimeEnvironmentSettings;
  keys?: string[];
  readShellEnvValue?: CodexShellEnvValueReader;
} = {}): AgentRuntimeEnvResolution {
  const env: CodexEnvMap = {
    ...(input.baseEnv ?? process.env),
    ...(input.overrideEnv ?? {}),
  };
  const resolution = resolveAgentRuntimeEnvOverlay({
    baseEnv: env,
    settings: input.settings,
    keys: input.keys,
    readShellEnvValue: input.readShellEnvValue,
  });

  return {
    ...resolution,
    env: {
      ...env,
      ...resolution.overlay,
    } as NodeJS.ProcessEnv,
  };
}

function isSafeEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    && key !== '__proto__'
    && key !== 'constructor'
    && key !== 'prototype';
}
