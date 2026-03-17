export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readSettings } from '@/lib/settings';

export async function GET() {
  try {
    const settings = readSettings();
    const port = settings.mcpPort ?? 8781;
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    const authConfigured = !!settings.authToken;

    // Check if MCP server is running
    let running = false;
    let toolCount = 0;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        running = true;
        try {
          const data = await res.json();
          if (data?.result?.tools) toolCount = data.result.tools.length;
        } catch { /* non-JSON response — still running */ }
      }
    } catch {
      // Connection refused or timeout — not running
    }

    return NextResponse.json({
      running,
      transport: 'http',
      endpoint,
      port,
      toolCount,
      authConfigured,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
