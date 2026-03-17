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

async function findFreePort(start: number, selfPorts: Set<number>): Promise<number | null> {
  for (let p = start; p <= 65535; p++) {
    if (selfPorts.has(p)) continue;
    if (!await isPortInUse(p)) return p;
  }
  return null;
}

/**
 * The port this MindOS web server is actually listening on.
 * Derived from the incoming request URL — always reliable, no network round-trip.
 *
 * Note: We intentionally do NOT read settings here. Settings contain *configured*
 * ports (webPort / mcpPort), which may not actually be listening yet (e.g. during
 * first onboard, or if MCP server hasn't started). Treating configured-but-not-
 * listening ports as "self" would mask real conflicts.
 */
function getListeningPort(req: NextRequest): number {
  return parseInt(req.nextUrl.port || '0', 10);
}

export async function POST(req: NextRequest) {
  try {
    const { port } = await req.json() as { port: number };
    if (!port || port < 1024 || port > 65535) {
      return NextResponse.json({ error: 'Invalid port' }, { status: 400 });
    }

    const myPort = getListeningPort(req);

    // Fast path: if checking the port we're currently listening on, skip network round-trip
    if (myPort > 0 && port === myPort) {
      return NextResponse.json({ available: true, isSelf: true });
    }

    const inUse = await isPortInUse(port);
    if (!inUse) {
      return NextResponse.json({ available: true, isSelf: false });
    }
    // Port is occupied — check if it's another MindOS instance
    const self = await isSelfPort(port);
    if (self) {
      return NextResponse.json({ available: true, isSelf: true });
    }
    const skipPorts = new Set<number>();
    if (myPort > 0) skipPorts.add(myPort);
    const suggestion = await findFreePort(port + 1, skipPorts);
    return NextResponse.json({ available: false, isSelf: false, suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
