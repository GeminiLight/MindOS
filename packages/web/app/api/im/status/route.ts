import { NextResponse } from 'next/server';
import { listConfiguredIM } from '@/lib/im/executor';
import { getPlatformConfig, hasAnyIMConfig } from '@/lib/im/config';
import { buildFeishuWebhookStatus } from '@/lib/im/webhook/feishu';

export async function GET() {
  try {
    if (!hasAnyIMConfig()) {
      return NextResponse.json({ platforms: [] });
    }
    const platforms = await listConfiguredIM();
    const feishuConfig = getPlatformConfig('feishu');
    const feishuWebhook = buildFeishuWebhookStatus(feishuConfig);
    const enriched = platforms.map((platform) => (
      platform.platform === 'feishu'
        ? { ...platform, webhook: feishuWebhook }
        : platform
    ));
    return NextResponse.json({ platforms: enriched });
  } catch (error) {
    console.error('[im/status] Error:', error);
    return NextResponse.json({ platforms: [], error: 'Failed to fetch IM status' }, { status: 500 });
  }
}
