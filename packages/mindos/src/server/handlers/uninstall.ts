import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';

export type UninstallSpawnOptions = {
  detached: true;
  stdio: ['pipe', 'ignore', 'ignore'];
  env: NodeJS.ProcessEnv;
};

export type UninstallChildProcess = {
  stdin?: {
    write(value: string): void;
    end(): void;
  } | null;
  unref(): void;
};

export type UninstallSpawn = (
  command: string,
  args: string[],
  options: UninstallSpawnOptions,
) => UninstallChildProcess;

export type UninstallPostPayload = {
  removeConfig?: boolean;
};

export type UninstallPostOptions = {
  cliPath?: string;
  nodeBin?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runtimeRoot?: string;
  projectRoot?: string;
  spawn?: UninstallSpawn;
};

export function handleUninstallPost(
  body: UninstallPostPayload | unknown,
  options: UninstallPostOptions = {},
): MindosServerResponse<{ ok: true } | { error: string }> {
  try {
    const removeConfig = resolveRemoveConfig(body);
    const env = cleanUninstallEnv(options.env ?? process.env);
    const spawn = options.spawn ?? nodeSpawn as UninstallSpawn;
    const nodeBin = options.nodeBin ?? env.MINDOS_NODE_BIN ?? process.execPath;
    const cliPath = options.cliPath ?? resolveMindosCliPath({
      env: options.env ?? process.env,
      runtimeRoot: options.runtimeRoot,
      projectRoot: options.projectRoot,
    });

    const child = spawn(nodeBin, [cliPath, 'uninstall'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env,
    });

    child.stdin?.write(buildUninstallAnswers(removeConfig));
    child.stdin?.end();
    child.unref();

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function resolveRemoveConfig(body: UninstallPostPayload | unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  return (body as UninstallPostPayload).removeConfig !== false;
}

function buildUninstallAnswers(removeConfig: boolean): string {
  // Proceed with uninstall, optionally remove config, never remove knowledge base.
  return `Y\n${removeConfig ? 'Y' : 'N'}\nN\n`;
}

function cleanUninstallEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith('MINDOS_') || key.startsWith('MIND_')) delete cleaned[key];
  }
  delete cleaned.AUTH_TOKEN;
  delete cleaned.WEB_PASSWORD;
  delete cleaned.NODE_OPTIONS;
  return cleaned;
}

function resolveMindosCliPath(options: { env: NodeJS.ProcessEnv | Record<string, string | undefined>; runtimeRoot?: string; projectRoot?: string }): string {
  if (options.env.MINDOS_CLI_PATH) return options.env.MINDOS_CLI_PATH;

  const roots = [
    options.projectRoot,
    options.env.MINDOS_PROJECT_ROOT,
    options.runtimeRoot,
    findWorkspaceRoot(process.cwd()),
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const root of roots) {
    const repoCli = resolve(root, 'packages', 'mindos', 'bin', 'cli.js');
    if (existsSync(repoCli)) return repoCli;
    const packageCli = resolve(root, 'bin', 'cli.js');
    if (existsSync(packageCli)) return packageCli;
  }

  return process.argv[1] ? resolve(process.argv[1]) : 'mindos';
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(resolve(current, 'pnpm-workspace.yaml')) ||
      existsSync(resolve(current, 'packages', 'mindos', 'package.json'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}
