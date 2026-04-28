import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for YAML support in MCP install — entry format and config file merging.
 *
 * Tests the module:
 *   bin/lib/yaml.js  — buildYamlEntry(), mergeYamlEntry()
 *
 * Also validates Hermes agent registration in mcp-agents.
 */

async function importYaml() {
  return await import('../../packages/mindos/bin/lib/yaml.js');
}

async function importAgents() {
  return await import('../../packages/mindos/bin/lib/mcp-agents.js');
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-yaml-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── Hermes Agent Registration ─────────────────────────────────────────────

describe('Hermes agent registration', () => {
  it('is registered in MCP_AGENTS', async () => {
    const { MCP_AGENTS } = await importAgents();
    expect(MCP_AGENTS).toHaveProperty('hermes');
  });

  it('has correct config properties', async () => {
    const { MCP_AGENTS } = await importAgents();
    const hermes = MCP_AGENTS['hermes'];
    expect(hermes.name).toBe('Hermes');
    expect(hermes.global).toBe('~/.hermes/config.yaml');
    expect(hermes.key).toBe('mcp_servers');
    expect(hermes.format).toBe('yaml');
    expect(hermes.preferredTransport).toBe('stdio');
    expect(hermes.presenceCli).toBe('hermes');
    expect(hermes.presenceDirs).toContain('~/.hermes/');
    expect(hermes.project).toBeNull();
  });

  it('is registered in SKILL_AGENT_REGISTRY as unsupported (auto-copy to ~/.hermes/skills/)', async () => {
    const { SKILL_AGENT_REGISTRY } = await importAgents();
    expect(SKILL_AGENT_REGISTRY).toHaveProperty('hermes');
    expect(SKILL_AGENT_REGISTRY['hermes'].mode).toBe('unsupported');
  });
});

// ── buildYamlEntry ──────────────────────────────────────────────────────────

describe('buildYamlEntry', () => {
  it('generates stdio entry with env mapping', async () => {
    const { buildYamlEntry } = await importYaml();
    const result = buildYamlEntry('mindos', {
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    expect(result).toContain('  mindos:');
    expect(result).toContain('    command: "mindos"');
    expect(result).toContain('    args: ["mcp"]');
    expect(result).toContain('    env:');
    expect(result).toContain('      MCP_TRANSPORT: "stdio"');
  });

  it('generates http entry with headers mapping', async () => {
    const { buildYamlEntry } = await importYaml();
    const result = buildYamlEntry('mindos', {
      url: 'http://localhost:8567/mcp',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(result).toContain('  mindos:');
    expect(result).toContain('    url: "http://localhost:8567/mcp"');
    expect(result).toContain('    headers:');
    expect(result).toContain('      Authorization: "Bearer test-token"');
  });

  it('generates entry with type field', async () => {
    const { buildYamlEntry } = await importYaml();
    const result = buildYamlEntry('mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
    });

    expect(result).toContain('    type: "stdio"');
    expect(result).toContain('    command: "mindos"');
  });

  it('omits null/undefined fields', async () => {
    const { buildYamlEntry } = await importYaml();
    const result = buildYamlEntry('test', { url: 'http://example.com' });

    expect(result).not.toContain('command:');
    expect(result).not.toContain('args:');
    expect(result).not.toContain('env:');
    expect(result).not.toContain('headers:');
  });
});

// ── mergeYamlEntry ──────────────────────────────────────────────────────────

describe('mergeYamlEntry', () => {
  it('creates new file from empty content', async () => {
    const { mergeYamlEntry } = await importYaml();
    const result = mergeYamlEntry('', 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    expect(result).toContain('mcp_servers:');
    expect(result).toContain('  mindos:');
    expect(result).toContain('    command: "mindos"');
    expect(result).toContain('    args: ["mcp"]');
    expect(result).toContain('      MCP_TRANSPORT: "stdio"');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('appends to existing config with other sections', async () => {
    const { mergeYamlEntry } = await importYaml();
    const existing = `model: "openrouter/anthropic/claude-sonnet-4"
api_key: "sk-xxx"

mcp_servers:
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
`;

    const result = mergeYamlEntry(existing, 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
    });

    expect(result).toContain('model: "openrouter/anthropic/claude-sonnet-4"');
    expect(result).toContain('  github:');
    expect(result).toContain('  mindos:');
    expect(result).toContain('    command: "mindos"');
  });

  it('replaces existing server entry', async () => {
    const { mergeYamlEntry } = await importYaml();
    const existing = `mcp_servers:
  mindos:
    command: "old-mindos"
    args: ["old"]
  github:
    command: "npx"
`;

    const result = mergeYamlEntry(existing, 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    expect(result).not.toContain('old-mindos');
    expect(result).not.toContain('"old"');
    expect(result).toContain('    command: "mindos"');
    expect(result).toContain('    args: ["mcp"]');
    expect(result).toContain('  github:');
    expect(result).toContain('    command: "npx"');
  });

  it('creates mcp_servers section when missing', async () => {
    const { mergeYamlEntry } = await importYaml();
    const existing = `model: "some-model"
api_key: "sk-xxx"
`;

    const result = mergeYamlEntry(existing, 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
    });

    expect(result).toContain('model: "some-model"');
    expect(result).toContain('mcp_servers:');
    expect(result).toContain('  mindos:');
    expect(result).toContain('    command: "mindos"');
  });

  it('preserves other servers when replacing', async () => {
    const { mergeYamlEntry } = await importYaml();
    const existing = `mcp_servers:
  stripe:
    url: "https://mcp.stripe.com"
    headers:
      Authorization: "Bearer sk-stripe"
  mindos:
    command: "old"
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;

    const result = mergeYamlEntry(existing, 'mcp_servers', 'mindos', {
      url: 'http://localhost:8567/mcp',
    });

    expect(result).toContain('  stripe:');
    expect(result).toContain('    url: "https://mcp.stripe.com"');
    expect(result).toContain('      Authorization: "Bearer sk-stripe"');
    expect(result).toContain('  filesystem:');
    expect(result).not.toContain('command: "old"');
    expect(result).toContain('    url: "http://localhost:8567/mcp"');
  });

  it('handles replacement of last server in section', async () => {
    const { mergeYamlEntry } = await importYaml();
    const existing = `mcp_servers:
  github:
    command: "npx"
  mindos:
    command: "old"
    args: ["old"]
    env:
      OLD_VAR: "old-value"
`;

    const result = mergeYamlEntry(existing, 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
    });

    expect(result).toContain('  github:');
    expect(result).not.toContain('old');
    expect(result).toContain('    command: "mindos"');
    expect(result).toContain('    args: ["mcp"]');
  });

  it('writes to actual file correctly', async () => {
    const { mergeYamlEntry } = await importYaml();
    const configPath = path.join(tempDir, 'config.yaml');

    const content = mergeYamlEntry('', 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
    fs.writeFileSync(configPath, content, 'utf-8');

    const written = fs.readFileSync(configPath, 'utf-8');
    expect(written).toContain('mcp_servers:');
    expect(written).toContain('  mindos:');
    expect(written).toContain('    command: "mindos"');
    expect(written).toContain('      MCP_TRANSPORT: "stdio"');
  });

  it('round-trips: write then update', async () => {
    const { mergeYamlEntry } = await importYaml();

    // First write
    let content = mergeYamlEntry('', 'mcp_servers', 'mindos', {
      command: 'mindos',
      args: ['mcp'],
    });

    // Second write: update with http
    content = mergeYamlEntry(content, 'mcp_servers', 'mindos', {
      url: 'http://localhost:8567/mcp',
      headers: { Authorization: 'Bearer token123' },
    });

    expect(content).not.toContain('command: "mindos"');
    expect(content).toContain('    url: "http://localhost:8567/mcp"');
    expect(content).toContain('      Authorization: "Bearer token123"');
    // Should only have one mindos entry
    const mindosCount = (content.match(/^\s{2}mindos:/gm) || []).length;
    expect(mindosCount).toBe(1);
  });
});
