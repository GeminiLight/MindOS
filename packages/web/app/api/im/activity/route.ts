import { NextRequest } from 'next/server';
import { handleImActivityGet, type ImActivityServices } from '@geminilight/mindos/server';
import { getActivities } from '@/lib/im/activity';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return toNextResponse(handleImActivityGet(searchParams, {
    getActivities: getActivities as ImActivityServices['getActivities'],
  }));
}
