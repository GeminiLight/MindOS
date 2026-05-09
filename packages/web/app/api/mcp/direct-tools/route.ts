export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { handleMcpDirectToolsPost } from '@geminilight/mindos/server';
import { updateServerDirectTools } from '@/lib/pi-integration/mcp-config';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  return toNextResponse(handleMcpDirectToolsPost(await req.json(), {
    updateServerDirectTools,
  }));
}
