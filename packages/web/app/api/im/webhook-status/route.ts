import { handleImWebhookStatusGet, type ImStatusServices } from '@geminilight/mindos/server';
import { getPlatformConfig } from '@/lib/im/config';
import { buildFeishuWebhookStatus } from '@/lib/im/webhook/feishu';
import { toNextResponse } from '../../_mindos-adapter';

const services: ImStatusServices = {
  getPlatformConfig: getPlatformConfig as ImStatusServices['getPlatformConfig'],
  buildFeishuWebhookStatus: buildFeishuWebhookStatus as ImStatusServices['buildFeishuWebhookStatus'],
};

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return toNextResponse(handleImWebhookStatusGet(searchParams, services));
}
