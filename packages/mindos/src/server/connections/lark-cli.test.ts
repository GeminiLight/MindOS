import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverLarkCliConnections,
  findLarkCliExecutable,
  parseLarkCliFailure,
  resolveSafeLarkCliExecutable,
} from './lark-cli.js';

let root = '';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('lark-cli connection discovery', () => {
  it('finds a PATH-external executable and keeps a verified bot ready when user auth is missing', async () => {
    root = mkdtempSync(join(tmpdir(), 'mindos-lark-cli-'));
    const executable = join(root, '.local', 'node-v24.20.0-darwin-arm64', 'bin', 'lark-cli');
    mkdirSync(join(executable, '..'), { recursive: true });
    writeFileSync(executable, '#!/bin/sh\n', { mode: 0o700 });

    expect(findLarkCliExecutable({ homeDir: root, pathValue: '' })).toBe(realpathSync(executable));

    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args.join(' ') === 'config show') {
        return {
          exitCode: 0,
          stdout: `Config file path: ${root}/.lark-cli/config.json\n${JSON.stringify({
            appId: 'cli_existing',
            appSecret: 'must-never-leak',
            brand: 'feishu',
            profile: 'existing-profile',
            workspace: 'local',
          })}`,
          stderr: '',
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          appId: 'cli_existing',
          brand: 'feishu',
          identities: {
            bot: { status: 'ready', available: true, verified: true, openId: 'ou_bot', appName: 'Existing Bot' },
            user: { status: 'missing', available: false, message: 'User identity: missing', hint: 'run login' },
          },
          identity: 'bot',
          verified: true,
        }),
        stderr: '',
      };
    });

    const result = await discoverLarkCliConnections({
      executablePath: executable,
      run,
      now: new Date('2026-09-03T11:00:00.000Z'),
    });

    expect(run).toHaveBeenNthCalledWith(1, executable, ['config', 'show']);
    expect(run).toHaveBeenNthCalledWith(2, executable, [
      '--profile', 'existing-profile', 'auth', 'status', '--json', '--verify',
    ]);
    expect(result).toEqual([expect.objectContaining({
      id: 'lark-cli:existing-profile',
      provider: 'feishu',
      adapter: 'lark-cli',
      status: 'ready',
      credentialRef: {
        kind: 'lark-cli-profile',
        executablePath: executable,
        profile: 'existing-profile',
      },
      application: { appId: 'cli_existing', appName: 'Existing Bot', brand: 'feishu' },
      identities: {
        bot: expect.objectContaining({ status: 'ready', available: true, verified: true, externalId: 'ou_bot' }),
        user: expect.objectContaining({ status: 'missing', available: false }),
      },
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'message.send', identity: 'bot', status: 'available' }),
        expect.objectContaining({ id: 'event.consume', identity: 'bot', status: 'available' }),
        expect.objectContaining({ id: 'user.act-as-user', identity: 'user', status: 'blocked' }),
      ]),
    })]);
    expect(JSON.stringify(result)).not.toContain('must-never-leak');
  });

  it('returns an actionable, secret-free issue when verification reports missing scopes', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => args[0] === 'config'
      ? {
          exitCode: 0,
          stdout: JSON.stringify({ appId: 'cli_scope', appSecret: 'hidden', brand: 'feishu', profile: 'scope-profile' }),
          stderr: '',
        }
      : {
          exitCode: 2,
          stdout: JSON.stringify({
            ok: false,
            error: {
              type: 'permission',
              message: 'Missing required scopes',
              hint: 'Ask an administrator to approve the scopes.',
              missing: ['im:message', 'im:message:receive_v1'],
              access_token: 'secret-token',
            },
          }),
          stderr: '',
        });

    const [candidate] = await discoverLarkCliConnections({ executablePath: '/safe/lark-cli', run });
    expect(candidate.status).toBe('unavailable');
    expect(candidate.issues).toEqual([expect.objectContaining({
      code: 'missing_scopes',
      message: 'Missing required scopes',
      hint: 'Ask an administrator to approve the scopes.',
      missingScopes: ['im:message', 'im:message:receive_v1'],
    })]);
    expect(JSON.stringify(candidate)).not.toContain('secret-token');
    expect(JSON.stringify(candidate)).not.toContain('hidden');
  });

  it('normalizes CLI failures from top-level and nested missing-scope payloads', () => {
    expect(parseLarkCliFailure({
      ok: false,
      error: { message: 'Forbidden', requiredScopes: ['contact:user.base:readonly'] },
    }, 'fallback')).toEqual({
      code: 'missing_scopes',
      message: 'Forbidden',
      missingScopes: ['contact:user.base:readonly'],
    });
    expect(parseLarkCliFailure(null, 'network down')).toEqual({
      code: 'cli_failed',
      message: 'network down',
    });
  });

  it('rejects an executable that another local account can replace', () => {
    root = mkdtempSync(join(tmpdir(), 'mindos-lark-cli-security-'));
    const executable = join(root, 'lark-cli');
    writeFileSync(executable, '#!/bin/sh\n', { mode: 0o700 });
    expect(resolveSafeLarkCliExecutable(executable)).toBe(realpathSync(executable));

    chmodSync(executable, 0o722);
    expect(() => resolveSafeLarkCliExecutable(executable)).toThrow(/group or world writable/i);
  });
});
