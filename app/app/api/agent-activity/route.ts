export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { listAgentAuditEvents } from '@/lib/core/agent-audit-log';
import { effectiveSopRoot } from '@/lib/settings';

/**
 * GET /api/agent-activity?limit=10
 * Returns the most recent agent audit events.
 */
export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = Math.max(1, Math.min(Number(limitParam) || 10, 500));

  const root = effectiveSopRoot();
  const events = listAgentAuditEvents(root, limit);

  return NextResponse.json({ events });
}
