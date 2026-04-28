export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readSettings, writeSettings } from '@/lib/settings';
import { randomBytes } from 'crypto';
import { handleRouteErrorSimple } from '@/lib/errors';

function generateToken(): string {
  const hex = randomBytes(12).toString('hex'); // 24 hex chars
  return (hex.match(/.{4}/g) as string[]).join('-');
}

// POST /api/settings/reset-token — generate a new auth token and persist it
export async function POST() {
  try {
    const current = readSettings();
    const newToken = generateToken();
    writeSettings({ ...current, authToken: newToken });
    return NextResponse.json({ ok: true, token: newToken });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
