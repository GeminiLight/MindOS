export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { validatePlatformConfig } from '@/lib/im/config';
import { verifyIMCredentials } from '@/lib/im/verify';
import { handleRouteErrorSimple } from '@/lib/errors';

const SUPPORTED_PLATFORMS = new Set([
  'telegram',
  'discord',
  'feishu',
  'slack',
  'wecom',
  'dingtalk',
  'wechat',
  'qq',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { platform?: string; credentials?: unknown };
    const platform = body.platform;
    const credentials = body.credentials;

    if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
      return NextResponse.json({ ok: false, error: 'Invalid platform' }, { status: 400 });
    }

    if (!credentials || typeof credentials !== 'object') {
      return NextResponse.json({ ok: false, error: 'Missing credentials' }, { status: 400 });
    }

    const validation = validatePlatformConfig(platform as any, credentials);
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: `Missing required fields: ${validation.missing?.join(', ') || 'unknown'}` },
        { status: 400 },
      );
    }

    const result = await verifyIMCredentials(platform as any, credentials);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || 'Credential verification failed' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      botName: result.botName,
      botId: result.botId,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
