import type { Locale } from '@/lib/i18n';
import type { PlatformDef, PlatformStatus } from './platforms';

export type ChannelListStatus = 'unconfigured' | 'configured' | 'running' | 'issue';

export function getPlatformPurpose(platform: PlatformDef, locale: Locale): string {
  if (locale === 'zh') return platform.purposeZh ?? platform.purpose ?? '';
  return platform.purpose ?? platform.purposeZh ?? '';
}

export function getPlatformDisplaySubtitle({
  platform,
  status,
  locale,
  connectedFallback,
  disconnectedFallback,
}: {
  platform: PlatformDef;
  status: PlatformStatus | undefined;
  locale: Locale;
  connectedFallback: string;
  disconnectedFallback: string;
}): string {
  if (status?.connected && status.botName) return status.botName;
  const purpose = getPlatformPurpose(platform, locale);
  if (purpose) return purpose;
  return status?.connected ? connectedFallback : disconnectedFallback;
}

export function resolveChannelListStatus(status: PlatformStatus | undefined): ChannelListStatus {
  if (!status) return 'unconfigured';
  if (status.webhook?.state === 'error') return 'issue';
  if (status.webhook?.transport === 'long_connection' && status.webhook.state === 'ready') return 'running';
  if (status.connected) return 'configured';
  return 'issue';
}

export function countConnectedChannels(statuses: PlatformStatus[]): number {
  return statuses.filter((status) => status.connected === true).length;
}
