export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function POST(req: Request) {
  try {
    const { seed } = await req.json().catch(() => ({} as { seed?: string }));
    let raw: string;
    if (seed && typeof seed === 'string' && seed.trim()) {
      raw = createHash('sha256').update(seed.trim()).digest('hex').slice(0, 24);
    } else {
      raw = randomBytes(12).toString('hex'); // 24 hex chars
    }
    // Format as xxxx-xxxx-xxxx-xxxx-xxxx-xxxx
    const token = raw.match(/.{4}/g)!.join('-');
    return NextResponse.json({ token });
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
