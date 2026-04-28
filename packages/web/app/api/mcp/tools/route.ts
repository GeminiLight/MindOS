export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readMcpConfig, readMcpToolCache } from '@/lib/pi-integration/mcp-config';
import { handleRouteErrorSimple } from '@/lib/errors';

/**
 * GET /api/mcp/tools
 *
 * Returns all configured MCP servers with their cached tool lists and
 * current directTools setting. Used by the Settings MCP panel.
 */
export async function GET() {
  try {
    const config = readMcpConfig();
    const cache = readMcpToolCache();

    const servers = Object.entries(config.mcpServers).map(([name, entry]) => {
      const serverCache = cache?.[name];
      const tools = (serverCache?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? '',
      }));

      return {
        name,
        toolCount: tools.length,
        tools,
        directTools: entry.directTools ?? false,
        lifecycle: entry.lifecycle ?? 'lazy',
        cached: !!serverCache,
      };
    });

    return NextResponse.json({ servers });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
