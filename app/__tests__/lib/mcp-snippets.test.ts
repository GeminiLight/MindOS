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
  key: 'cursor',
  name: 'Cursor',
  globalNestedKey: 'mcpServers',
  configKey: 'mcpServers',
  globalPath: '~/.cursor/mcp.json',
  projectPath: '.cursor/mcp.json',
  hasProjectScope: true,
};

const tomlAgent: AgentInfo = {
  ...jsonAgent,
  key: 'zed',
  name: 'Zed',
  format: 'toml' as const,
  configKey: 'context_servers',
  globalPath: '~/.config/zed/settings.toml',
};

const mcpStatus: McpStatus = {
  running: true,
  transport: 'http',
  endpoint: 'http://192.168.1.100:8781/mcp',
  port: 8781,
  toolCount: 20,
  authConfigured: true,
  authToken: 'token_abc123',
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
      });
      // snippet and displaySnippet should be identical for stdio
      expect(result.snippet).toBe(result.displaySnippet);
    });

    it('generates JSON snippet for nested-key agent with projectPath', () => {
      const result = generateStdioSnippet(nestedJsonAgent);
      expect(result.path).toBe('.cursor/mcp.json');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.command).toBe('mindos');
    });

    it('generates TOML snippet for TOML-format agent', () => {
      const result = generateStdioSnippet(tomlAgent);
      expect(result.path).toBe('~/.config/zed/settings.toml');
      expect(result.snippet).toContain('[context_servers.mindos]');
      expect(result.snippet).toContain('command = "mindos"');
      expect(result.snippet).toContain('MCP_TRANSPORT = "stdio"');
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

    it('passes authToken from status to http snippet', () => {
      const result = generateSnippet(jsonAgent, mcpStatus, 'http');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.headers.Authorization).toBe('Bearer token_abc123');
    });

    it('omits auth header when status has no authToken', () => {
      const noAuthStatus: McpStatus = { ...mcpStatus, authToken: undefined, maskedToken: undefined };
      const result = generateSnippet(jsonAgent, noAuthStatus, 'http');
      const parsed = JSON.parse(result.snippet);
      expect(parsed.mcpServers.mindos.headers).toBeUndefined();
    });
  });
});
