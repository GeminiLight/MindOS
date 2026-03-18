import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for MCP install config — entry format and config file merging.
 *
 * mcpInstall() is an interactive TUI function that can't be directly imported
 * without triggering readline. We test the two critical contracts:
 *
 * 1. Entry format (contract test — logic extracted from source)
 * 2. Config file merge (e2e — real file I/O)
 */

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── Entry format contract ───────────────────────────────────────────────────
// Extracted from mcp-install.js lines 278-282

function buildEntry(transport: string, url?: string, token?: string) {
  return transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : token
      ? { url, headers: { Authorization: `Bearer ${token}` } }
      : { url };
}

describe('MCP entry format', () => {
  it('stdio entry has correct structure', () => {
    const entry = buildEntry('stdio');
    expect(entry).toEqual({
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
  });

  it('http entry with token includes Authorization header', () => {
    const entry = buildEntry('http', 'http://localhost:8781/mcp', 'tok-abc');
    expect(entry).toEqual({
      url: 'http://localhost:8781/mcp',
      headers: { Authorization: 'Bearer tok-abc' },
    });
  });

  it('http entry without token has no headers', () => {
    const entry = buildEntry('http', 'http://localhost:8781/mcp');
    expect(entry).toEqual({ url: 'http://localhost:8781/mcp' });
    expect(entry).not.toHaveProperty('headers');
  });
});

// ── Config file merge ───────────────────────────────────────────────────────
// Simulates the read→merge→write logic from mcp-install.js lines 312-329

function mergeAndWrite(configPath: string, agentKey: string, entry: unknown) {
  let config: Record<string, Record<string, unknown>> = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  if (!config[agentKey]) config[agentKey] = {};
  config[agentKey].mindos = entry;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

describe('MCP config file merge', () => {
  it('creates new config file when none exists', () => {
    const configPath = path.join(tempDir, 'mcp.json');
    const entry = buildEntry('stdio');
    mergeAndWrite(configPath, 'mcpServers', entry);

    const result = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(result.mcpServers.mindos).toEqual(entry);
  });

  it('preserves other mcpServers when adding mindos', () => {
    const configPath = path.join(tempDir, 'mcp.json');
    // Pre-existing config with another server
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'other-server': { url: 'http://other:9000/mcp' },
      },
    }, null, 2));

    const entry = buildEntry('http', 'http://localhost:8781/mcp', 'tok-123');
    mergeAndWrite(configPath, 'mcpServers', entry);

    const result = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(result.mcpServers.mindos).toEqual(entry);
    expect(result.mcpServers['other-server']).toEqual({ url: 'http://other:9000/mcp' });
  });

  it('updates existing mindos entry without losing other servers', () => {
    const configPath = path.join(tempDir, 'mcp.json');
    // Pre-existing config with old mindos + another server
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        mindos: { url: 'http://old:8000/mcp' },
        'other-server': { command: 'other-cmd' },
      },
    }, null, 2));

    const newEntry = buildEntry('stdio');
    mergeAndWrite(configPath, 'mcpServers', newEntry);

    const result = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(result.mcpServers.mindos).toEqual(newEntry);
    expect(result.mcpServers['other-server']).toEqual({ command: 'other-cmd' });
  });
});
