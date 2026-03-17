export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MCP_AGENTS, expandHome } from '@/lib/mcp-agents';

interface AgentInstallItem {
  key: string;
  scope: 'project' | 'global';
  transport?: 'stdio' | 'http';
}

interface InstallRequest {
  agents: AgentInstallItem[];
  transport: 'stdio' | 'http' | 'auto';
  url?: string;
  token?: string;
}

function buildEntry(transport: string, url?: string, token?: string) {
  if (transport === 'stdio') {
    return { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };
  }
  const entry: Record<string, unknown> = { url: url || 'http://localhost:8781/mcp' };
  if (token) entry.headers = { Authorization: `Bearer ${token}` };
  return entry;
}

async function verifyHttpConnection(url: string, token?: string): Promise<{ verified: boolean; verifyError?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) return { verified: true };
    return { verified: false, verifyError: `HTTP ${res.status}` };
  } catch (err) {
    return { verified: false, verifyError: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InstallRequest;
    const { agents, transport: globalTransport, url, token } = body;
    const results: Array<{
      agent: string;
      status: string;
      path?: string;
      message?: string;
      transport?: string;
      verified?: boolean;
      verifyError?: string;
    }> = [];

    for (const item of agents) {
      const { key, scope } = item;
      const agent = MCP_AGENTS[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      // Resolve effective transport: agent-level > global-level > auto (use preferredTransport)
      let effectiveTransport: 'stdio' | 'http';
      if (item.transport && item.transport !== 'auto' as string) {
        effectiveTransport = item.transport;
      } else if (globalTransport && globalTransport !== 'auto') {
        effectiveTransport = globalTransport;
      } else {
        effectiveTransport = agent.preferredTransport;
      }

      const entry = buildEntry(effectiveTransport, url, token);
      const isGlobal = scope === 'global';
      const configPath = isGlobal ? agent.global : agent.project;
      if (!configPath) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      const absPath = expandHome(configPath);

      try {
        // Read existing config
        let config: Record<string, unknown> = {};
        if (fs.existsSync(absPath)) {
          config = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
        }

        // Merge — only touch mcpServers.mindos
        if (!config[agent.key]) config[agent.key] = {};
        (config[agent.key] as Record<string, unknown>).mindos = entry;

        // Write
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

        const result: typeof results[number] = { agent: key, status: 'ok', path: configPath, transport: effectiveTransport };

        // Verify http connections
        if (effectiveTransport === 'http') {
          const mcpUrl = (entry as Record<string, unknown>).url as string;
          const verification = await verifyHttpConnection(mcpUrl, token);
          result.verified = verification.verified;
          if (verification.verifyError) result.verifyError = verification.verifyError;
        }

        results.push(result);
      } catch (err) {
        results.push({ agent: key, status: 'error', message: String(err) });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
