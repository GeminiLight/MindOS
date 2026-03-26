export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MCP_AGENTS, expandHome } from '@/lib/mcp-agents';

/** Parse JSONC — strips single-line (//) and block comments before JSON.parse */
function parseJsonc(text: string): Record<string, unknown> {
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (m, g) => g ? '' : m);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped);
}

/** Ensure nested object path exists and return the leaf container */
function ensureNestedPath(obj: Record<string, unknown>, dotPath: string): Record<string, unknown> {
  const parts = dotPath.split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  return current;
}

/** Generate a TOML section string for an MCP entry */
function buildTomlEntry(sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`[${sectionKey}.${serverName}]`);
  if (entry.type) lines.push(`type = "${entry.type}"`);
  if (entry.command) lines.push(`command = "${entry.command}"`);
  if (entry.url) lines.push(`url = "${entry.url}"`);
  if (Array.isArray(entry.args)) {
    lines.push(`args = [${entry.args.map(a => `"${a}"`).join(', ')}]`);
  }
  if (entry.env && typeof entry.env === 'object') {
    lines.push('');
    lines.push(`[${sectionKey}.${serverName}.env]`);
    for (const [k, v] of Object.entries(entry.env)) {
      lines.push(`${k} = "${v}"`);
    }
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('');
    lines.push(`[${sectionKey}.${serverName}.headers]`);
    for (const [k, v] of Object.entries(entry.headers)) {
      lines.push(`${k} = "${v}"`);
    }
  }
  return lines.join('\n');
}

/** Replace or append a [section.server] block in a TOML file */
function mergeTomlEntry(existing: string, sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const sectionHeader = `[${sectionKey}.${serverName}]`;
  const envHeader = `[${sectionKey}.${serverName}.env]`;
  const headersHeader = `[${sectionKey}.${serverName}.headers]`;
  const newBlock = buildTomlEntry(sectionKey, serverName, entry);

  const lines = existing.split('\n');
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader || trimmed === envHeader || trimmed === headersHeader) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith('[')) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  // Remove trailing blank lines before appending
  while (result.length > 0 && result[result.length - 1].trim() === '') {
    result.pop();
  }
  result.push('');
  result.push(newBlock);
  result.push('');

  return result.join('\n');
}

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
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (agent.format === 'toml') {
          // TOML format (e.g. Codex): merge into existing TOML or generate new
          const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';
          const merged = mergeTomlEntry(existing, agent.key, 'mindos', entry as Record<string, unknown>);
          fs.writeFileSync(absPath, merged, 'utf-8');
        } else {
          // JSON format (default)
          let config: Record<string, unknown> = {};
          if (fs.existsSync(absPath)) {
            config = parseJsonc(fs.readFileSync(absPath, 'utf-8'));
          }

          // For global scope with nested key (e.g. VS Code: mcp.servers),
          // write to the nested path instead of the flat key
          const useNestedKey = isGlobal && agent.globalNestedKey;
          const container = useNestedKey
            ? ensureNestedPath(config, agent.globalNestedKey!)
            : (() => { if (!config[agent.key]) config[agent.key] = {}; return config[agent.key] as Record<string, unknown>; })();
          container.mindos = entry;

          fs.writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        }

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
