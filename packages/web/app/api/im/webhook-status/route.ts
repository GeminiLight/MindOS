import { NextRequest, NextResponse } from 'next/server';
import { getPlatformConfig } from '@/lib/im/config';
import { buildFeishuWebhookStatus } from '@/lib/im/webhook/feishu';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');

  if (platform !== 'feishu') {
    return NextResponse.json({ error: 'Invalid or unsupported platform parameter' }, { status: 400 });
  }

  const config = getPlatformConfig('feishu');
  return NextResponse.json({ status: buildFeishuWebhookStatus(config) });
}
