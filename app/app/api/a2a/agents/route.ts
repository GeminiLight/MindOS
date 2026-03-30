import { NextResponse } from 'next/server';
import { getDiscoveredAgents } from '@/lib/a2a/client';

export async function GET() {
  const agents = getDiscoveredAgents();
  return NextResponse.json({ agents });
}
