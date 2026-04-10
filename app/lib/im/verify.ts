import type { IMAdapter, IMPlatform } from './types';
import { validatePlatformConfig } from './config';

export interface IMVerifyResult {
  ok: boolean;
  botName?: string;
  botId?: string;
  error?: string;
}

export async function verifyIMCredentials(platform: IMPlatform, credentials: unknown): Promise<IMVerifyResult> {
  const validation = validatePlatformConfig(platform, credentials);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Missing required fields: ${validation.missing?.join(', ') || 'unknown'}`,
    };
  }

  const adapter = await createAdapter(platform, credentials);
  try {
    const ok = await adapter.verify();
    if (!ok) {
      return { ok: false, error: 'Credential verification failed' };
    }
    const info = extractAdapterIdentity(adapter);
    return { ok: true, ...info };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await adapter.dispose().catch(() => {});
  }
}

async function createAdapter(platform: IMPlatform, credentials: unknown): Promise<IMAdapter> {
  switch (platform) {
    case 'telegram': {
      const { TelegramAdapter } = await import('./adapters/telegram');
      return new TelegramAdapter(credentials as ConstructorParameters<typeof TelegramAdapter>[0]);
    }
    case 'feishu': {
      const { FeishuAdapter } = await import('./adapters/feishu');
      return new FeishuAdapter(credentials as ConstructorParameters<typeof FeishuAdapter>[0]);
    }
    case 'discord': {
      const { DiscordAdapter } = await import('./adapters/discord');
      return new DiscordAdapter(credentials as ConstructorParameters<typeof DiscordAdapter>[0]);
    }
    case 'slack': {
      const { SlackAdapter } = await import('./adapters/slack');
      return new SlackAdapter(credentials as ConstructorParameters<typeof SlackAdapter>[0]);
    }
    case 'wecom': {
      const { WeComAdapter } = await import('./adapters/wecom');
      return new WeComAdapter(credentials as ConstructorParameters<typeof WeComAdapter>[0]);
    }
    case 'dingtalk': {
      const { DingTalkAdapter } = await import('./adapters/dingtalk');
      return new DingTalkAdapter(credentials as ConstructorParameters<typeof DingTalkAdapter>[0]);
    }
    case 'wechat': {
      const { WeChatAdapter } = await import('./adapters/wechat');
      return new WeChatAdapter(credentials as ConstructorParameters<typeof WeChatAdapter>[0]);
    }
    case 'qq': {
      const { QQAdapter } = await import('./adapters/qq');
      return new QQAdapter(credentials as ConstructorParameters<typeof QQAdapter>[0]);
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function extractAdapterIdentity(adapter: IMAdapter): Pick<IMVerifyResult, 'botName' | 'botId'> {
  if ('getBotInfo' in adapter && typeof adapter.getBotInfo === 'function') {
    const info = adapter.getBotInfo() as { id?: string | number; username?: string | null } | null;
    if (info) {
      return {
        botId: info.id ? String(info.id) : undefined,
        botName: info.username ? String(info.username) : undefined,
      };
    }
  }

  if ('getAppName' in adapter && typeof adapter.getAppName === 'function') {
    const appName = adapter.getAppName() as string | null;
    return { botName: appName ?? undefined };
  }

  return {};
}
