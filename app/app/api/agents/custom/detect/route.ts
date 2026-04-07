export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { detectBaseDir } from '@/lib/custom-agents';

/** POST — Auto-detect config files in a baseDir. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { baseDir } = body as { baseDir?: string };

    if (!baseDir?.trim()) {
      return NextResponse.json({ error: 'baseDir is required' }, { status: 400 });
    }

    const dir = baseDir.trim();

    // Security: restrict to home directory only
    if (!dir.startsWith('~/')) {
      return NextResponse.json(
        { error: 'baseDir must start with ~/ (e.g. ~/.qclaw/)' },
        { status: 400 },
      );
    }

    const result = detectBaseDir(dir);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
