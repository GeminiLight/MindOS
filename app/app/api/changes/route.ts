import { NextRequest, NextResponse } from 'next/server';
import {
  listContentChanges,
  getContentChangeSummary,
  markContentChangesSeen,
} from '@/lib/fs';

export const dynamic = 'force-dynamic';

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op') ?? 'summary';

  try {
    if (op === 'summary') {
      const summary = getContentChangeSummary();
      return NextResponse.json(summary);
    }

    if (op === 'list') {
      const path = req.nextUrl.searchParams.get('path') ?? undefined;
      const limitParam = req.nextUrl.searchParams.get('limit');
      const limit = limitParam ? Number(limitParam) : 50;
      if (!Number.isFinite(limit) || limit <= 0) return err('invalid limit');
      return NextResponse.json({ events: listContentChanges({ path, limit }) });
    }

    return err(`unknown op: ${op}`);
  } catch (error) {
    return err((error as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('invalid JSON');
  }

  const op = body.op;
  if (typeof op !== 'string') return err('missing op');

  try {
    if (op === 'mark_seen') {
      markContentChangesSeen();
      return NextResponse.json({ ok: true });
    }
    return err(`unknown op: ${op}`);
  } catch (error) {
    return err((error as Error).message, 500);
  }
}
