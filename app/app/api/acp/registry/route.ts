export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchAcpRegistry, findAcpAgent } from '@/lib/acp/registry';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent');

    if (agentId) {
      const agent = await findAcpAgent(agentId);
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found', agent: null }, { status: 404 });
      }
      return NextResponse.json({ agent });
    }

    const registry = await fetchAcpRegistry();
    if (!registry) {
      return NextResponse.json({ error: 'Failed to fetch registry', registry: null }, { status: 502 });
    }

    return NextResponse.json({ registry });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
