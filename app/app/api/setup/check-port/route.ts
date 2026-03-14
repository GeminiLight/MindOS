export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createConnection } from 'net';

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const cleanup = (result: boolean) => { sock.destroy(); resolve(result); };
    sock.setTimeout(500, () => cleanup(true));
    sock.once('connect', () => cleanup(true));
    sock.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code !== 'ECONNREFUSED');
    });
  });
}

async function isSelfPort(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return false;
    const data = await res.json() as Record<string, unknown>;
    return data.service === 'mindos';
  } catch {
    return false;
  }
}

async function findFreePort(start: number): Promise<number | null> {
  for (let p = start; p <= 65535; p++) {
    if (!await isPortInUse(p)) return p;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { port } = await req.json() as { port: number };
    if (!port || port < 1024 || port > 65535) {
      return NextResponse.json({ error: 'Invalid port' }, { status: 400 });
    }
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return NextResponse.json({ available: true, isSelf: false });
    }
    // Port is occupied — check if it's this MindOS instance
    const self = await isSelfPort(port);
    if (self) {
      return NextResponse.json({ available: true, isSelf: true });
    }
    const suggestion = await findFreePort(port + 1);
    return NextResponse.json({ available: false, isSelf: false, suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
