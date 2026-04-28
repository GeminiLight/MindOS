import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const readIMConfig = vi.fn();
const writeIMConfig = vi.fn();
const validatePlatformConfig = vi.fn();

vi.mock('@/lib/im/config', () => ({
  readIMConfig,
  writeIMConfig,
  validatePlatformConfig,
}));

async function importRoute() {
  return await import('../../app/api/im/config/route');
}

describe('/api/im/config Feishu conversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validatePlatformConfig.mockReturnValue({ valid: true });
  });

  it('stores verification_token when provided', async () => {
    readIMConfig.mockReturnValue({
      providers: {
        feishu: {
          app_id: 'cli_xxx',
          app_secret: 'secret',
          conversation: {
            enabled: true,
            encrypt_key: 'encrypt',
            public_base_url: 'https://mindos.example.com',
            allow_group_mentions: true,
          },
        },
      },
    });
    const { PUT } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/config', {
      method: 'PUT',
      body: JSON.stringify({
        platform: 'feishu',
        conversation: {
          enabled: true,
          verification_token: 'token-123',
        },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(writeIMConfig).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        feishu: expect.objectContaining({
          conversation: expect.objectContaining({
            verification_token: 'token-123',
          }),
        }),
      }),
    }));
  });

  it('preserves the saved verification_token when the user leaves it blank', async () => {
    readIMConfig.mockReturnValue({
      providers: {
        feishu: {
          app_id: 'cli_xxx',
          app_secret: 'secret',
          conversation: {
            enabled: true,
            encrypt_key: 'encrypt',
            verification_token: 'saved-token',
            public_base_url: 'https://mindos.example.com',
            allow_group_mentions: true,
          },
        },
      },
    });
    const { PUT } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/config', {
      method: 'PUT',
      body: JSON.stringify({
        platform: 'feishu',
        conversation: {
          enabled: true,
        },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(writeIMConfig).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        feishu: expect.objectContaining({
          conversation: expect.objectContaining({
            verification_token: 'saved-token',
          }),
        }),
      }),
    }));
  });

  it('stores transport mode for Feishu conversation settings', async () => {
    readIMConfig.mockReturnValue({
      providers: {
        feishu: {
          app_id: 'cli_xxx',
          app_secret: 'secret',
          conversation: {
            enabled: true,
            transport: 'webhook',
            allow_group_mentions: true,
          },
        },
      },
    });
    const { PUT } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/config', {
      method: 'PUT',
      body: JSON.stringify({
        platform: 'feishu',
        conversation: {
          enabled: true,
          transport: 'long_connection',
        },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(writeIMConfig).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        feishu: expect.objectContaining({
          conversation: expect.objectContaining({
            transport: 'long_connection',
          }),
        }),
      }),
    }));
  });
});
