import { NextResponse } from 'next/server';
import { listConfiguredIM } from '@/lib/im/executor';
import { hasAnyIMConfig } from '@/lib/im/config';

export async function GET() {
  try {
    if (!hasAnyIMConfig()) {
      return NextResponse.json({ platforms: [] });
    }
    const platforms = await listConfiguredIM();
    return NextResponse.json({ platforms });
  } catch (error) {
    console.error('[im/status] Error:', error);
    return NextResponse.json({ platforms: [], error: 'Failed to fetch IM status' }, { status: 500 });
  }
}
