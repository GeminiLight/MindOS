export const dynamic = 'force-dynamic';

import { handleMcpToolsGet } from '@geminilight/mindos/server';
import { readMcpConfig, readMcpToolCache } from '@/lib/pi-integration/mcp-config';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET() {
  return toNextResponse(handleMcpToolsGet({
    readMcpConfig,
    readMcpToolCache,
  }));
}
