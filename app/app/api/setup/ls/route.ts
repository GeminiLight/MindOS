export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
}

export async function POST(req: NextRequest) {
  try {
    const { path } = await req.json() as { path: string };
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ dirs: [] });
    }
    const abs = expandHome(path.trim());
    if (!existsSync(abs)) {
      return NextResponse.json({ dirs: [] });
    }
    try {
      const entries = readdirSync(abs)
        .filter(e => !e.startsWith('.'))
        .filter(e => {
          try { return statSync(join(abs, e)).isDirectory(); } catch { return false; }
        })
        .sort()
        .slice(0, 20);
      return NextResponse.json({ dirs: entries });
    } catch {
      return NextResponse.json({ dirs: [] });
    }
  } catch {
    return NextResponse.json({ dirs: [] });
  }
}
