export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { MCP_AGENTS, detectInstalled } from '@/lib/mcp-agents';

export async function GET() {
  try {
    const agents = Object.entries(MCP_AGENTS).map(([key, agent]) => {
      const status = detectInstalled(key);
      return {
        key,
        name: agent.name,
        installed: status.installed,
        scope: status.scope,
        transport: status.transport,
        configPath: status.configPath,
        hasProjectScope: !!agent.project,
        hasGlobalScope: !!agent.global,
      };
    });
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
