export const dynamic = 'force-dynamic';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { NextRequest, NextResponse } from 'next/server';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

const STORE_PATH = path.resolve(os.homedir(), '.mindos', 'sessions.json');
const MAX_SESSIONS = 30;

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function readSessions(): ChatSession[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages));
  } catch {
    return [];
  }
}

function writeSessions(sessions: ChatSession[]) {
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(sessions.slice(0, MAX_SESSIONS), null, 2), 'utf-8');
}

export async function GET() {
  const sessions = readSessions()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  let body: { session?: ChatSession };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const session = body.session;
  if (!session || typeof session.id !== 'string' || !Array.isArray(session.messages)) {
    return NextResponse.json({ error: 'Invalid session payload' }, { status: 400 });
  }

  const sessions = readSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  writeSessions(sessions);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let body: { id?: string; ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Support both single id and bulk ids
  const idsToDelete = body.ids ?? (body.id ? [body.id] : []);
  if (idsToDelete.length === 0) return NextResponse.json({ error: 'id or ids is required' }, { status: 400 });

  const deleteSet = new Set(idsToDelete);
  const sessions = readSessions().filter((s) => !deleteSet.has(s.id));
  writeSessions(sessions);
  return NextResponse.json({ ok: true });
}
