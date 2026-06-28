import { describe, expect, it } from 'vitest';
import { buildAcpSessionMcpInheritancePlan } from './mcp-session-inheritance.js';

describe('ACP MCP session inheritance', () => {
  it('inherits only explicitly full-access MCP servers and skips tool subsets', () => {
    const plan = buildAcpSessionMcpInheritancePlan({
      config: {
        mcpServers: {
          filesystem: {
            command: 'mcp-filesystem',
            args: ['--root', '/tmp/project'],
            env: { FILESYSTEM_TOKEN: 'secret-value' },
            agentSessions: true,
          },
          github: {
            command: 'mcp-github',
            env: { GITHUB_TOKEN: 'must-not-leak-to-partial' },
            agentSessions: ['search_repositories'],
          },
          hidden: {
            command: 'mcp-hidden',
          },
        },
      },
    });

    expect(plan.servers).toEqual([{
      name: 'filesystem',
      command: 'mcp-filesystem',
      args: ['--root', '/tmp/project'],
      env: [{ name: 'FILESYSTEM_TOKEN', value: 'secret-value' }],
    }]);
    expect(plan.summaries).toEqual([{ name: 'filesystem', type: 'stdio' }]);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      { name: 'github', reason: 'tool-subset-not-injectable' },
      { name: 'hidden', reason: 'not-allowlisted' },
    ]));
  });

  it('supports global agent session allowlists without mutating the source config', () => {
    const config = {
      mcpServers: {
        docs: { command: 'mcp-docs', args: ['--stdio'] },
      },
      settings: {
        agentSessions: {
          mcpServers: {
            docs: true,
          },
        },
      },
    };

    const plan = buildAcpSessionMcpInheritancePlan({ config });

    expect(plan.servers).toEqual([{
      name: 'docs',
      command: 'mcp-docs',
      args: ['--stdio'],
      env: [],
    }]);
    expect(config.mcpServers.docs).toEqual({ command: 'mcp-docs', args: ['--stdio'] });
  });

  it('filters http and sse servers by agent-declared MCP capabilities', () => {
    const config = {
      mcpServers: {
        httpTools: {
          type: 'http',
          url: 'https://mcp.example.com/http',
          headers: { Authorization: 'Bearer secret' },
          agentSessions: true,
        },
        sseTools: {
          type: 'sse',
          url: 'https://mcp.example.com/sse',
          agentSessions: true,
        },
      },
    };

    const httpOnly = buildAcpSessionMcpInheritancePlan({
      config,
      agentCapabilities: { mcpCapabilities: { http: true } },
    });
    expect(httpOnly.servers).toEqual([{
      type: 'http',
      name: 'httpTools',
      url: 'https://mcp.example.com/http',
      headers: [{ name: 'Authorization', value: 'Bearer secret' }],
    }]);
    expect(httpOnly.skipped).toEqual([{ name: 'sseTools', reason: 'unsupported-transport' }]);

    const both = buildAcpSessionMcpInheritancePlan({
      config,
      agentCapabilities: { mcpCapabilities: { http: true, sse: true } },
    });
    expect(both.summaries).toEqual([
      { name: 'httpTools', type: 'http' },
      { name: 'sseTools', type: 'sse' },
    ]);
  });

  it('inherits ACP-transport MCP servers only when declared by the agent', () => {
    const config = {
      mcpServers: {
        componentTools: {
          type: 'acp',
          id: 'component-tools-1',
          agentSessions: true,
        },
      },
    };

    const unsupported = buildAcpSessionMcpInheritancePlan({
      config,
      agentCapabilities: { mcpCapabilities: { http: true } },
    });
    expect(unsupported.servers).toEqual([]);
    expect(unsupported.skipped).toEqual([{ name: 'componentTools', reason: 'unsupported-transport' }]);

    const supported = buildAcpSessionMcpInheritancePlan({
      config,
      agentCapabilities: { mcpCapabilities: { acp: true } },
    });
    expect(supported.servers).toEqual([{
      type: 'acp',
      name: 'componentTools',
      id: 'component-tools-1',
    }]);
    expect(supported.summaries).toEqual([{ name: 'componentTools', type: 'acp' }]);
  });
});
