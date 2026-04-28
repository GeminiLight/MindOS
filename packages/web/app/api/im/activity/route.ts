import { NextRequest, NextResponse } from 'next/server';
import { getActivities } from '@/lib/im/activity';
import type { IMPlatform } from '@/lib/im/types';

const VALID_PLATFORMS: IMPlatform[] = [
  'telegram', 'discord', 'feishu', 'slack', 'wecom', 'dingtalk', 'wechat', 'qq',
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const limitParam = searchParams.get('limit');

  if (!platform || !VALID_PLATFORMS.includes(platform as IMPlatform)) {
    return NextResponse.json({ error: 'Invalid or missing platform parameter' }, { status: 400 });
  }

  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;
  const activities = getActivities(platform as IMPlatform, limit);

  return NextResponse.json({ activities });
}
