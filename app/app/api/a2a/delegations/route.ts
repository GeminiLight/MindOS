export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDelegationHistory } from '@/lib/a2a/client';

export async function GET() {
  const delegations = getDelegationHistory();
  return NextResponse.json({ delegations });
}
