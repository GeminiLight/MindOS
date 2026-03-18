export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readSettings } from '@/lib/settings';

export async function GET() {
  try {
    const settings = readSettings();
    const port = settings.mcpPort ?? 8781;
    const baseUrl = `http://127.0.0.1:${port}`;
    const endpoint = `${baseUrl}/mcp`;
    const authConfigured = !!settings.authToken;

    let running = false;

    try {
      // Use the health endpoint — avoids MCP handshake complexity
      const healthUrl = `${baseUrl}/api/health`;
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
      toolCount: running ? 20 : 0,
      authConfigured,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
