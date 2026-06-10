import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  handleAgentRuntimesGet,
  type AgentCapabilitiesServices,
  type AgentCapabilityInput,
  type AgentRuntimeDescriptor,
  type AgentRuntimesServices,
  type AgentRuntimesPayload,
} from '@geminilight/mindos/server';
import { knowledgeBaseTools } from './tools';
import {
  MINDOS_CHAT_KB_TOOL_NAMES,
  MINDOS_ORGANIZE_KB_TOOL_NAMES,
  MINDOS_WRITE_TOOL_NAMES,
} from './permission-policy';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { readMcpConfig, readMcpToolCache } from '@/lib/pi-integration/mcp-config';
import { getDiscoveredAgents } from '@/lib/a2a/client';
import { effectiveMindRoot } from '@/lib/mind-root';

type PiSubagentModule = {
  name: string;
  localName?: string;
  description: string;
  source: 'builtin' | 'user' | 'project';
  filePath: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  maxExecutionTimeMs?: number;
  maxTokens?: number;
  interactive?: boolean;
  disabled?: boolean;
};

const CHAT_KB_TOOL_NAMES = new Set<string>(MINDOS_CHAT_KB_TOOL_NAMES);
const ORGANIZE_KB_TOOL_NAMES = new Set<string>(MINDOS_ORGANIZE_KB_TOOL_NAMES);
const WRITE_KB_TOOL_NAMES = new Set<string>(MINDOS_WRITE_TOOL_NAMES);

export function createAgentCapabilitiesServices(): AgentCapabilitiesServices {
  return {
    kb: listKnowledgeToolCapabilities,
    subagents: listPiSubagentCapabilities,
    native: listNativeRuntimeCapabilities,
    acp: listAcpRuntimeCapabilities,
    mcp: listMcpToolCapabilities,
    a2a: listA2aAgentCapabilities,
  };
}

function listKnowledgeToolCapabilities(): AgentCapabilityInput[] {
  return knowledgeBaseTools.map((tool): AgentCapabilityInput => {
    const permissionRequired = permissionForKbTool(tool.name);
    return {
      id: `kb-tool:${tool.name}`,
      kind: 'kb-tool',
      name: tool.label || tool.name,
      description: tool.description,
      source: 'mindos',
      status: 'available',
      permissionRequired,
      availableInModes: modesForPermission(permissionRequired),
      inputKinds: ['json'],
      outputKinds: ['text'],
      supportsStreaming: false,
      supportsCancel: false,
      supportsBackgroundRuns: false,
      supportsApprovals: WRITE_KB_TOOL_NAMES.has(tool.name),
      supportsUserInput: false,
      defaultTimeoutMs: 30_000,
      metadata: {
        toolName: tool.name,
        schema: tool.parameters,
      },
    };
  });
}

async function listPiSubagentCapabilities(): Promise<AgentCapabilityInput[]> {
  const agents = discoverPiSubagents(effectiveMindRoot()).filter((agent) => agent.disabled !== true);

  return agents.map((agent) => ({
    id: `pi-subagent:${agent.source}:${agent.name}`,
    kind: 'pi-subagent',
    name: agent.localName || agent.name,
    description: agent.description || '',
    source: 'pi-subagents',
    status: 'available',
    permissionRequired: 'agent',
    availableInModes: ['agent'],
    inputKinds: ['text', 'files', 'context'],
    outputKinds: ['text', 'structured'],
    supportsStreaming: true,
    supportsCancel: true,
    supportsBackgroundRuns: true,
    supportsApprovals: false,
    supportsUserInput: Boolean(agent.interactive),
    defaultTimeoutMs: typeof agent.maxExecutionTimeMs === 'number' && Number.isFinite(agent.maxExecutionTimeMs)
      ? agent.maxExecutionTimeMs
      : 120_000,
    metadata: {
      agentId: agent.name,
      source: agent.source,
      sourcePath: agent.filePath,
      tools: agent.tools,
      skills: agent.skills,
      model: agent.model,
      maxTokens: agent.maxTokens,
    },
  }));
}

async function listNativeRuntimeCapabilities(): Promise<AgentCapabilityInput[]> {
  const runtimes = await loadRuntimeDescriptors();
  return runtimes
    .filter((runtime) => runtime.kind === 'codex' || runtime.kind === 'claude' || runtime.kind === 'mindos')
    .map(runtimeToCapability);
}

async function listAcpRuntimeCapabilities(): Promise<AgentCapabilityInput[]> {
  const runtimes = await loadRuntimeDescriptors();
  return runtimes
    .filter((runtime) => runtime.kind === 'acp')
    .map(runtimeToCapability);
}

function listMcpToolCapabilities(): AgentCapabilityInput[] {
  const config = readMcpConfig();
  const cache = readMcpToolCache();
  return Object.entries(config.mcpServers ?? {}).flatMap(([serverName, entry]) => {
    const serverCache = cache?.[serverName];
    const tools = serverCache?.tools ?? [];
    return tools.map((tool) => ({
      id: `mcp-tool:${serverName}:${tool.name}`,
      kind: 'mcp-tool',
      name: tool.name,
      description: tool.description ?? '',
      source: 'mcp',
      status: serverCache ? 'cached' : 'available',
      permissionRequired: 'agent',
      availableInModes: ['agent'],
      inputKinds: ['json'],
      outputKinds: ['text', 'structured'],
      supportsStreaming: false,
      supportsCancel: true,
      supportsBackgroundRuns: false,
      supportsApprovals: true,
      supportsUserInput: false,
      defaultTimeoutMs: 30_000,
      metadata: {
        serverName,
        toolName: tool.name,
        directTools: entry.directTools ?? false,
        lifecycle: entry.lifecycle ?? 'lazy',
        cached: Boolean(serverCache),
      },
    }));
  });
}

function listA2aAgentCapabilities(): AgentCapabilityInput[] {
  return getDiscoveredAgents().map((agent) => ({
    id: `a2a-agent:${agent.id}`,
    kind: 'a2a-agent',
    name: agent.card.name,
    description: agent.card.description,
    source: 'a2a',
    status: agent.reachable ? 'available' : 'error',
    permissionRequired: 'agent',
    availableInModes: ['agent'],
    inputKinds: agent.card.defaultInputModes,
    outputKinds: agent.card.defaultOutputModes,
    supportsStreaming: agent.card.capabilities.streaming,
    supportsCancel: true,
    supportsBackgroundRuns: true,
    supportsApprovals: false,
    supportsUserInput: true,
    defaultTimeoutMs: 30_000,
    metadata: {
      agentId: agent.id,
      endpoint: agent.endpoint,
      provider: agent.card.provider,
      skills: agent.card.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
      })),
      discoveredAt: agent.discoveredAt,
    },
  }));
}

async function loadRuntimeDescriptors(): Promise<AgentRuntimeDescriptor[]> {
  const services: AgentRuntimesServices = {
    readSettings: readSettings as AgentRuntimesServices['readSettings'],
    detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
    resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
    checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
  };
  const response = await handleAgentRuntimesGet(new URLSearchParams(), {
    ...services,
  });
  if (response.status !== 200 || !response.body || !('runtimes' in response.body)) {
    throw new Error('Could not load agent runtime descriptors.');
  }
  return (response.body as AgentRuntimesPayload).runtimes;
}

function runtimeToCapability(runtime: AgentRuntimeDescriptor): AgentCapabilityInput {
  return {
    id: `native-runtime:${runtime.kind}:${runtime.id}`,
    kind: runtime.kind === 'acp' ? 'acp-agent' : 'native-runtime',
    name: runtime.name,
    description: runtime.description ?? '',
    source: runtime.kind === 'acp' ? 'acp' : 'native',
    status: runtime.status === 'available'
      ? 'available'
      : runtime.status === 'missing'
        ? 'missing'
        : 'error',
    permissionRequired: runtime.kind === 'mindos' ? 'readonly' : 'agent',
    availableInModes: runtime.kind === 'mindos' ? ['chat', 'organize', 'agent'] : ['agent'],
    inputKinds: ['text', 'files', 'context'],
    outputKinds: ['text', 'tool-events'],
    supportsStreaming: true,
    supportsCancel: runtime.capabilities.supportsInterrupt,
    supportsBackgroundRuns: runtime.capabilities.supportsBackgroundRuns,
    supportsApprovals: runtime.capabilities.supportsApprovals,
    supportsUserInput: runtime.capabilities.supportsUserInput,
    defaultTimeoutMs: 120_000,
    metadata: {
      runtimeKind: runtime.kind,
      runtimeId: runtime.id,
      adapter: runtime.adapter,
      aliases: runtime.aliases,
      sourceAgentId: runtime.sourceAgentId,
      canonicalAgentId: runtime.canonicalAgentId,
      mcpAgentKey: runtime.mcpAgentKey,
      capabilities: runtime.capabilities,
      availability: runtime.availability,
      binaryPath: runtime.binaryPath?.startsWith('sdk:') ? runtime.binaryPath : undefined,
      installCmd: runtime.installCmd,
      packageName: runtime.packageName,
    },
  };
}

function permissionForKbTool(toolName: string): 'readonly' | 'organize' | 'agent' {
  if (CHAT_KB_TOOL_NAMES.has(toolName)) return 'readonly';
  if (ORGANIZE_KB_TOOL_NAMES.has(toolName)) return 'organize';
  return 'agent';
}

function modesForPermission(permission: 'readonly' | 'organize' | 'agent'): Array<'chat' | 'organize' | 'agent'> {
  if (permission === 'readonly') return ['chat', 'organize', 'agent'];
  if (permission === 'organize') return ['organize', 'agent'];
  return ['agent'];
}

function discoverPiSubagents(cwd: string): PiSubagentModule[] {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const builtinDir = resolvePiSubagentsBuiltinDir(currentDir);
  const userDirs = [
    path.join(os.homedir(), '.pi', 'agent', 'agents'),
    path.join(os.homedir(), '.agents'),
  ];
  const projectRoot = findNearestSubagentProjectRoot(cwd);
  const projectDirs = projectRoot
    ? [path.join(projectRoot, '.pi', 'agents'), path.join(projectRoot, '.agents')]
    : [];

  return [
    ...loadSubagentsFromDir(builtinDir, 'builtin'),
    ...userDirs.flatMap((dir) => loadSubagentsFromDir(dir, 'user')),
    ...projectDirs.flatMap((dir) => loadSubagentsFromDir(dir, 'project')),
  ];
}

function resolvePiSubagentsBuiltinDir(currentDir: string): string {
  const candidates = [
    path.resolve(currentDir, '..', '..'),
    process.cwd(),
    path.join(process.cwd(), 'packages', 'web'),
  ];
  for (const base of candidates) {
    const dir = path.join(base, 'node_modules', 'pi-subagents', 'agents');
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(candidates[0], 'node_modules', 'pi-subagents', 'agents');
}

function loadSubagentsFromDir(dir: string, source: PiSubagentModule['source']): PiSubagentModule[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => parseSubagentFile(path.join(dir, entry.name), source))
    .filter((agent): agent is PiSubagentModule => Boolean(agent));
}

function parseSubagentFile(filePath: string, source: PiSubagentModule['source']): PiSubagentModule | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(raw);
    const name = frontmatter.name || path.basename(filePath, path.extname(filePath));
    const description = frontmatter.description;
    if (!name || !description) return null;
    return {
      name,
      localName: name,
      description,
      source,
      filePath,
      ...(frontmatter.tools ? { tools: splitFrontmatterList(frontmatter.tools) } : {}),
      ...(frontmatter.skills ? { skills: splitFrontmatterList(frontmatter.skills) } : {}),
      ...(frontmatter.skill ? { skills: splitFrontmatterList(frontmatter.skill) } : {}),
      ...(frontmatter.model ? { model: frontmatter.model } : {}),
      ...(parsePositiveInteger(frontmatter.maxExecutionTimeMs) ? { maxExecutionTimeMs: parsePositiveInteger(frontmatter.maxExecutionTimeMs) } : {}),
      ...(parsePositiveInteger(frontmatter.maxTokens) ? { maxTokens: parsePositiveInteger(frontmatter.maxTokens) } : {}),
      ...(frontmatter.interactive === 'true' ? { interactive: true } : {}),
      ...(frontmatter.disabled === 'true' ? { disabled: true } : {}),
    };
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = raw.slice(3, end).trim();
  const parsed: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) parsed[key] = value;
  }
  return parsed;
}

function splitFrontmatterList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function findNearestSubagentProjectRoot(cwd: string): string | null {
  let current = cwd;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.pi')) || fs.existsSync(path.join(current, '.agents'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}
