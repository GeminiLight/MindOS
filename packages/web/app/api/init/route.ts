import { NextRequest, NextResponse } from 'next/server';
import { getMindRoot } from '@/lib/fs';
import { applyTemplate } from '@/lib/template';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const template = body.template as string;

    const mindRoot = getMindRoot();
    applyTemplate(template, mindRoot);

    return NextResponse.json({ ok: true, template });
  } catch (e) {
    console.error('[/api/init] Error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith('Invalid template') ? 400
      : msg.includes('not found') ? 404
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
