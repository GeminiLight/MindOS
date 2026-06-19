import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORS_HEADERS, json, noContent, type MindosServerResponse } from '../response.js';
import type { MindosServerContext } from '../context.js';

export type MindosHealthRuntime = {
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  root?: string;
};

export type MindosHealth = {
  ok: true;
  service: 'mindos';
  version: string;
  authRequired: boolean;
  runtime: MindosHealthRuntime;
};

export type VersionResolutionOptions = {
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  cwd?: string;
};

export type MindosHealthOptions = VersionResolutionOptions & {
  version?: string;
  authRequired?: boolean;
  runtimeRoot?: string;
};

function readPackageVersion(packagePath: string) {
  try {
    if (!existsSync(packagePath)) return undefined;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      name?: string;
      version?: string;
    };
    if (pkg.name === '@geminilight/mindos' && pkg.version) return pkg.version;
  } catch {
    return undefined;
  }
  return undefined;
}

export function readMindosProductVersion(options: VersionResolutionOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.npm_package_version) return env.npm_package_version;

  const candidates = [
    options.projectRoot ? join(options.projectRoot, 'packages', 'mindos', 'package.json') : undefined,
    options.projectRoot ? join(options.projectRoot, 'package.json') : undefined,
    join(options.cwd ?? process.cwd(), 'package.json'),
  ].filter((value): value is string => typeof value === 'string');

  for (const candidate of candidates) {
    const version = readPackageVersion(candidate);
    if (version) return version;
  }

  return '0.0.0';
}

export function createMindosHealth(options: MindosHealthOptions = {}): MindosHealth {
  const env = options.env ?? process.env;
  return {
    ok: true,
    service: 'mindos',
    version: options.version ?? readMindosProductVersion(options),
    authRequired: options.authRequired ?? Boolean(env.WEB_PASSWORD),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      root: options.runtimeRoot,
    },
  };
}

export function handleHealth(context: MindosServerContext = {}): MindosServerResponse<MindosHealth> {
  return json(createMindosHealth({
    projectRoot: context.projectRoot,
    runtimeRoot: context.runtimeRoot ?? context.projectRoot,
    env: context.env,
    authRequired: context.authRequired,
  }), { headers: CORS_HEADERS });
}

export function handleHealthOptions(): MindosServerResponse<undefined> {
  return noContent(CORS_HEADERS);
}
