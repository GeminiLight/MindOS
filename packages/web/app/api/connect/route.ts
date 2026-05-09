export const dynamic = 'force-dynamic';

import { handleConnectGet } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

/**
 * GET /api/connect
 *
 * Returns the local network URL for mobile app connection.
 */
export function GET() {
  return toNextResponse(handleConnectGet());
}
