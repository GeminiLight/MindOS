export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createConnection } from 'net';

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const cleanup = (result: boolean) => { sock.destroy(); resolve(result); };
    sock.setTimeout(500, () => cleanup(false));
    sock.once('connect', () => cleanup(true));
    sock.once('error', (err: NodeJS.ErrnoException) => {
      // ECONNREFUSED = port open but no listener → not in use
      // Other errors (EACCES, ENETUNREACH) = treat as unavailable to be safe
      resolve(err.code !== 'ECONNREFUSED');
    });
  });
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
      return NextResponse.json({ available: true });
    }
    const suggestion = await findFreePort(port + 1);
    return NextResponse.json({ available: false, suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
