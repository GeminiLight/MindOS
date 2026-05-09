import { json, type MindosServerResponse } from '../response.js';

export type ChannelPlatform =
  | 'telegram'
  | 'discord'
  | 'feishu'
  | 'slack'
  | 'wecom'
  | 'dingtalk'
  | 'wechat'
  | 'qq';

export type ChannelsVerifyPayload = {
  platform?: string;
  credentials?: unknown;
};

export type ChannelsVerifyResult = {
  ok: boolean;
  botName?: string;
  botId?: string;
  error?: string;
};

export type ChannelsVerifyServices = {
  verifyCredentials?(platform: ChannelPlatform, credentials: unknown): Promise<ChannelsVerifyResult>;
};

const CHANNEL_PLATFORMS = new Set<ChannelPlatform>([
  'telegram',
  'discord',
  'feishu',
  'slack',
  'wecom',
  'dingtalk',
  'wechat',
  'qq',
]);

const CHANNEL_CREDENTIAL_SETS: Record<ChannelPlatform, string[][]> = {
  telegram: [['bot_token']],
  discord: [['bot_token']],
  feishu: [['app_id', 'app_secret']],
  slack: [['bot_token']],
  wecom: [['webhook_key'], ['corp_id', 'corp_secret']],
  dingtalk: [['webhook_url'], ['client_id', 'client_secret']],
  wechat: [['bot_token']],
  qq: [['app_id', 'app_secret']],
};

const CHANNEL_FIELD_PATTERNS: Partial<Record<ChannelPlatform, Record<string, RegExp>>> = {
  telegram: {
    bot_token: /^\d+:[A-Za-z0-9_-]{25,}$/,
  },
  discord: {
    bot_token: /^[A-Za-z0-9._-]{20,}$/,
  },
  slack: {
    bot_token: /^xoxb-/,
  },
  wecom: {
    webhook_key: /^[A-Za-z0-9_-]{6,}$/,
  },
  dingtalk: {
    webhook_url: /^https:\/\//,
  },
};

export async function handleChannelsVerifyPost(
  body: ChannelsVerifyPayload | unknown,
  services: ChannelsVerifyServices = {},
): Promise<MindosServerResponse<ChannelsVerifyResult | { ok: false; error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as ChannelsVerifyPayload : {};
    const platform = payload.platform;
    const credentials = payload.credentials;

    if (!platform || !isChannelPlatform(platform)) {
      return json({ ok: false, error: 'Invalid platform' }, { status: 400 });
    }

    if (!credentials || typeof credentials !== 'object') {
      return json({ ok: false, error: 'Missing credentials' }, { status: 400 });
    }

    const validation = validateChannelCredentials(platform, credentials);
    if (!validation.valid) {
      return json(
        { ok: false, error: `Missing required fields: ${validation.missing?.join(', ') || 'unknown'}` },
        { status: 400 },
      );
    }

    const verifier = services.verifyCredentials ?? defaultVerifier;
    const result = await verifier(platform, credentials);
    if (!result.ok) {
      return json({ ok: false, error: result.error || 'Credential verification failed' }, { status: 401 });
    }

    return json({
      ok: true,
      botName: result.botName,
      botId: result.botId,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function isChannelPlatform(value: string): value is ChannelPlatform {
  return CHANNEL_PLATFORMS.has(value as ChannelPlatform);
}

function validateChannelCredentials(
  platform: ChannelPlatform,
  credentials: unknown,
): { valid: boolean; missing?: string[] } {
  if (!credentials || typeof credentials !== 'object') {
    return { valid: false, missing: ['(no config)'] };
  }

  const source = credentials as Record<string, unknown>;
  const credentialSets = CHANNEL_CREDENTIAL_SETS[platform];
  const patterns = CHANNEL_FIELD_PATTERNS[platform] ?? {};
  let bestMissing = credentialSets[0] ?? ['(unknown platform)'];

  for (const fields of credentialSets) {
    const missing = fields.filter((field) => {
      const value = source[field];
      if (typeof value !== 'string' || !value.trim()) return true;
      const pattern = patterns[field];
      return pattern ? !pattern.test(value) : false;
    });

    if (missing.length === 0) return { valid: true };
    if (missing.length < bestMissing.length) bestMissing = missing;
  }

  return { valid: false, missing: bestMissing };
}

async function defaultVerifier(): Promise<ChannelsVerifyResult> {
  return { ok: false, error: 'Credential verifier is not configured' };
}
