export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { readSettings } from '@/lib/settings';
import { maskToken } from '@/lib/format';
import { networkInterfaces } from 'os';

/** Parse hostname from Host header, handling IPv6 brackets */
function parseHostname(host: string): string {
  if (host.includes(']')) {
    return host.slice(0, host.lastIndexOf(']') + 1);
  }
  const colonIdx = host.lastIndexOf(':');
  return colonIdx > 0 ? host.slice(0, colonIdx) : host;
}

/** Get first non-internal IPv4 address */
function getLocalIP(): string | null {
  try {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const settings = readSettings();
    const port = Number(process.env.MINDOS_MCP_PORT) || settings.mcpPort || 8781;
    const token = settings.authToken ?? '';
    const authConfigured = !!token;

    // Derive endpoint from the request's host so remote users see the correct IP/hostname
    const reqHost = req.headers.get('host') ?? `127.0.0.1:${port}`;
    const hostname = parseHostname(reqHost);
    const endpoint = `http://${hostname}:${port}/mcp`;

    // Health check always goes to localhost (server-to-self)
    const healthUrl = `http://127.0.0.1:${port}/api/health`;

    let running = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(healthUrl, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as { ok?: boolean; service?: string };
        running = data.ok === true && data.service === 'mindos';
      }
    } catch {
      // Connection refused or timeout — not running
    }

    return NextResponse.json({
      running,
      transport: 'http',
      endpoint,
      port,
      toolCount: running ? 24 : 0,
      authConfigured,
      maskedToken: authConfigured ? maskToken(token) : undefined,
      authToken: authConfigured ? token : undefined,
      localIP: getLocalIP(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
