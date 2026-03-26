import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const execFileAsync = promisify(execFile);
const APP_ROOT = process.env.MINDOS_PROJECT_ROOT ? path.join(process.env.MINDOS_PROJECT_ROOT, 'app') : process.cwd();
const PROJECT_ROOT = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');

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

function resolveMcporterBin(): string {
  const localBin = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'mcporter.cmd' : 'mcporter');
  if (fs.existsSync(localBin)) return localBin;
  return 'mcporter';
}

export function extractJsonObject(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('Failed to parse mcporter output as JSON');
  }
  return text.slice(first, last + 1);
}

async function runMcporter(args: string[]): Promise<string> {
  const bin = resolveMcporterBin();
  const { stdout, stderr } = await execFileAsync(bin, args, {
    cwd: PROJECT_ROOT,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  return `${stdout ?? ''}${stderr ?? ''}`;
}

export async function listMcporterServers(): Promise<McporterServerList> {
  const output = await runMcporter(['list', '--json']);
  return JSON.parse(extractJsonObject(output)) as McporterServerList;
}

export async function listMcporterTools(serverName: string): Promise<McporterServerSummary> {
  const output = await runMcporter(['list', serverName, '--schema', '--json']);
  return JSON.parse(extractJsonObject(output)) as McporterServerSummary;
}

export async function callMcporterTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const output = await runMcporter([
    'call',
    '--server',
    serverName,
    '--tool',
    toolName,
    '--args',
    JSON.stringify(args),
    '--output',
    'markdown',
  ]);
  return output.trim();
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
        description: `Dynamically discovered via mcporter from server "${server.name}". Original MCP tool name: "${tool.name}".${tool.description ? ` ${tool.description}` : ''}`,
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
