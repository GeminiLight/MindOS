import { NextResponse } from 'next/server';
import { discoverAgent } from '@/lib/a2a/client';

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const agent = await discoverAgent(url);
    if (!agent) {
      return NextResponse.json({ error: 'No A2A agent found', agent: null });
    }

    return NextResponse.json({ agent });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, agent: null },
      { status: 500 },
    );
  }
}
