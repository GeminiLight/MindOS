export const dynamic = 'force-dynamic';

import {
  handleAskSessionsDelete,
  handleAskSessionsGet,
  handleAskSessionsPost,
} from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { toNextResponse } from '../_mindos-adapter';

export function GET() {
  return toNextResponse(handleAskSessionsGet());
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  return toNextResponse(handleAskSessionsPost(body));
}

export async function DELETE(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  return toNextResponse(handleAskSessionsDelete(body));
}
