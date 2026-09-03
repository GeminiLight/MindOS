import {
  mkdtempSync
} from 'node:fs';
import {
  tmpdir
} from 'node:os';
import {
  join
} from 'node:path';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  handleChannelsVerifyPost,
  handleImActivityGet,
  handleImConfigDelete,
  handleImConfigGet,
  handleImConfigPut,
  handleImFeishuOAuthCallbackGet,
  handleImFeishuOAuthGet,
  handleImFeishuLongConnectionDelete,
  handleImFeishuLongConnectionGet,
  handleImFeishuLongConnectionPost,
  handleImStatusGet,
  handleImTestPost,
  handleImWebhookStatusGet
} from './server.js';

describe('MindOS server contract: channels and IM', () => {
  it('verifies channel credentials through product validation and injected verifier', async () => {
    const verified = await handleChannelsVerifyPost({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    }, {
      verifyCredentials: async (platform, credentials) => ({
        ok: true,
        botName: `${platform}-bot`,
        botId: (credentials as { bot_token: string }).bot_token.slice(0, 3),
      }),
    });

    expect(verified).toMatchObject({
      status: 200,
      body: { ok: true, botName: 'telegram-bot', botId: '123' },
    });

    await expect(handleChannelsVerifyPost({ platform: 'unknown', credentials: {} })).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Invalid platform' },
    });
    await expect(handleChannelsVerifyPost({ platform: 'telegram' })).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Missing credentials' },
    });
    await expect(handleChannelsVerifyPost({ platform: 'telegram', credentials: { bot_token: 'bad' } })).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Missing required fields: bot_token' },
    });
    await expect(handleChannelsVerifyPost({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    }, {
      verifyCredentials: async () => ({ ok: false, error: 'Unauthorized: check bot_token' }),
    })).resolves.toMatchObject({
      status: 401,
      body: { ok: false, error: 'Unauthorized: check bot_token' },
    });
  });

  it('lists IM activity with platform validation and clamped limit', () => {
    expect(handleImActivityGet(new URLSearchParams('platform=bad'), {
      getActivities: () => [],
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid or missing platform parameter' },
    });

    expect(handleImActivityGet(new URLSearchParams('platform=feishu&limit=500'), {
      getActivities: (platform, limit) => [{
        id: '1',
        platform,
        limit,
        recipient: 'ou_1234567890',
        messageSummary: 'token=abc123secret',
        error: 'Authorization: Bearer sk-im-handler-secret-1234567890',
      }],
    })).toMatchObject({
      status: 200,
      body: {
        activities: [{
          id: '1',
          platform: 'feishu',
          limit: 100,
          recipient: 'ou_***890',
          messageSummary: 'token=[redacted]',
          error: 'Authorization: Bearer [redacted]',
        }],
      },
    });
  });

  it('manages IM config through product-owned masking, validation, and deletes', () => {
    let config: any = {
      providers: {
        telegram: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
        feishu: {
          app_id: 'cli_app',
          app_secret: 'secret123',
          conversation: {
            enabled: true,
            transport: 'webhook',
            public_base_url: 'https://mindos.example.com',
            encrypt_key: 'encrypt-key',
            verification_token: 'verify-token',
            allow_group_mentions: true,
          },
        },
      },
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
    };

    expect(handleImConfigGet(services)).toMatchObject({
      status: 200,
      body: {
        providers: {
          telegram: { bot_token: '1234••••YZ' },
          feishu: {
            app_id: 'cli_••••pp',
            app_secret: 'secr••••23',
            conversation: {
              enabled: true,
              transport: 'webhook',
              public_base_url: 'https://mindos.example.com',
              encrypt_key: 'encr••••ey',
              verification_token: 'veri••••en',
              allow_group_mentions: true,
            },
          },
        },
      },
    });

    expect(handleImConfigPut({ platform: 'telegram', credentials: { bot_token: 'bad' } }, services)).toMatchObject({
      status: 422,
      body: { error: 'Invalid config: missing bot_token', missing: ['bot_token'] },
    });

    expect(handleImConfigPut({
      platform: 'wecom',
      credentials: { webhook_key: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=robot-key-123' },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'wecom' },
    });
    expect(config.providers.wecom).toMatchObject({ webhook_key: 'robot-key-123' });

    expect(handleImConfigPut({
      platform: 'feishu',
      conversation: { enabled: true, transport: 'long_connection', allow_group_mentions: false },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'feishu' },
    });
    expect(config.providers.feishu.conversation).toMatchObject({
      enabled: true,
      transport: 'long_connection',
      allow_group_mentions: false,
    });

    expect(handleImConfigPut({
      platform: 'telegram',
      conversation: { enabled: true },
    }, services)).toMatchObject({
      status: 422,
      body: { error: 'Conversation settings are only supported for Feishu' },
    });

    expect(handleImConfigPut({
      platform: 'feishu',
      conversation: { verification_token: 'rotated-token' },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'feishu' },
    });
    expect(config.providers.feishu.conversation).toMatchObject({
      enabled: true,
      transport: 'long_connection',
      verification_token: 'rotated-token',
      allow_group_mentions: false,
    });

    delete config.providers.feishu;
    expect(handleImConfigPut({
      platform: 'feishu',
      credentials: { app_id: 'cli_new', app_secret: 'secret456' },
      conversation: { enabled: true, transport: 'long_connection' },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'feishu' },
    });
    expect(config.providers.feishu).toMatchObject({
      app_id: 'cli_new',
      app_secret: 'secret456',
      conversation: {
        enabled: true,
        transport: 'long_connection',
      },
    });

    expect(handleImConfigDelete(new URLSearchParams('platform=telegram'), services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'telegram' },
    });
    expect(config.providers.telegram).toBeUndefined();
  });

  it('reports IM status and Feishu webhook diagnostics through injected product services', async () => {
    const feishuConfig = {
      app_id: 'cli_app',
      app_secret: 'secret',
      conversation: {
        enabled: true,
        transport: 'webhook',
        public_base_url: 'https://mindos.example/',
        encrypt_key: 'encrypt',
      },
    };
    const services = {
      hasAnyIMConfig: () => true,
      listConfiguredIM: async () => [
        { platform: 'feishu', connected: true, botName: 'MindOS', capabilities: ['text'] },
        { platform: 'telegram', connected: false, capabilities: ['text'] },
      ],
      getPlatformConfig: (platform: string) => platform === 'feishu' ? feishuConfig : undefined,
      buildFeishuWebhookStatus: (config: unknown) => ({
        platform: 'feishu',
        state: config === feishuConfig ? 'ready' : 'disabled',
        transport: 'webhook',
        publicBaseUrl: 'https://mindos.example',
        webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
      }),
    };

    await expect(handleImStatusGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        platforms: [
          {
            platform: 'feishu',
            connected: true,
            webhook: {
              state: 'ready',
              webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
            },
          },
          { platform: 'telegram', connected: false },
        ],
      },
    });

    expect(handleImWebhookStatusGet(new URLSearchParams('platform=feishu'), services)).toMatchObject({
      status: 200,
      body: {
        status: {
          platform: 'feishu',
          state: 'ready',
          webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
        },
      },
    });

    expect(handleImWebhookStatusGet(new URLSearchParams('platform=telegram'), services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid or unsupported platform parameter' },
    });
  });

  it('reports connected Feishu OAuth identity in IM status', async () => {
    await expect(handleImStatusGet({
      configPath: join(mkdtempSync(join(tmpdir(), 'mindos-im-status-')), 'im.json'),
      hasAnyIMConfig: () => true,
      listConfiguredIM: async () => [
        { platform: 'feishu', connected: true, botName: 'MindOS', capabilities: ['text'] },
      ],
      getPlatformConfig: () => ({
        app_id: 'cli_app',
        app_secret: 'secret',
        oauth: {
          status: 'connected',
          expires_at: '2026-06-05T02:00:00.000Z',
          user: { name: 'MindOS User', open_id: 'ou_123' },
        },
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: {
        platforms: [
          {
            platform: 'feishu',
            oauth: {
              state: 'connected',
              expiresAt: '2026-06-05T02:00:00.000Z',
              user: { name: 'MindOS User', open_id: 'ou_123' },
            },
          },
        ],
      },
    });
  });

  it('sends IM test messages with product validation and normalized errors', async () => {
    const calls: any[] = [];
    const services = {
      sendIMMessage: async (message: any, signal: AbortSignal | undefined, options: { activityType?: string } | undefined) => {
        calls.push({ message, signal, options });
        return { ok: true, messageId: 'msg_1', timestamp: '2026-05-09T00:00:00.000Z' };
      },
    };

    await expect(handleImTestPost({
      platform: 'feishu',
      recipient_id: 'ou_123',
      message: 'hello',
    }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, messageId: 'msg_1', timestamp: '2026-05-09T00:00:00.000Z' },
    });
    expect(calls).toEqual([{
      message: {
        platform: 'feishu',
        recipientId: 'ou_123',
        text: 'hello',
        format: 'text',
      },
      signal: undefined,
      options: { activityType: 'test' },
    }]);

    await expect(handleImTestPost({ platform: 'feishu', recipient_id: 'ou_123' }, services)).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Missing required fields: platform, recipient_id, message' },
    });
    await expect(handleImTestPost({
      platform: 'feishu',
      recipient_id: 'ou_123',
      message: 'hello',
    }, {
      sendIMMessage: async () => ({ ok: false, error: 'invalid recipient', timestamp: '2026-05-09T00:00:00.000Z' }),
    })).resolves.toMatchObject({
      status: 422,
      body: { ok: false, error: 'invalid recipient' },
    });
  });

  it('controls Feishu long connection lifecycle and persists transport state', async () => {
    let config: any = {
      providers: {
        feishu: {
          app_id: 'cli_app',
          app_secret: 'secret',
          conversation: { enabled: false, transport: 'webhook' },
        },
      },
    };
    let running = false;
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
      getFeishuWSClientStatus: () => ({ running, startedAt: running ? '2026-05-09T00:00:00.000Z' : undefined }),
      startFeishuWSClient: async (feishuConfig: any) => {
        expect(feishuConfig.app_id).toBe('cli_app');
        running = true;
      },
      stopFeishuWSClient: () => { running = false; },
    };

    expect(handleImFeishuLongConnectionGet(services)).toMatchObject({
      status: 200,
      body: { ok: true, running: false },
    });

    await expect(handleImFeishuLongConnectionPost(services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, running: true, startedAt: '2026-05-09T00:00:00.000Z' },
    });
    expect(config.providers.feishu.conversation).toMatchObject({
      enabled: true,
      transport: 'long_connection',
    });

    expect(handleImFeishuLongConnectionDelete(services)).toMatchObject({
      status: 200,
      body: { ok: true, running: false },
    });
    expect(config.providers.feishu.conversation.transport).toBe('webhook');

    config = { providers: {} };
    await expect(handleImFeishuLongConnectionPost(services)).resolves.toMatchObject({
      status: 422,
      body: { ok: false, error: 'Feishu is not configured. Bind an existing app or save App ID and App Secret first.' },
    });
  });

  it('enables Feishu conversations through a bound lark-cli profile without copying a secret', async () => {
    let config: any = {
      providers: {
        feishu: {
          app_id: 'cli_existing',
          credential_source: 'lark_cli_profile',
          credential_ref: {
            kind: 'lark-cli-profile',
            executablePath: '/opt/lark-cli',
            profile: 'cli_existing',
          },
        },
      },
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
      getFeishuWSClientStatus: () => ({ running: true, startedAt: '2026-09-03T00:00:00.000Z' }),
      startFeishuWSClient: async (feishuConfig: any) => {
        expect(feishuConfig).not.toHaveProperty('app_secret');
        expect(feishuConfig.credential_ref.profile).toBe('cli_existing');
      },
      stopFeishuWSClient: () => {},
    };

    expect(handleImConfigPut({
      platform: 'feishu',
      conversation: { enabled: true, transport: 'long_connection' },
    }, services)).toMatchObject({ status: 200, body: { ok: true } });
    await expect(handleImFeishuLongConnectionPost(services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, running: true },
    });
    expect(config.providers.feishu).not.toHaveProperty('app_secret');
  });

  it('creates a Feishu OAuth authorization URL only after app credentials are saved', () => {
    let config: any = { providers: {} };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
      createState: () => 'state_123',
      now: () => new Date('2026-06-05T00:00:00.000Z'),
    };

    expect(handleImFeishuOAuthGet(new URLSearchParams(''), services)).toMatchObject({
      status: 422,
      body: {
        ok: false,
        mode: 'setup_required',
        error: 'Save Feishu App ID and App Secret before OAuth authorization.',
      },
    });

    config = { providers: { feishu: { app_id: 'cli_app_123', app_secret: 'secret' } } };
    expect(handleImFeishuOAuthGet(new URLSearchParams('redirect_uri=https://mindos.example/api/im/feishu/oauth/callback&scope=contact:contact'), services)).toMatchObject({
      status: 200,
      body: {
        ok: true,
        mode: 'oauth',
        state: 'state_123',
        redirectUri: 'https://mindos.example/api/im/feishu/oauth/callback',
        scopes: ['contact:contact'],
      },
    });
    expect((config.providers.feishu.oauth.pending.expires_at as string)).toBe('2026-06-05T00:10:00.000Z');
    expect(config.providers.feishu.oauth.pending.state).toBe('state_123');
    expect(config.providers.feishu.oauth.pending.redirect_uri).toBe('https://mindos.example/api/im/feishu/oauth/callback');
  });

  it('rejects Feishu OAuth callbacks with invalid state', async () => {
    const config: any = {
      providers: {
        feishu: {
          app_id: 'cli_app',
          app_secret: 'secret',
          oauth: {
            pending: {
              state: 'expected',
              redirect_uri: 'https://mindos.example/api/im/feishu/oauth/callback',
              expires_at: '2026-06-05T00:10:00.000Z',
            },
          },
        },
      },
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { Object.assign(config, next); },
      now: () => new Date('2026-06-05T00:00:00.000Z'),
      exchangeCode: async () => ({ access_token: 'should_not_be_used' }),
    };

    await expect(handleImFeishuOAuthCallbackGet(new URLSearchParams('code=abc&state=wrong'), services)).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Invalid Feishu OAuth state. Start authorization again from MindOS.' },
    });
    expect(config.providers.feishu.oauth.status).toBeUndefined();
  });

  it('stores Feishu OAuth user identity and token metadata after a valid callback', async () => {
    let config: any = {
      providers: {
        feishu: {
          app_id: 'cli_app',
          app_secret: 'secret',
          oauth: {
            pending: {
              state: 'expected',
              redirect_uri: 'https://mindos.example/api/im/feishu/oauth/callback',
              expires_at: '2026-06-05T00:10:00.000Z',
            },
          },
        },
      },
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
      now: () => new Date('2026-06-05T00:00:00.000Z'),
      exchangeCode: async (input: any) => {
        expect(input).toMatchObject({
          appId: 'cli_app',
          appSecret: 'secret',
          code: 'auth_code',
        });
        return {
          access_token: 'u-token',
          refresh_token: 'r-token',
          expires_in: 7200,
          name: 'MindOS User',
          open_id: 'ou_123',
          union_id: 'on_123',
        };
      },
    };

    await expect(handleImFeishuOAuthCallbackGet(new URLSearchParams('code=auth_code&state=expected'), services)).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        platform: 'feishu',
        user: { name: 'MindOS User', open_id: 'ou_123', union_id: 'on_123' },
      },
    });
    expect(config.providers.feishu.oauth).toMatchObject({
      status: 'connected',
      user_access_token: 'u-token',
      refresh_token: 'r-token',
      expires_at: '2026-06-05T02:00:00.000Z',
      user: { name: 'MindOS User', open_id: 'ou_123', union_id: 'on_123' },
    });
    expect(config.providers.feishu.oauth.pending).toBeUndefined();
  });

  it('exchanges Feishu OAuth callbacks with the current token API and user info API', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://open.feishu.cn/open-apis/authen/v2/oauth/token') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          grant_type: 'authorization_code',
          client_id: 'cli_app',
          client_secret: 'secret',
          code: 'auth_code',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            access_token: 'u-token',
            refresh_token: 'r-token',
            expires_in: 7200,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://open.feishu.cn/open-apis/authen/v1/user_info') {
        expect(init?.method).toBe('GET');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer u-token',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            name: 'MindOS User',
            open_id: 'ou_123',
            union_id: 'on_123',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected Feishu URL: ${url}`);
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    let config: any = {
      providers: {
        feishu: {
          app_id: 'cli_app',
          app_secret: 'secret',
          oauth: {
            pending: {
              state: 'expected',
              redirect_uri: 'https://mindos.example/api/im/feishu/oauth/callback',
              expires_at: '2026-06-05T00:10:00.000Z',
            },
          },
        },
      },
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
      now: () => new Date('2026-06-05T00:00:00.000Z'),
    };

    try {
      await expect(handleImFeishuOAuthCallbackGet(new URLSearchParams('code=auth_code&state=expected'), services)).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          platform: 'feishu',
          user: { name: 'MindOS User', open_id: 'ou_123', union_id: 'on_123' },
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(config.providers.feishu.oauth).toMatchObject({
        user_access_token: 'u-token',
        refresh_token: 'r-token',
        user: { name: 'MindOS User', open_id: 'ou_123', union_id: 'on_123' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
