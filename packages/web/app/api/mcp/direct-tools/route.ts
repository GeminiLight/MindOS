export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { updateServerDirectTools } from '@/lib/pi-integration/mcp-config';
import { handleRouteErrorSimple } from '@/lib/errors';

/**
 * POST /api/mcp/direct-tools
 *
 * Update the directTools setting for a specific MCP server.
 * Body: { server: string, directTools: true | string[] | false }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { server?: string; directTools?: boolean | string[] | false };

    if (!body.server || typeof body.server !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "server" field' }, { status: 400 });
    }

    const dt = body.directTools;
    if (dt !== true && dt !== false && !Array.isArray(dt)) {
      return NextResponse.json({ error: '"directTools" must be true, false, or string[]' }, { status: 400 });
    }

    if (Array.isArray(dt) && !dt.every((s) => typeof s === 'string')) {
      return NextResponse.json({ error: '"directTools" array must contain only strings' }, { status: 400 });
    }

    updateServerDirectTools(body.server, dt);

    return NextResponse.json({ ok: true, server: body.server, directTools: dt });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
