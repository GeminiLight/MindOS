import { NextRequest, NextResponse } from 'next/server';
import { sendIMMessage } from '@/lib/im/executor';
import type { IMPlatform } from '@/lib/im/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, recipient_id, message } = body;

    if (!platform || !recipient_id || !message) {
      return NextResponse.json({ ok: false, error: 'Missing required fields: platform, recipient_id, message' }, { status: 400 });
    }

    const result = await sendIMMessage({
      platform: platform as IMPlatform,
      recipientId: recipient_id,
      text: message,
      format: 'text',
    });

    if (result.ok) {
      return NextResponse.json({ ok: true, messageId: result.messageId, timestamp: result.timestamp });
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  } catch (error) {
    console.error('[im/test] Error:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
  }
}
