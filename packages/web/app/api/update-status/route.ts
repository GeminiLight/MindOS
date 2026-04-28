export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const STATUS_PATH = resolve(homedir(), '.mindos', 'update-status.json');

const IDLE_RESPONSE = { stage: 'idle', stages: [], error: null, version: null, startedAt: null };

export async function GET() {
  try {
    const raw = readFileSync(STATUS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(IDLE_RESPONSE);
  }
}
