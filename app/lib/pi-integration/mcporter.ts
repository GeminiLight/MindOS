import os from 'os';
import path from 'path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  createRuntime,
  createCallResult,
  type Runtime,
  type ServerToolInfo,
} from 'mcporter';

export interface McporterServerSummary {
  name: string;
  status: string;
  durationMs?: number;
  transport?: string;
  error?: string;
  issue?: { kind?: string; rawMessage?: string };
  source?: { kind?: string; path?: string; importKind?: string };
  tools?: McporterToolSummary[];
}

export interface McporterToolSummary {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  options?: Array<Record<string, unknown>>;
}

export interface McporterServerList {
  mode?: string;
  counts?: Record<string, number>;
  servers: McporterServerSummary[];
}

function textResult(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text }], details: {} };
}

function normalizeNameSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'tool';
}

function toToolSchema(inputSchema?: Record<string, unknown>) {
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return Type.Object({}, { additionalProperties: true });
  }
  return Type.Unsafe(inputSchema as any);
}

export function extractJsonObject(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('Failed to parse mcporter output as JSON');
  }
  return text.slice(first, last + 1);
}

// ─── Singleton mcporter Runtime ──────────────────────────────────────────────

const MCP_CONFIG_PATH = path.join(os.homedir(), '.mindos', 'mcp.json');
const TOOL_TIMEOUT_MS = 30_000;

let _runtime: Runtime | null = null;
let _runtimePromise: Promise<Runtime | null> | null = null;

async function getRuntime(): Promise<Runtime | null> {
  if (_runtime) return _runtime;
  if (_runtimePromise) return _runtimePromise;

  _runtimePromise = (async () => {
    try {
      const rt = await createRuntime({
        configPath: MCP_CONFIG_PATH,
        clientInfo: { name: 'mindos', version: '1.0.0' },
      });
      _runtime = rt;
      return rt;
    } catch (err) {
      console.warn('[mcporter] Failed to create runtime:', err instanceof Error ? err.message : err);
      _runtimePromise = null;
      return null;
    }
  })();
  return _runtimePromise;
}

if (typeof process !== 'undefined') {
  const cleanup = () => {
    if (_runtime) {
      _runtime.close().catch(() => {});
      _runtime = null;
      _runtimePromise = null;
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

export async function listMcporterServers(): Promise<McporterServerList> {
  const rt = await getRuntime();
  if (!rt) return { servers: [] };

  try {
    const names = rt.listServers();
    if (names.length === 0) return { servers: [] };

    const servers: McporterServerSummary[] = await Promise.all(
      names.map(async (name) => {
        try {
          const def = rt.getDefinition(name);
          const transport = def.command.kind;
          const tools = await rt.listTools(name, { includeSchema: false });
          return {
            name,
            status: 'ok',
            transport,
            tools: tools.map(toToolSummary),
          };
        } catch (err) {
          return {
            name,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    return { servers };
  } catch (err) {
    console.warn('[mcporter] listServers failed:', err instanceof Error ? err.message : err);
    return { servers: [] };
  }
}

function toToolSummary(tool: ServerToolInfo): McporterToolSummary {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
  };
}

export async function listMcporterTools(serverName: string): Promise<McporterServerSummary> {
  const rt = await getRuntime();
  if (!rt) return { name: serverName, status: 'not_configured', tools: [] };

  try {
    const tools = await rt.listTools(serverName, { includeSchema: true });
    return {
      name: serverName,
      status: 'ok',
      tools: tools.map(toToolSummary),
    };
  } catch (err) {
    return {
      name: serverName,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      tools: [],
    };
  }
}

export async function callMcporterTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const rt = await getRuntime();
  if (!rt) throw new Error(`MCP runtime not available. Ensure ~/.mindos/mcp.json is configured.`);

  const raw = await rt.callTool(serverName, toolName, {
    args,
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  const result = createCallResult(raw);
  return result.text('\n') ?? JSON.stringify(raw);
}

export function createMcporterAgentTools(servers: McporterServerSummary[]): AgentTool<any>[] {
  const seenNames = new Set<string>();
  const tools: AgentTool<any>[] = [];

  for (const server of servers) {
    if (server.status !== 'ok' || !server.tools?.length) continue;

    for (const tool of server.tools) {
      const baseName = `mcp__${normalizeNameSegment(server.name)}__${normalizeNameSegment(tool.name)}`;
      let name = baseName;
      let suffix = 2;
      while (seenNames.has(name)) {
        name = `${baseName}_${suffix++}`;
      }
      seenNames.add(name);

      tools.push({
        name,
        label: `MCP ${server.name}: ${tool.name}`,
        description: `MCP tool "${tool.name}" from server "${server.name}".${tool.description ? ` ${tool.description}` : ''}`,
        parameters: toToolSchema(tool.inputSchema),
        execute: async (_toolCallId, params) => {
          try {
            const output = await callMcporterTool(server.name, tool.name, (params ?? {}) as Record<string, unknown>);
            return textResult(output || '(empty MCP response)');
          } catch (error) {
            return textResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      });
    }
  }

  return tools;
}
