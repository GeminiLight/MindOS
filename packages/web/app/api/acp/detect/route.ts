export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { detectLocalAcpAgents, type InstalledAgent, type NotInstalledAgent } from '@/lib/acp/detect-local';
import { handleRouteErrorSimple } from '@/lib/errors';

const DETECT_CACHE_TTL_MS = 30 * 60 * 1000;
let detectCache: { data: { installed: InstalledAgent[]; notInstalled: NotInstalledAgent[] }; ts: number } | null = null;

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get('force') === '1';
    if (!force && detectCache && Date.now() - detectCache.ts < DETECT_CACHE_TTL_MS) {
      return NextResponse.json(detectCache.data);
    }

    const data = await detectLocalAcpAgents();
    detectCache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
