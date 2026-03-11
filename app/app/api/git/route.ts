export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { isGitRepo, gitLog, gitShowFile } from '@/lib/fs';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// GET /api/git?op=is_repo|history|show&path=x&limit=10&commit=abc
export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op') ?? 'is_repo';

  try {
    switch (op) {
      case 'is_repo': {
        return NextResponse.json({ isRepo: isGitRepo() });
      }

      case 'history': {
        const filePath = req.nextUrl.searchParams.get('path');
        if (!filePath) return err('missing path');
        const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10);
        const entries = gitLog(filePath, limit);
        return NextResponse.json({ entries });
      }

      case 'show': {
        const filePath = req.nextUrl.searchParams.get('path');
        const commit = req.nextUrl.searchParams.get('commit');
        if (!filePath) return err('missing path');
        if (!commit) return err('missing commit');
        const content = gitShowFile(filePath, commit);
        return NextResponse.json({ content });
      }

      default:
        return err(`unknown op: ${op}`);
    }
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
