export const CHANNEL_PLATFORMS = [
  'telegram',
  'discord',
  'feishu',
  'slack',
  'wecom',
  'dingtalk',
  'wechat',
  'qq',
] as const;

export type ChannelPlatform = typeof CHANNEL_PLATFORMS[number];

export type ChannelValidationResult = {
  valid: boolean;
  missing?: string[];
};

export const CHANNEL_CREDENTIAL_SETS: Record<ChannelPlatform, readonly (readonly string[])[]> = {
  telegram: [['bot_token']],
  discord: [['bot_token']],
  feishu: [['app_id', 'app_secret']],
  slack: [['bot_token']],
  wecom: [['webhook_key'], ['corp_id', 'corp_secret']],
  dingtalk: [['webhook_url'], ['client_id', 'client_secret']],
  wechat: [['bot_token']],
  qq: [['app_id', 'app_secret']],
};

export const CHANNEL_FIELD_PATTERNS: Partial<Record<ChannelPlatform, Record<string, RegExp>>> = {
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

export const CHANNEL_CAPABILITIES: Record<ChannelPlatform, string[]> = {
  telegram: ['text', 'markdown', 'html', 'threads', 'attachments'],
  discord: ['text', 'markdown', 'threads', 'attachments'],
  feishu: ['text', 'markdown', 'threads', 'attachments'],
  slack: ['text', 'markdown', 'threads', 'attachments'],
  wecom: ['text', 'markdown', 'attachments'],
  dingtalk: ['text', 'markdown', 'attachments'],
  wechat: ['text', 'attachments'],
  qq: ['text', 'markdown', 'attachments'],
};

const CHANNEL_PLATFORM_SET = new Set<string>(CHANNEL_PLATFORMS);

export function isChannelPlatform(value: string): value is ChannelPlatform {
  return CHANNEL_PLATFORM_SET.has(value);
}

export function validateChannelCredentials(
  platform: string,
  credentials: unknown,
): ChannelValidationResult {
  if (!isChannelPlatform(platform)) {
    return { valid: false, missing: ['(unknown platform)'] };
  }

  if (!credentials || typeof credentials !== 'object') {
    return { valid: false, missing: ['(no config)'] };
  }

  const source = normalizeChannelCredentials(platform, credentials);
  const credentialSets = CHANNEL_CREDENTIAL_SETS[platform];
  const patterns = CHANNEL_FIELD_PATTERNS[platform] ?? {};
  let bestMissing = [...(credentialSets[0] ?? ['(unknown platform)'])];

  for (const fields of credentialSets) {
    const missing = fields.filter((field) => {
      const value = source[field];
      if (typeof value !== 'string' || !value.trim()) return true;
      const pattern = patterns[field];
      return pattern ? !pattern.test(value.trim()) : false;
    });

    if (missing.length === 0) return { valid: true };
    if (missing.length < bestMissing.length) bestMissing = [...missing];
  }

  return { valid: false, missing: bestMissing };
}

export function normalizeChannelCredentials(
  platform: string,
  credentials: unknown,
): Record<string, string> {
  if (!credentials || typeof credentials !== 'object') return {};
  const source = credentials as Record<string, unknown>;
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    normalized[key] = normalizeChannelCredentialField(platform, key, trimmed);
  }

  return normalized;
}

function normalizeChannelCredentialField(platform: string, key: string, value: string): string {
  if (platform === 'wecom' && key === 'webhook_key') {
    const extracted = extractQueryParam(value, 'key');
    return extracted || value;
  }
  return value;
}

function extractQueryParam(value: string, key: string): string | undefined {
  try {
    const parsed = new URL(value);
    const found = parsed.searchParams.get(key)?.trim();
    if (found) return found;
  } catch {
    // Not a URL. Fall through to regex extraction for pasted snippets.
  }

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(new RegExp(`[?&]${escaped}=([^&#\\s]+)`));
  const captured = match?.[1];
  return captured ? decodeURIComponent(captured).trim() : undefined;
}
