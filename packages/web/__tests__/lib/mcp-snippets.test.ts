import { describe, it, expect } from 'vitest';
import {
  generateStdioSnippet,
  generateHttpSnippet,
  generateSnippet,
  type ConfigSnippet,
} from '@/lib/mcp-snippets';
import type { AgentInfo, McpStatus } from '@/components/settings/types';

/* ── Fixtures ── */

const jsonAgent: AgentInfo = {
  key: 'claude-code',
  name: 'Claude Code',
  present: true,
  installed: true,
  hasProjectScope: false,
  hasGlobalScope: true,
  preferredTransport: 'stdio' as const,
  format: 'json' as const,
  configKey: 'mcpServers',
  globalPath: '~/.claude.json',
  projectPath: null,
};

const nestedJsonAgent: AgentInfo = {
  ...jsonAgent,
  key: 'copaw',
  name: 'CoPaw',
  globalNestedKey: 'mcp.clients',
  configKey: 'mcp',
  globalPath: '~/.copaw/config.json',
  projectPath: null,
  hasProjectScope: false,
};

const tomlAgent: AgentInfo = {
  ...jsonAgent,
  key: 'zed',
  name: 'Zed',
  format: 'toml' as const,
  configKey: 'context_servers',
  globalPath: '~/.config/zed/settings.toml',
};

const yamlAgent: AgentInfo = {
  ...jsonAgent,
  key: 'hermes',
  name: 'Hermes',
  format: 'yaml' as const,
  configKey: 'mcp_servers',
  globalPath: '~/.hermes/config.yaml',
};

const mcpStatus: McpStatus = {
  running: true,
  transport: 'http',
  endpoint: 'http://192.168.1.100:8781/mcp',
  port: 8781,
  toolCount: 20,
  authConfigured: true,
  maskedToken: 'token_a••••3',
};

/* ── Tests ── */

describe('mcp-snippets', () => {
  describe('generateStdioSnippet', () => {
    it('generates JSON snippet for standard agent', () => {
      const result = generateStdioSnippet(jsonAgent);
      expect(result.path).toBe('~/.claude.json');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos).toEqual({
        type: 'stdio',
        command: 'mindos',
        args: ['mcp'],
        env: { MCP_TRANSPORT: 'stdio' },
      });
      // snippet and displaySnippet should be identical for stdio
      expect(result.snippet).toBe(result.displaySnippet);
    });

    it('generates JSON snippet for nested-key agent using the real global nested path', () => {
      const result = generateStdioSnippet(nestedJsonAgent);
      expect(result.path).toBe('~/.copaw/config.json');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcp.clients.mindos.command).toBe('mindos');
      expect(parsed.mcp.clients.mindos.env.MCP_TRANSPORT).toBe('stdio');
      expect(parsed.mcp.mindos).toBeUndefined();
    });

    it('generates TOML snippet for TOML-format agent', () => {
      const result = generateStdioSnippet(tomlAgent);
      expect(result.path).toBe('~/.config/zed/settings.toml');
      expect(result.snippet).toContain('[context_servers.mindos]');
      expect(result.snippet).toContain('command = "mindos"');
      expect(result.snippet).toContain('MCP_TRANSPORT = "stdio"');
    });

    it('generates YAML snippet for YAML-format agent', () => {
      const result = generateStdioSnippet(yamlAgent);
      expect(result.path).toBe('~/.hermes/config.yaml');
      expect(result.snippet).toContain('mcp_servers:');
      expect(result.snippet).toContain('  mindos:');
      expect(result.snippet).toContain('    type: "stdio"');
      expect(result.snippet).toContain('    command: "mindos"');
      expect(result.snippet).toContain('    args: ["mcp"]');
      expect(result.snippet).toContain('    env:');
      expect(result.snippet).toContain('      MCP_TRANSPORT: "stdio"');
    });
  });

  describe('generateHttpSnippet', () => {
    it('generates HTTP snippet with auth token', () => {
      const result = generateHttpSnippet(
        jsonAgent,
        'http://192.168.1.100:8781/mcp',
        'token_abc123',
        'token_a••••3',
      );
      // Copy version has full token
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.url).toBe('http://192.168.1.100:8781/mcp');
      expect(parsed.mcpServers.mindos.headers.Authorization).toBe('Bearer token_abc123');

      // Display version has masked token
      const display = JSON.parse(result.displaySnippet);
      expect(display.mcpServers.mindos.headers.Authorization).toBe('Bearer token_a••••3');
    });

    it('generates HTTP snippet without auth when token is undefined', () => {
      const result = generateHttpSnippet(jsonAgent, 'http://localhost:8781/mcp');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.url).toBe('http://localhost:8781/mcp');
      expect(parsed.mcpServers.mindos.headers).toBeUndefined();
    });

    it('generates TOML HTTP snippet with auth header', () => {
      const result = generateHttpSnippet(
        tomlAgent,
        'http://192.168.1.100:8781/mcp',
        'token_abc123',
        'token_a••••3',
      );
      expect(result.snippet).toContain('[context_servers.mindos]');
      expect(result.snippet).toContain('type = "http"');
      expect(result.snippet).toContain('url = "http://192.168.1.100:8781/mcp"');
      expect(result.snippet).toContain('[context_servers.mindos.headers]');
      expect(result.snippet).toContain('Authorization = "Bearer token_abc123"');
    });

    it('generates YAML HTTP snippet with masked display token', () => {
      const result = generateHttpSnippet(
        yamlAgent,
        'http://192.168.1.100:8781/mcp',
        'token_abc123',
        'token_a••••3',
      );
      expect(result.path).toBe('~/.hermes/config.yaml');
      expect(result.snippet).toContain('mcp_servers:');
      expect(result.snippet).toContain('    url: "http://192.168.1.100:8781/mcp"');
      expect(result.snippet).toContain('      Authorization: "Bearer token_abc123"');
      expect(result.displaySnippet).toContain('      Authorization: "Bearer token_a••••3"');
    });
  });

  describe('generateSnippet', () => {
    it('delegates to stdio when transport is stdio', () => {
      const result = generateSnippet(jsonAgent, mcpStatus, 'stdio');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.type).toBe('stdio');
      expect(parsed.mcpServers.mindos.command).toBe('mindos');
    });

    it('delegates to http when transport is http', () => {
      const result = generateSnippet(jsonAgent, mcpStatus, 'http');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.url).toBe('http://192.168.1.100:8781/mcp');
    });

    it('uses fallback endpoint when status is null', () => {
      const result = generateSnippet(jsonAgent, null, 'http');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.url).toBe('http://127.0.0.1:8781/mcp');
    });

    it('uses only masked token from status when no token was explicitly revealed', () => {
      const result = generateSnippet(jsonAgent, mcpStatus, 'http');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.headers).toBeUndefined();
      const display = JSON.parse(result.displaySnippet);
      expect(display.mcpServers.mindos.headers.Authorization).toBe('Bearer token_a••••3');
    });

    it('uses an explicitly revealed token for the copy snippet', () => {
      const result = generateSnippet(jsonAgent, mcpStatus, 'http', 'token_abc123');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.headers.Authorization).toBe('Bearer token_abc123');
      const display = JSON.parse(result.displaySnippet);
      expect(display.mcpServers.mindos.headers.Authorization).toBe('Bearer token_a••••3');
    });

    it('omits auth header when status has no masked token', () => {
      const noAuthStatus: McpStatus = { ...mcpStatus, maskedToken: undefined, authConfigured: false };
      const result = generateSnippet(jsonAgent, noAuthStatus, 'http');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.headers).toBeUndefined();
    });
  });
});
