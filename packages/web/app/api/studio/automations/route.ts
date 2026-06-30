export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { homedir } from 'node:os';
import { NextResponse } from 'next/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  mutateStudioAutomations,
  readStudioAutomationPayload,
} from '@/lib/studio-automation-runtime';

function services() {
  return {
    mindRoot: getMindRoot(),
    homeDir: process.env.MINDOS_STUDIO_AUTOMATION_HOME || homedir(),
  };
}

export async function GET() {
  try {
    return NextResponse.json(readStudioAutomationPayload(services()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const result = mutateStudioAutomations(body, services());
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
