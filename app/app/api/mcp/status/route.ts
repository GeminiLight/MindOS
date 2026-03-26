export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { readSettings } from '@/lib/settings';
import { maskToken } from '@/lib/format';

/** Parse hostname from Host header, handling IPv6 brackets */
function parseHostname(host: string): string {
  // IPv6: [::1]:3003 → [::1]
  if (host.includes(']')) {
    return host.slice(0, host.lastIndexOf(']') + 1);
  }
  // IPv4/hostname: 192.168.1.1:3003 → 192.168.1.1
  const colonIdx = host.lastIndexOf(':');
  return colonIdx > 0 ? host.slice(0, colonIdx) : host;
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
      toolCount: running ? 23 : 0,
      authConfigured,
      // Masked for display; full token only used server-side in snippet generation
      maskedToken: authConfigured ? maskToken(token) : undefined,
      // Full token for config snippet copy — this API is protected by proxy.ts middleware
      // (same-origin or bearer token required). Consistent with /api/settings which also
      // exposes the token to authenticated users.
      authToken: authConfigured ? token : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
