export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { handleSetupCheckPort } from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  try {
    return toNextResponse(await handleSetupCheckPort(await req.json(), {
      myWebPort: parseInt(req.nextUrl.port || '0', 10),
      myMcpPort: Number(process.env.MINDOS_MCP_PORT) || 0,
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
