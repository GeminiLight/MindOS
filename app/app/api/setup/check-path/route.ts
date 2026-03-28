export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readdirSync } from 'node:fs';
import { expandSetupPathHome } from '../path-utils';

export async function POST(req: NextRequest) {
  try {
    const { path } = await req.json() as { path: string };
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const abs = expandSetupPathHome(path.trim());
    const exists = existsSync(abs);
    let empty = true;
    let count = 0;
    if (exists) {
      try {
        const entries = readdirSync(abs).filter(e => !e.startsWith('.'));
        count = entries.length;
        empty = count === 0;
      } catch {
        // unreadable — treat as non-empty
        empty = false;
      }
    }
    return NextResponse.json({ exists, empty, count });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
