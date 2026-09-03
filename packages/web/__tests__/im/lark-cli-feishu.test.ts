import { describe, expect, it, vi } from 'vitest';
import { LarkCliFeishuAdapter } from '@/lib/im/adapters/lark-cli-feishu';

const config = {
  app_id: 'cli_existing',
  credential_source: 'lark_cli_profile' as const,
  credential_ref: {
    kind: 'lark-cli-profile' as const,
    executablePath: '/opt/lark-cli',
    profile: 'existing-profile',
  },
};

describe('LarkCliFeishuAdapter', () => {
  it('sends through the bound bot identity with a stable idempotency key', async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, data: { message_id: 'om_sent' } }),
      stderr: '',
    }));
    const adapter = new LarkCliFeishuAdapter(config, run);

    const result = await adapter.send({
      platform: 'feishu',
      recipientId: 'ou_person',
      text: '**Build passed**',
      format: 'markdown',
      idempotencyKey: 'delivery-123',
    });

    expect(result).toMatchObject({ ok: true, messageId: 'om_sent' });
    expect(run).toHaveBeenCalledWith('/opt/lark-cli', [
      '--profile', 'existing-profile',
      'im', '+messages-send',
      '--as', 'bot',
      '--user-id', 'ou_person',
      '--markdown', '**Build passed**',
      '--idempotency-key', 'delivery-123',
      '--json',
    ]);
  });

  it('surfaces missing scopes without leaking CLI payload secrets', async () => {
    const run = vi.fn(async () => ({
      exitCode: 2,
      stdout: JSON.stringify({
        ok: false,
        error: {
          message: 'Missing app scope',
          missing: ['im:message'],
          access_token: 'must-not-leak',
        },
      }),
      stderr: '',
    }));
    const result = await new LarkCliFeishuAdapter(config, run).send({
      platform: 'feishu', recipientId: 'oc_chat', text: 'hello', idempotencyKey: 'delivery-456',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing app scope');
    expect(result.error).toContain('im:message');
    expect(result.error).not.toContain('must-not-leak');
  });

  it('fails closed when a JSON command returns malformed output', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: 'not-json', stderr: '' }));
    const result = await new LarkCliFeishuAdapter(config, run).send({
      platform: 'feishu', recipientId: 'oc_chat', text: 'hello', idempotencyKey: 'delivery-malformed',
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/invalid JSON/i) });
  });

  it('verifies bot independently of missing user OAuth and exposes the existing app name', async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        identities: {
          bot: { status: 'ready', available: true, verified: true, appName: 'Existing Bot' },
          user: { status: 'missing', available: false },
        },
      }),
      stderr: '',
    }));
    const adapter = new LarkCliFeishuAdapter(config, run);
    expect(await adapter.verify()).toBe(true);
    expect(adapter.getAppName()).toBe('Existing Bot');
    expect(run).toHaveBeenCalledWith('/opt/lark-cli', [
      '--profile', 'existing-profile', 'auth', 'status', '--json', '--verify',
    ]);
  });
});
