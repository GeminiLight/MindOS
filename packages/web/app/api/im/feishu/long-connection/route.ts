import { NextResponse } from 'next/server';
import { getPlatformConfig, readIMConfig, writeIMConfig } from '@/lib/im/config';
import { getFeishuWSClientStatus, startFeishuWSClient, stopFeishuWSClient } from '@/lib/im/feishu-ws-client';

export async function GET() {
  return NextResponse.json({ ok: true, ...getFeishuWSClientStatus() });
}

export async function POST() {
  try {
    const config = getPlatformConfig('feishu');
    if (!config) {
      return NextResponse.json({ ok: false, error: 'Feishu is not configured. Save App ID and App Secret first.' }, { status: 422 });
    }

    // Persist transport=long_connection so it auto-starts on next server boot
    const imConfig = readIMConfig();
    const feishu = (imConfig.providers as Record<string, any>).feishu ?? {};
    feishu.conversation = {
      ...(feishu.conversation ?? {}),
      enabled: true,
      transport: 'long_connection',
    };
    (imConfig.providers as Record<string, any>).feishu = feishu;
    writeIMConfig(imConfig);

    await startFeishuWSClient(config);
    return NextResponse.json({ ok: true, ...getFeishuWSClientStatus() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to start', ...getFeishuWSClientStatus() },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  stopFeishuWSClient();

  // Persist transport back to webhook
  try {
    const imConfig = readIMConfig();
    const feishu = (imConfig.providers as Record<string, any>).feishu;
    if (feishu?.conversation) {
      feishu.conversation.transport = 'webhook';
      writeIMConfig(imConfig);
    }
  } catch {
    // best effort
  }

  return NextResponse.json({ ok: true, ...getFeishuWSClientStatus() });
}
