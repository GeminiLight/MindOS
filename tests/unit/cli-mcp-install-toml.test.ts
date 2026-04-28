import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for TOML support in MCP install — entry format and config file merging.
 *
 * Mirrors the TypeScript tests in packages/web/__tests__/api/mcp-install.test.ts
 * for the Codex TOML path (lines 133-177).
 *
 * Tests two modules:
 *   1. packages/mindos/bin/lib/toml.js  — buildTomlEntry(), mergeTomlEntry()
 *   2. packages/mindos/bin/lib/mcp-install.js — TOML-aware install flow
 */

// Dynamic import because product CLI libs use ESM.
async function importToml() {
  return await import('../../packages/mindos/bin/lib/toml.js');
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-toml-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── buildTomlEntry ──────────────────────────────────────────────────────────

describe('buildTomlEntry', () => {
  it('generates stdio entry with env sub-table', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('type = "stdio"');
    expect(result).toContain('command = "mindos"');
    expect(result).toContain('args = ["mcp"]');
    expect(result).toContain('[mcp_servers.mindos.env]');
    expect(result).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('generates http entry with URL only', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('mcp_servers', 'mindos', {
      url: 'http://localhost:8781/mcp',
    });

    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('url = "http://localhost:8781/mcp"');
    expect(result).not.toContain('[mcp_servers.mindos.env]');
    expect(result).not.toContain('[mcp_servers.mindos.headers]');
  });

  it('generates http entry with Authorization header', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('mcp_servers', 'mindos', {
      url: 'http://localhost:8781/mcp',
      headers: { Authorization: 'Bearer tok-abc' },
    });

    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('url = "http://localhost:8781/mcp"');
    expect(result).toContain('[mcp_servers.mindos.headers]');
    expect(result).toContain('Authorization = "Bearer tok-abc"');
  });

  it('generates entry with both env and headers', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp', '--verbose'],
      env: { MCP_TRANSPORT: 'stdio', DEBUG: '1' },
      headers: { 'X-Custom': 'value' },
    });

    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('args = ["mcp", "--verbose"]');
    expect(result).toContain('[mcp_servers.mindos.env]');
    expect(result).toContain('MCP_TRANSPORT = "stdio"');
    expect(result).toContain('DEBUG = "1"');
    expect(result).toContain('[mcp_servers.mindos.headers]');
    expect(result).toContain('X-Custom = "value"');

    // Verify section order: main → env → headers
    const mainIdx = result.indexOf('[mcp_servers.mindos]');
    const envIdx = result.indexOf('[mcp_servers.mindos.env]');
    const headersIdx = result.indexOf('[mcp_servers.mindos.headers]');
    expect(mainIdx).toBeLessThan(envIdx);
    expect(envIdx).toBeLessThan(headersIdx);
  });

  it('omits null/undefined fields gracefully', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('mcp_servers', 'mindos', {
      type: 'stdio',
      command: null,
      url: undefined,
      args: null,
    });

    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('type = "stdio"');
    expect(result).not.toContain('command');
    expect(result).not.toContain('url');
    expect(result).not.toContain('args');
  });

  it('supports custom section and server names', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('custom_servers', 'my-server', {
      type: 'http',
      url: 'http://example.com/api',
    });

    expect(result).toContain('[custom_servers.my-server]');
    expect(result).toContain('type = "http"');
    expect(result).toContain('url = "http://example.com/api"');
  });

  it('handles empty entry object', async () => {
    const { buildTomlEntry } = await importToml();
    const result = buildTomlEntry('mcp_servers', 'mindos', {});

    expect(result).toBe('[mcp_servers.mindos]');
  });
});

// ── mergeTomlEntry ──────────────────────────────────────────────────────────

describe('mergeTomlEntry', () => {
  it('creates new block when file is empty', async () => {
    const { mergeTomlEntry } = await importToml();
    const result = mergeTomlEntry('', 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('type = "stdio"');
    expect(result).toContain('[mcp_servers.mindos.env]');
    expect(result).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('preserves unrelated sections', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = [
      '[other_section]',
      'key = "value"',
      '',
      '[another.nested]',
      'foo = "bar"',
      '',
    ].join('\n');

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
    });

    expect(result).toContain('[other_section]');
    expect(result).toContain('key = "value"');
    expect(result).toContain('[another.nested]');
    expect(result).toContain('foo = "bar"');
    expect(result).toContain('[mcp_servers.mindos]');
  });

  it('replaces existing mindos section', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = [
      '[mcp_servers.mindos]',
      'type = "http"',
      'url = "http://old:8000/mcp"',
      '',
    ].join('\n');

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    // Old values gone
    expect(result).not.toContain('http://old:8000/mcp');
    expect(result).not.toContain('type = "http"');

    // New values present
    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('type = "stdio"');
    expect(result).toContain('command = "mindos"');
    expect(result).toContain('[mcp_servers.mindos.env]');
    expect(result).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('replaces existing section including env sub-table', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = [
      '[mcp_servers.mindos]',
      'type = "stdio"',
      'command = "old-cmd"',
      '',
      '[mcp_servers.mindos.env]',
      'OLD_VAR = "old-value"',
      '',
      '[other_section]',
      'key = "keep"',
      '',
    ].join('\n');

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });

    // Old env gone
    expect(result).not.toContain('OLD_VAR');
    expect(result).not.toContain('old-cmd');

    // Other section preserved
    expect(result).toContain('[other_section]');
    expect(result).toContain('key = "keep"');

    // New values present
    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('command = "mindos"');
    expect(result).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('preserves other servers in same section namespace', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = [
      '[mcp_servers.other-server]',
      'type = "http"',
      'url = "http://other:9000"',
      '',
      '[mcp_servers.mindos]',
      'type = "http"',
      'url = "http://old:8000"',
      '',
    ].join('\n');

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
    });

    // Other server preserved
    expect(result).toContain('[mcp_servers.other-server]');
    expect(result).toContain('url = "http://other:9000"');

    // mindos updated
    expect(result).toContain('[mcp_servers.mindos]');
    expect(result).toContain('type = "stdio"');
    expect(result).not.toContain('http://old:8000');
  });

  it('handles file with leading content before any section', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = [
      '# Codex configuration',
      'model = "gpt-4"',
      '',
      '[mcp_servers.existing]',
      'type = "stdio"',
      '',
    ].join('\n');

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
    });

    // Leading content preserved
    expect(result).toContain('# Codex configuration');
    expect(result).toContain('model = "gpt-4"');
    expect(result).toContain('[mcp_servers.existing]');
    expect(result).toContain('[mcp_servers.mindos]');
  });

  it('strips trailing blank lines before appending', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = '[other]\nkey = "val"\n\n\n\n';

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
    });

    // Should not have excessive blank lines between sections
    const lines = result.split('\n');
    let maxConsecutiveBlanks = 0;
    let consecutiveBlanks = 0;
    for (const line of lines) {
      if (line.trim() === '') {
        consecutiveBlanks++;
        maxConsecutiveBlanks = Math.max(maxConsecutiveBlanks, consecutiveBlanks);
      } else {
        consecutiveBlanks = 0;
      }
    }
    // At most 1 blank line between sections (the separator)
    expect(maxConsecutiveBlanks).toBeLessThanOrEqual(1);
  });

  it('replaces section with headers sub-table', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = [
      '[mcp_servers.mindos]',
      'url = "http://old:8000"',
      '',
      '[mcp_servers.mindos.headers]',
      'Authorization = "Bearer old-token"',
      '',
    ].join('\n');

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      url: 'http://new:9000',
      headers: { Authorization: 'Bearer new-token' },
    });

    expect(result).not.toContain('old-token');
    expect(result).not.toContain('http://old:8000');
    expect(result).toContain('url = "http://new:9000"');
    expect(result).toContain('Authorization = "Bearer new-token"');
  });
});

// ── File I/O integration ────────────────────────────────────────────────────

describe('TOML file I/O integration', () => {
  it('creates new TOML config file when none exists', async () => {
    const { mergeTomlEntry } = await importToml();
    const configPath = path.join(tempDir, 'config.toml');
    const entry = {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    };

    const merged = mergeTomlEntry('', 'mcp_servers', 'mindos', entry);
    fs.writeFileSync(configPath, merged, 'utf-8');

    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[mcp_servers.mindos]');
    expect(content).toContain('type = "stdio"');
    expect(content).toContain('command = "mindos"');
    expect(content).toContain('args = ["mcp"]');
    expect(content).toContain('[mcp_servers.mindos.env]');
    expect(content).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('preserves existing TOML content when merging', async () => {
    const { mergeTomlEntry } = await importToml();
    const configPath = path.join(tempDir, 'config.toml');

    // Write initial config (simulates existing Codex config)
    const initial = [
      '# Codex global config',
      'model = "o3"',
      'approval_mode = "suggest"',
      '',
      '[mcp_servers.filesystem]',
      'type = "stdio"',
      'command = "npx"',
      'args = ["-y", "@anthropic/filesystem-server"]',
      '',
    ].join('\n');
    fs.writeFileSync(configPath, initial, 'utf-8');

    // Merge mindos entry
    const existing = fs.readFileSync(configPath, 'utf-8');
    const merged = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
    fs.writeFileSync(configPath, merged, 'utf-8');

    const content = fs.readFileSync(configPath, 'utf-8');

    // Original content preserved
    expect(content).toContain('# Codex global config');
    expect(content).toContain('model = "o3"');
    expect(content).toContain('approval_mode = "suggest"');
    expect(content).toContain('[mcp_servers.filesystem]');
    expect(content).toContain('command = "npx"');

    // New mindos entry added
    expect(content).toContain('[mcp_servers.mindos]');
    expect(content).toContain('type = "stdio"');
    expect(content).toContain('command = "mindos"');
  });

  it('updates existing mindos entry without losing other content', async () => {
    const { mergeTomlEntry } = await importToml();
    const configPath = path.join(tempDir, 'config.toml');

    // Write config with old mindos + other server
    const initial = [
      '[mcp_servers.other]',
      'type = "stdio"',
      'command = "other-cmd"',
      '',
      '[mcp_servers.mindos]',
      'type = "http"',
      'url = "http://old:8000/mcp"',
      '',
      '[mcp_servers.mindos.headers]',
      'Authorization = "Bearer old-token"',
      '',
    ].join('\n');
    fs.writeFileSync(configPath, initial, 'utf-8');

    // Update mindos to stdio
    const existing = fs.readFileSync(configPath, 'utf-8');
    const merged = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
    fs.writeFileSync(configPath, merged, 'utf-8');

    const content = fs.readFileSync(configPath, 'utf-8');

    // Other server preserved
    expect(content).toContain('[mcp_servers.other]');
    expect(content).toContain('command = "other-cmd"');

    // Old mindos values gone
    expect(content).not.toContain('http://old:8000/mcp');
    expect(content).not.toContain('old-token');

    // New mindos values present
    expect(content).toContain('[mcp_servers.mindos]');
    expect(content).toContain('type = "stdio"');
    expect(content).toContain('command = "mindos"');
    expect(content).toContain('[mcp_servers.mindos.env]');
  });

  it('roundtrip: TS parseToml can read CLI-generated TOML', async () => {
    const { mergeTomlEntry } = await importToml();
    const configPath = path.join(tempDir, 'config.toml');

    const merged = mergeTomlEntry('', 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
    fs.writeFileSync(configPath, merged, 'utf-8');

    // Simulate the TS parseTomlServerNames function (from app/lib/mcp-agents.ts:376-400)
    const content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    const names = new Set<string>();
    const sectionPrefix = 'mcp_servers.';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const section = trimmed.slice(1, -1).trim();
        if (section.startsWith(sectionPrefix)) {
          const name = section.slice(sectionPrefix.length).split('.')[0]?.trim();
          if (name) names.add(name);
        }
      }
    }

    expect(names.has('mindos')).toBe(true);
  });

  it('roundtrip: TS parseTomlMcpEntry can read CLI-generated TOML', async () => {
    const { mergeTomlEntry } = await importToml();
    const configPath = path.join(tempDir, 'config.toml');

    const merged = mergeTomlEntry('', 'mcp_servers', 'mindos', {
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
    fs.writeFileSync(configPath, merged, 'utf-8');

    // Simulate parseTomlMcpEntry (from app/lib/mcp-agents.ts:562-626)
    const content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    const targetSection = '[mcp_servers.mindos]';
    let inTargetSection = false;
    const entry: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        if (inTargetSection) break; // exit when next section starts
        inTargetSection = trimmed === targetSection;
        continue;
      }
      if (!inTargetSection) continue;
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
      if (match) {
        const [, key, rawValue] = match;
        entry[key] = rawValue.replace(/^["'](.+)["']$/, '$1');
      }
    }

    expect(entry.type).toBe('stdio');
    expect(entry.command).toBe('mindos');
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('TOML edge cases', () => {
  it('handles file with only comments', async () => {
    const { mergeTomlEntry } = await importToml();
    const existing = '# This is a comment\n# Another comment\n';

    const result = mergeTomlEntry(existing, 'mcp_servers', 'mindos', {
      type: 'stdio',
    });

    expect(result).toContain('# This is a comment');
    expect(result).toContain('# Another comment');
    expect(result).toContain('[mcp_servers.mindos]');
  });

  it('handles consecutive merge operations (idempotent)', async () => {
    const { mergeTomlEntry } = await importToml();

    // First merge
    const first = mergeTomlEntry('', 'mcp_servers', 'mindos', {
      type: 'stdio', command: 'mindos',
    });

    // Second merge (should replace, not duplicate)
    const second = mergeTomlEntry(first, 'mcp_servers', 'mindos', {
      type: 'http', url: 'http://localhost:8781/mcp',
    });

    // Count occurrences of section header
    const matches = second.match(/\[mcp_servers\.mindos\]/g);
    expect(matches).toHaveLength(1);

    // New values present, old gone
    expect(second).toContain('type = "http"');
    expect(second).not.toContain('type = "stdio"');
  });

  it('handles multiple different servers in sequence', async () => {
    const { mergeTomlEntry } = await importToml();

    let content = '';
    content = mergeTomlEntry(content, 'mcp_servers', 'server-a', {
      type: 'stdio', command: 'a',
    });
    content = mergeTomlEntry(content, 'mcp_servers', 'server-b', {
      type: 'stdio', command: 'b',
    });
    content = mergeTomlEntry(content, 'mcp_servers', 'mindos', {
      type: 'stdio', command: 'mindos',
    });

    expect(content).toContain('[mcp_servers.server-a]');
    expect(content).toContain('[mcp_servers.server-b]');
    expect(content).toContain('[mcp_servers.mindos]');
    expect(content).toContain('command = "a"');
    expect(content).toContain('command = "b"');
    expect(content).toContain('command = "mindos"');
  });
});
