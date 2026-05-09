import { handleImStatusGet, type ImStatusServices } from '@geminilight/mindos/server';
import { listConfiguredIM } from '@/lib/im/executor';
import { getPlatformConfig, hasAnyIMConfig } from '@/lib/im/config';
import { buildFeishuWebhookStatus } from '@/lib/im/webhook/feishu';
import { toNextResponse } from '../../_mindos-adapter';

const services: ImStatusServices = {
  hasAnyIMConfig,
  listConfiguredIM: listConfiguredIM as ImStatusServices['listConfiguredIM'],
  getPlatformConfig: getPlatformConfig as ImStatusServices['getPlatformConfig'],
  buildFeishuWebhookStatus: buildFeishuWebhookStatus as ImStatusServices['buildFeishuWebhookStatus'],
};

export async function GET() {
  return toNextResponse(await handleImStatusGet(services));
}
