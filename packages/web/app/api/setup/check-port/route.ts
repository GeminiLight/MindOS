export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createConnection } from 'net';
import { handleRouteErrorSimple } from '@/lib/errors';

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
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const res = await fetch(`http://${host}:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) continue;
      const data = await res.json() as Record<string, unknown>;
      if (data.service === 'mindos') return true;
    } catch { /* try next host */ }
  }
  return false;
}

async function findFreePort(start: number, selfPorts: Set<number>): Promise<number | null> {
  for (let p = start; p <= 65535; p++) {
    if (selfPorts.has(p)) continue;
    if (!await isPortInUse(p)) return p;
  }
  return null;
}

/**
 * Ports this MindOS instance is known to be using.
 *
 * myWebPort:  derived from the incoming request URL — always reliable.
 * myMcpPort:  from MINDOS_MCP_PORT env var set by CLI / Desktop ProcessManager.
 *
 * We do NOT read ~/.mindos/config.json here. Config contains *configured* ports
 * which may not actually be listening yet (e.g. first onboard before MCP starts).
 * Env vars are only set when a process IS running, so they're safe to trust.
 */
function getKnownPorts(req: NextRequest): { myWebPort: number; myMcpPort: number } {
  return {
    myWebPort: parseInt(req.nextUrl.port || '0', 10),
    myMcpPort: Number(process.env.MINDOS_MCP_PORT) || 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { port } = await req.json() as { port: number };
    if (!port || port < 1024 || port > 65535) {
      return NextResponse.json({ error: 'Invalid port' }, { status: 400 });
    }

    const { myWebPort, myMcpPort } = getKnownPorts(req);

    // Fast path: port belongs to this MindOS instance (deterministic, no network)
    if ((myWebPort > 0 && port === myWebPort) || (myMcpPort > 0 && port === myMcpPort)) {
      return NextResponse.json({ available: true, isSelf: true });
    }

    const inUse = await isPortInUse(port);
    if (!inUse) {
      return NextResponse.json({ available: true, isSelf: false });
    }
    // Port is occupied by something else — check if it's another MindOS instance
    const self = await isSelfPort(port);
    if (self) {
      return NextResponse.json({ available: true, isSelf: true });
    }
    const skipPorts = new Set<number>();
    if (myWebPort > 0) skipPorts.add(myWebPort);
    if (myMcpPort > 0) skipPorts.add(myMcpPort);
    const suggestion = await findFreePort(port + 1, skipPorts);
    return NextResponse.json({ available: false, isSelf: false, suggestion });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
