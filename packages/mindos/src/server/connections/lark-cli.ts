import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { redactSensitiveText } from '../../agent/redaction.js';
import type {
  ConnectionCandidate,
  ConnectionIdentity,
  ConnectionIssue,
  LarkCliRunner,
  LarkCliRunResult,
} from './types.js';

const CLI_TIMEOUT_MS = 10_000;
const CLI_MAX_BUFFER = 1024 * 1024;
const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export interface FindLarkCliExecutableOptions {
  homeDir?: string;
  pathValue?: string;
}

export interface DiscoverLarkCliConnectionsOptions extends FindLarkCliExecutableOptions {
  executablePath?: string;
  run?: LarkCliRunner;
  now?: Date;
}

export function findLarkCliExecutable(options: FindLarkCliExecutableOptions = {}): string | null {
  const home = options.homeDir ?? homedir();
  const candidates = new Set<string>();
  for (const directory of (options.pathValue ?? process.env.PATH ?? '').split(path.delimiter)) {
    if (directory.trim()) candidates.add(path.join(directory, 'lark-cli'));
  }
  candidates.add(path.join(home, '.local', 'bin', 'lark-cli'));
  candidates.add(path.join(home, '.npm-global', 'bin', 'lark-cli'));
  candidates.add(path.join(home, 'Library', 'pnpm', 'lark-cli'));

  const localNodeRoot = path.join(home, '.local');
  if (existsSync(localNodeRoot)) {
    for (const entry of readdirSync(localNodeRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^node-v[\w.-]+$/.test(entry.name)) {
        candidates.add(path.join(localNodeRoot, entry.name, 'bin', 'lark-cli'));
      }
    }
  }

  for (const candidate of candidates) {
    try {
      return resolveSafeLarkCliExecutable(candidate);
    } catch {
      // Keep looking through known installation locations.
    }
  }
  return null;
}

export function resolveSafeLarkCliExecutable(executablePath: string): string {
  if (!path.isAbsolute(executablePath)) throw new Error('lark-cli executable path must be absolute.');
  accessSync(executablePath, constants.X_OK);
  const resolved = realpathSync(executablePath);
  const executable = statSync(resolved);
  if (!executable.isFile()) throw new Error('lark-cli executable must resolve to a regular file.');
  if (process.platform !== 'win32') {
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if ((executable.mode & 0o022) !== 0) {
      throw new Error('lark-cli executable is group or world writable and cannot be trusted.');
    }
    if (currentUid !== undefined && executable.uid !== currentUid && executable.uid !== 0) {
      throw new Error('lark-cli executable is owned by an unexpected local account.');
    }
  }
  return resolved;
}

export async function discoverLarkCliConnections(
  options: DiscoverLarkCliConnectionsOptions = {},
): Promise<ConnectionCandidate[]> {
  const executablePath = options.executablePath ?? findLarkCliExecutable(options);
  if (!executablePath) return [];
  const run = options.run ?? runLarkCli;
  const configResult = await run(executablePath, ['config', 'show']);
  const configPayload = parseEmbeddedJson(configResult.stdout);
  if (configResult.exitCode !== 0 || !isRecord(configPayload)) {
    return [unavailableCandidate({
      executablePath,
      issue: parseLarkCliFailure(configPayload, configResult.stderr || 'Unable to read the lark-cli profile.'),
      now: options.now,
    })];
  }

  const profile = stringField(configPayload, 'profile');
  const appId = stringField(configPayload, 'appId');
  const brand = stringField(configPayload, 'brand') === 'lark' ? 'lark' : 'feishu';
  if (!profile || !SAFE_PROFILE.test(profile) || !appId) {
    return [unavailableCandidate({
      executablePath,
      profile: profile || undefined,
      appId: appId || undefined,
      issue: { code: 'invalid_output', message: 'lark-cli config is missing a safe profile or App ID.' },
      now: options.now,
    })];
  }

  const authResult = await run(executablePath, [
    '--profile', profile, 'auth', 'status', '--json', '--verify',
  ]);
  const authPayload = parseEmbeddedJson(authResult.stdout);
  const now = validNow(options.now);
  if (authResult.exitCode !== 0 || !isRecord(authPayload)) {
    return [unavailableCandidate({
      executablePath,
      profile,
      appId,
      brand,
      issue: parseLarkCliFailure(authPayload, authResult.stderr || 'Unable to verify lark-cli identities.'),
      now,
    })];
  }

  const identitiesRecord = recordField(authPayload, 'identities');
  const bot = normalizeIdentity(recordField(identitiesRecord, 'bot'));
  const user = normalizeIdentity(recordField(identitiesRecord, 'user'));
  const botReady = bot.status === 'ready' && bot.available && bot.verified;
  const issues: ConnectionIssue[] = [];
  if (!botReady) {
    issues.push({
      code: 'bot_auth_missing',
      message: bot.message ?? 'The lark-cli bot identity is not ready.',
      ...(bot.hint ? { hint: bot.hint } : {}),
    });
  }
  if (!user.available) {
    issues.push({
      code: 'user_auth_missing',
      message: user.message ?? 'The optional lark-cli user identity is not connected.',
      ...(user.hint ? { hint: user.hint } : {}),
    });
  }

  const appName = bot.displayName ?? stringField(recordField(identitiesRecord, 'bot'), 'appName');
  return [{
    schemaVersion: 1,
    id: `lark-cli:${profile}`,
    provider: 'feishu',
    adapter: 'lark-cli',
    status: botReady ? 'ready' : user.available ? 'degraded' : 'unavailable',
    credentialRef: { kind: 'lark-cli-profile', executablePath: path.resolve(executablePath), profile },
    application: { appId, ...(appName ? { appName } : {}), brand },
    owner: {
      identity: 'bot',
      source: 'lark-cli-profile',
      ...(bot.externalId ? { externalId: bot.externalId } : {}),
      ...(bot.displayName ? { displayName: bot.displayName } : {}),
    },
    identities: { bot, user },
    capabilities: [
      {
        id: 'message.send',
        identity: 'bot',
        status: botReady ? 'available' : 'blocked',
        ...(!botReady ? { reason: 'A verified bot identity is required.' } : {}),
      },
      {
        id: 'event.consume',
        identity: 'bot',
        status: botReady ? 'available' : 'blocked',
        ...(!botReady ? { reason: 'A verified bot identity is required.' } : {}),
      },
      {
        id: 'user.act-as-user',
        identity: 'user',
        status: user.available && user.verified ? 'available' : 'blocked',
        ...(!(user.available && user.verified) ? { reason: 'User OAuth is not connected; bot operations remain available.' } : {}),
      },
    ],
    discoveredAt: now.toISOString(),
    issues,
  }];
}

export function parseLarkCliFailure(payload: unknown, fallback: string): ConnectionIssue {
  const root = isRecord(payload) ? payload : undefined;
  const nested = recordField(root, 'error');
  const scopes = stringArrayField(nested, 'missing')
    ?? stringArrayField(nested, 'missingScopes')
    ?? stringArrayField(nested, 'requiredScopes')
    ?? stringArrayField(root, 'missing')
    ?? stringArrayField(root, 'missingScopes')
    ?? stringArrayField(root, 'requiredScopes');
  const message = safeMessage(stringField(nested, 'message') || stringField(root, 'message') || fallback);
  const hint = safeMessage(stringField(nested, 'hint') || stringField(root, 'hint'));
  return {
    code: scopes?.length ? 'missing_scopes' : 'cli_failed',
    message,
    ...(hint ? { hint } : {}),
    ...(scopes?.length ? { missingScopes: [...new Set(scopes)].sort() } : {}),
  };
}

export function runLarkCli(executablePath: string, args: string[]): Promise<LarkCliRunResult> {
  let resolvedExecutable: string;
  try {
    resolvedExecutable = resolveSafeLarkCliExecutable(executablePath);
  } catch (error) {
    return Promise.resolve({
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : 'lark-cli executable is unavailable or unsafe.',
    });
  }
  return new Promise((resolve) => {
    execFile(resolvedExecutable, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: CLI_MAX_BUFFER,
      encoding: 'utf-8',
    }, (error, stdout, stderr) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
        ? (error as unknown as { code: number }).code
        : error ? 1 : 0;
      resolve({
        exitCode: code,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
        ...((error as { killed?: boolean } | null)?.killed ? { timedOut: true } : {}),
      });
    });
  });
}

function unavailableCandidate(input: {
  executablePath: string;
  profile?: string;
  appId?: string;
  brand?: 'feishu' | 'lark';
  issue: ConnectionIssue;
  now?: Date;
}): ConnectionCandidate {
  const profile = input.profile && SAFE_PROFILE.test(input.profile) ? input.profile : 'default';
  return {
    schemaVersion: 1,
    id: `lark-cli:${profile}`,
    provider: 'feishu',
    adapter: 'lark-cli',
    status: 'unavailable',
    credentialRef: {
      kind: 'lark-cli-profile',
      executablePath: path.resolve(input.executablePath),
      profile,
    },
    application: { appId: input.appId ?? 'unknown', brand: input.brand ?? 'feishu' },
    owner: { identity: 'bot', source: 'lark-cli-profile' },
    identities: {
      bot: { status: 'unknown', available: false, verified: false },
      user: { status: 'unknown', available: false, verified: false },
    },
    capabilities: [
      { id: 'message.send', identity: 'bot', status: 'blocked', reason: input.issue.message, ...(input.issue.missingScopes ? { missingScopes: input.issue.missingScopes } : {}) },
      { id: 'event.consume', identity: 'bot', status: 'blocked', reason: input.issue.message, ...(input.issue.missingScopes ? { missingScopes: input.issue.missingScopes } : {}) },
      { id: 'user.act-as-user', identity: 'user', status: 'blocked', reason: input.issue.message, ...(input.issue.missingScopes ? { missingScopes: input.issue.missingScopes } : {}) },
    ],
    discoveredAt: validNow(input.now).toISOString(),
    issues: [input.issue],
  };
}

function normalizeIdentity(value: Record<string, unknown> | undefined): ConnectionIdentity {
  const statusValue = stringField(value, 'status');
  const status: ConnectionIdentity['status'] = statusValue === 'ready'
    || statusValue === 'missing'
    || statusValue === 'expired'
    || statusValue === 'error'
    ? statusValue
    : 'unknown';
  const available = value?.available === true;
  const verified = value?.verified === true;
  const externalId = stringField(value, 'openId') || stringField(value, 'userId');
  const displayName = stringField(value, 'appName') || stringField(value, 'name');
  const message = safeMessage(stringField(value, 'message'));
  const hint = safeMessage(stringField(value, 'hint'));
  return {
    status,
    available,
    verified,
    ...(externalId ? { externalId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(message ? { message } : {}),
    ...(hint ? { hint } : {}),
  };
}

function parseEmbeddedJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordField(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const nested = value?.[key];
  return isRecord(nested) ? nested : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string {
  const nested = value?.[key];
  return typeof nested === 'string' ? nested.trim() : '';
}

function stringArrayField(value: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const nested = value?.[key];
  if (!Array.isArray(nested)) return undefined;
  const strings = nested.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim());
  return strings.length ? strings : undefined;
}

function safeMessage(value: string): string {
  return redactSensitiveText(value).slice(0, 1000);
}

function validNow(value?: Date): Date {
  const now = value ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Connection discovery timestamp must be valid.');
  return now;
}
