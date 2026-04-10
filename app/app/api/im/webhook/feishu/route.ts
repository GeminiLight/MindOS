import { NextRequest, NextResponse } from 'next/server';
import { getPlatformConfig } from '@/lib/im/config';
import { dispatchFeishuWebhook } from '@/lib/im/feishu-dispatcher';

export async function POST(req: NextRequest) {
  try {
    const config = getPlatformConfig('feishu');
    if (!config) {
      return NextResponse.json({ error: 'Feishu is not configured' }, { status: 503 });
    }

    const body = await req.json();
    const headers = Object.fromEntries(req.headers.entries());
    const result = await dispatchFeishuWebhook({
      config,
      body,
      headers,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to handle Feishu webhook' },
      { status: 500 },
    );
  }
}
