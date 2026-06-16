/**
 * Tests for the capability-registry mapping rules (Wave 3,
 * spec-agent-core-consolidation). Migrated from
 * packages/web/__tests__/agent/capability-registry.test.ts; all host IO is
 * injected — builtin pi-subagents come from a mkdtemp directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentCapabilityInput } from '../../server/handlers/agent-capabilities.js';
import {
  createAgentCapabilitiesServices,
  type MindosAgentCapabilityRegistryServices,
} from './capability-registry.js';
import type { MindosAgentTool } from './kb-tools.js';

function makeKbTool(name: string, label = name): MindosAgentTool {
  return {
    name,
    label,
    description: `desc ${name}`,
    parameters: { type: 'object' },
    execute: async () => ({ content: [], details: undefined }),
  };
}

function createServices(overrides: Partial<MindosAgentCapabilityRegistryServices> = {}): MindosAgentCapabilityRegistryServices {
  return {
    knowledgeBaseTools: [],
    effectiveMindRoot: () => '/nonexistent/mind-root',
    readSettings: () => ({}),
    detectLocalAcpAgents: async () => [],
    resolveRuntimeCommand: () => null,
    checkNativeRuntimeHealth: async () => ({ ok: false, message: 'not installed' }),
    readMcpConfig: () => ({}),
    readMcpToolCache: () => null,
    getDiscoveredAgents: () => [],
    resolveBuiltinSubagentsDir: () => null,
    ...overrides,
  } as MindosAgentCapabilityRegistryServices;
}

describe('kb-tool capabilities', () => {
  it('maps permission tiers without promising interactive approvals for KB writes', () => {
    const services = createServices({
      knowledgeBaseTools: [
        makeKbTool('read_file', 'Read file'),
        makeKbTool('write_file', 'Write file'),
        makeKbTool('delete_file', 'Delete file'),
      ],
    });
    const listers = createAgentCapabilitiesServices(services);
    const caps = listers.kb() as AgentCapabilityInput[];
    const byId = new Map(caps.map((cap) => [cap.id, cap]));

    const readFile = byId.get('kb-tool:read_file');
    expect(readFile).toMatchObject({
      kind: 'kb-tool',
      name: 'Read file',
      permissionRequired: 'readonly',
      availableInModes: ['organize', 'agent'],
      supportsApprovals: false,
    });

    const writeFile = byId.get('kb-tool:write_file');
    expect(writeFile).toMatchObject({
      permissionRequired: 'organize',
      availableInModes: ['organize', 'agent'],
      supportsApprovals: false,
    });

    const deleteFile = byId.get('kb-tool:delete_file');
    expect(deleteFile).toMatchObject({
      permissionRequired: 'agent',
      availableInModes: ['agent'],
      supportsApprovals: false,
    });

    expect(readFile?.metadata).toMatchObject({ toolName: 'read_file' });
  });
});

describe('pi-subagent capabilities', () => {
  let builtinDir: string;

  beforeEach(() => {
    builtinDir = mkdtempSync(join(tmpdir(), 'mindos-subagents-'));
  });

  afterEach(() => {
    rmSync(builtinDir, { recursive: true, force: true });
  });

  function builtinCaps(caps: AgentCapabilityInput[]): AgentCapabilityInput[] {
    // User/home directories may legitimately contain subagents on a dev
    // machine; only the injected builtin dir is under test.
    return caps.filter((cap) => cap.id.startsWith('pi-subagent:builtin:'));
  }

  it('discovers builtin subagents from frontmatter without leaking the system prompt', async () => {
    writeFileSync(
      join(builtinDir, 'reviewer.md'),
      [
        '---',
        'name: reviewer',
        'description: Reviews code changes',
        'tools: read_file, search',
        'maxExecutionTimeMs: 60000',
        'interactive: true',
        '---',
        '',
        'SECRET SYSTEM PROMPT BODY',
      ].join('\n'),
    );
    const listers = createAgentCapabilitiesServices(
      createServices({ resolveBuiltinSubagentsDir: () => builtinDir }),
    );

    const caps = builtinCaps(await listers.subagents());
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({
      id: 'pi-subagent:builtin:reviewer',
      kind: 'pi-subagent',
      name: 'reviewer',
      description: 'Reviews code changes',
      permissionRequired: 'agent',
      supportsUserInput: true,
      defaultTimeoutMs: 60_000,
    });
    expect(caps[0]?.metadata).toMatchObject({
      source: 'builtin',
      tools: ['read_file', 'search'],
    });
    expect(JSON.stringify(caps[0])).not.toContain('SECRET SYSTEM PROMPT BODY');
  });

  it('skips disabled subagents and files without name/description', async () => {
    writeFileSync(
      join(builtinDir, 'disabled.md'),
      ['---', 'name: ghost', 'description: Disabled agent', 'disabled: true', '---'].join('\n'),
    );
    writeFileSync(join(builtinDir, 'no-frontmatter.md'), 'just a body');
    writeFileSync(
      join(builtinDir, 'ok.md'),
      ['---', 'name: ok-agent', 'description: Works', '---'].join('\n'),
    );
    mkdirSync(join(builtinDir, 'nested')); // directories are ignored
    const listers = createAgentCapabilitiesServices(
      createServices({ resolveBuiltinSubagentsDir: () => builtinDir }),
    );

    const caps = builtinCaps(await listers.subagents());
    expect(caps.map((cap) => cap.id)).toEqual(['pi-subagent:builtin:ok-agent']);
  });

  it('returns no builtin subagents when the host has none installed', async () => {
    const listers = createAgentCapabilitiesServices(
      createServices({ resolveBuiltinSubagentsDir: () => null }),
    );
    expect(builtinCaps(await listers.subagents())).toEqual([]);
  });
});

describe('mcp-tool capabilities', () => {
  it('maps only cached MCP tools explicitly allowlisted for MindOS Agent', () => {
    const listers = createAgentCapabilitiesServices(createServices({
      readMcpConfig: () => ({
        settings: {
          mindosAgent: {
            mcpServers: {
              github: ['search_code'],
            },
          },
        },
        mcpServers: {
          notes: { directTools: true, lifecycle: 'eager', mindosAgent: ['find_note'] },
          github: { directTools: true },
          crm: { directTools: true, mindos: { agent: { tools: ['lookup_contact'] } } },
          broad: { directTools: true, mindosAgent: true },
          uncached: {},
        },
      }),
      readMcpToolCache: () => ({
        notes: {
          tools: [
            { name: 'find_note', description: 'Find a note' },
            { name: 'delete_note', description: 'Delete a note' },
          ],
        },
        github: {
          tools: [
            { name: 'search_code', description: 'Search code' },
            { name: 'delete_repo', description: 'Delete repository' },
          ],
        },
        crm: {
          tools: [
            { name: 'lookup_contact', description: 'Lookup contact' },
            { name: 'export_all', description: 'Export everything' },
          ],
        },
        broad: {
          tools: [{ name: 'safe_tool', description: 'Safe tool' }],
        },
        uncached: {
          tools: [{ name: 'hidden_tool', description: 'Should not be listed' }],
        },
      }),
    }));

    const caps = listers.mcp() as AgentCapabilityInput[];
    expect(caps.map((cap) => cap.id)).toEqual([
      'mcp-tool:notes:find_note',
      'mcp-tool:github:search_code',
      'mcp-tool:crm:lookup_contact',
      'mcp-tool:broad:safe_tool',
    ]);
    expect(caps[0]).toMatchObject({
      kind: 'mcp-tool',
      status: 'cached',
      metadata: { serverName: 'notes', directTools: ['find_note'], lifecycle: 'eager', cached: true },
    });
    expect(caps.map((cap) => cap.id)).not.toContain('mcp-tool:notes:delete_note');
    expect(caps.map((cap) => cap.id)).not.toContain('mcp-tool:github:delete_repo');
    expect(caps.map((cap) => cap.id)).not.toContain('mcp-tool:crm:export_all');
    expect(caps.map((cap) => cap.id)).not.toContain('mcp-tool:uncached:hidden_tool');
  });
});

describe('a2a-agent capabilities', () => {
  it('maps discovered agents with reachability status', () => {
    const listers = createAgentCapabilitiesServices(createServices({
      getDiscoveredAgents: () => [{
        id: 'remote-1',
        endpoint: 'http://localhost:9999',
        reachable: false,
        discoveredAt: '2026-06-13T00:00:00Z',
        card: {
          name: 'Remote Helper',
          description: 'Off-box helper',
          defaultInputModes: ['text'],
          defaultOutputModes: ['text'],
          capabilities: { streaming: true },
          provider: { organization: 'acme' },
          skills: [{ id: 's1', name: 'summarize', description: 'Summarize', tags: [] }],
        },
      }],
    }));

    const caps = listers.a2a() as AgentCapabilityInput[];
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({
      id: 'a2a-agent:remote-1',
      kind: 'a2a-agent',
      name: 'Remote Helper',
      status: 'error',
      supportsStreaming: true,
    });
    expect(caps[0]?.metadata).toMatchObject({
      endpoint: 'http://localhost:9999',
      skills: [{ id: 's1', name: 'summarize', description: 'Summarize', tags: [] }],
    });
  });
});
