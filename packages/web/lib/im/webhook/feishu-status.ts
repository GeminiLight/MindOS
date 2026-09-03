import { getFeishuWSClientStatus } from '@/lib/im/feishu-ws-status';
import type { FeishuConfig, IMWebhookStatus } from '@/lib/im/types';

function getFeishuTransport(config?: FeishuConfig): 'webhook' | 'long_connection' {
  return config?.conversation?.transport ?? 'webhook';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function buildFeishuWebhookStatus(config?: FeishuConfig): IMWebhookStatus {
  const conversation = config?.conversation;
  const transport = getFeishuTransport(config);
  const publicBaseUrl = conversation?.public_base_url?.trim();
  const normalizedBaseUrl = publicBaseUrl ? trimTrailingSlash(publicBaseUrl) : undefined;
  const webhookUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/api/im/webhook/feishu` : undefined;

  if (!conversation?.enabled) {
    return {
      platform: 'feishu',
      state: 'disabled',
      transport,
      publicBaseUrl: normalizedBaseUrl,
      webhookUrl,
    };
  }

  if (transport === 'long_connection') {
    const wsStatus = getFeishuWSClientStatus();
    if (!hasLongConnectionCredential(config)) {
      return {
        platform: 'feishu',
        state: 'error',
        transport,
        lastError: 'Feishu App ID and App Secret are required for long connection mode.',
      };
    }

    return {
      platform: 'feishu',
      state: wsStatus.running ? 'ready' : 'pending',
      transport,
      lastError: wsStatus.running ? undefined : (wsStatus.lastError ?? 'Start the Feishu long connection client to receive events locally.'),
    };
  }

  if (!conversation.encrypt_key) {
    return {
      platform: 'feishu',
      state: 'error',
      transport,
      publicBaseUrl: normalizedBaseUrl,
      webhookUrl,
      lastError: 'Encrypt Key is required to enable Feishu conversations.',
    };
  }

  if (!normalizedBaseUrl) {
    return {
      platform: 'feishu',
      state: 'pending',
      transport,
      publicBaseUrl: undefined,
      webhookUrl: undefined,
      lastError: 'Public base URL is required for Feishu event callbacks.',
    };
  }

  return {
    platform: 'feishu',
    state: 'ready',
    transport,
    publicBaseUrl: normalizedBaseUrl,
    webhookUrl,
    lastError: undefined,
  };
}

function hasLongConnectionCredential(config?: FeishuConfig): boolean {
  if (config?.app_id?.trim() && config.app_secret?.trim()) return true;
  return config?.credential_source === 'lark_cli_profile'
    && config.credential_ref?.kind === 'lark-cli-profile'
    && config.credential_ref.executablePath.startsWith('/')
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(config.credential_ref.profile);
}
