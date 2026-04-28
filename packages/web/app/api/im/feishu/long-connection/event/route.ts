import { NextRequest, NextResponse } from 'next/server';
import { handleFeishuMessageReceiveEvent } from '@/lib/im/webhook/feishu';
import type { FeishuSdkMessageEvent } from '@/lib/im/types';

export async function POST(req: NextRequest) {
  try {
    const event = (await req.json()) as FeishuSdkMessageEvent;
    const result = await handleFeishuMessageReceiveEvent(event);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to process event' },
      { status: 500 },
    );
  }
}
