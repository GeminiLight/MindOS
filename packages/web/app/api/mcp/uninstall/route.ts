export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MCP_AGENTS, expandHome } from '@/lib/mcp-agents';
import { handleRouteErrorSimple } from '@/lib/errors';

/** Parse JSONC — strips comments before JSON.parse. Returns {} for empty/whitespace-only input. */
function parseJsonc(text: string): Record<string, unknown> {
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (m, g) => g ? '' : m);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.trim()) return {};
  return JSON.parse(stripped);
}

/** Navigate a dot-path (e.g. "mcp.servers") and return the leaf container, or null. */
function getNestedPath(obj: Record<string, unknown>, dotPath: string): Record<string, unknown> | null {
  const parts = dotPath.split('.').filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return (current && typeof current === 'object') ? current as Record<string, unknown> : null;
}

/** Remove a [section.server] block from a TOML file */
function removeTomlEntry(existing: string, sectionKey: string, serverName: string): string {
  const sectionHeader = `[${sectionKey}.${serverName}]`;
  const envHeader = `[${sectionKey}.${serverName}.env]`;
  const headersHeader = `[${sectionKey}.${serverName}.headers]`;

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

  // Clean up consecutive blank lines
  const cleaned: string[] = [];
  for (const line of result) {
    if (line.trim() === '' && cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '') continue;
    cleaned.push(line);
  }

  return cleaned.join('\n');
}

interface UninstallRequest {
  agents: Array<{
    key: string;
    scope: 'project' | 'global';
  }>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UninstallRequest;
    const { agents } = body;
    const results: Array<{
      agent: string;
      status: string;
      path?: string;
      message?: string;
    }> = [];

    for (const item of agents) {
      const { key, scope } = item;
      const agent = MCP_AGENTS[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      const isGlobal = scope === 'global';
      const configPath = isGlobal ? agent.global : agent.project;
      if (!configPath) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      const absPath = expandHome(configPath);

      if (!fs.existsSync(absPath)) {
        results.push({ agent: key, status: 'ok', message: 'Config file does not exist' });
        continue;
      }

      try {
        if (agent.format === 'toml') {
          const existing = fs.readFileSync(absPath, 'utf-8');
          const updated = removeTomlEntry(existing, agent.key, 'mindos');
          fs.writeFileSync(absPath, updated, 'utf-8');
        } else {
          const config = parseJsonc(fs.readFileSync(absPath, 'utf-8'));

          // Handle nested keys (e.g. VS Code: mcp.servers)
          const useNestedKey = isGlobal && agent.globalNestedKey;
          const container = useNestedKey
            ? getNestedPath(config, agent.globalNestedKey!)
            : (config[agent.key] as Record<string, unknown> | undefined);

          if (container && 'mindos' in container) {
            delete container.mindos;
            fs.writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
          }
        }

        results.push({ agent: key, status: 'ok', path: configPath });
      } catch (err) {
        results.push({ agent: key, status: 'error', message: String(err) });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
