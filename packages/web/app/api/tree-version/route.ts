import { NextResponse } from 'next/server';
import { getTreeVersion } from '@/lib/fs';
import { telemetry } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';

export function GET() {
  const stop = telemetry.startTimer('tree.version.route');
  const v = getTreeVersion();
  stop({ version: v });
  return NextResponse.json({ v });
}
