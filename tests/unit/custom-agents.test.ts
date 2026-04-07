import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for app/lib/custom-agents.ts — slugify, inferDefaults, toAgentDef,
 * generateUniqueKey, validateCustomAgentInput, detectBaseDir.
 */

// We need to mock mcp-agents to avoid importing the full agent registry
vi.mock('../../app/lib/mcp-agents', () => ({
  expandHome: (p: string) => p.replace(/^~/, os.homedir()),
  MCP_AGENTS: {
    cursor: { name: 'Cursor', project: '.cursor/mcp.json', global: '~/.cursor/mcp.json', key: 'mcpServers', preferredTransport: 'stdio' },
    'claude-code': { name: 'Claude Code', project: '.mcp.json', global: '~/.claude.json', key: 'mcpServers', preferredTransport: 'stdio' },
  },
  SKILL_AGENT_REGISTRY: {},
}));

// Mock settings to avoid file system dependency
let mockCustomAgents: unknown[] = [];
vi.mock('../../app/lib/settings', () => ({
  readSettings: () => ({ customAgents: mockCustomAgents, ai: {}, mindRoot: '' }),
  writeSettings: vi.fn((settings: Record<string, unknown>) => {
    mockCustomAgents = (settings.customAgents as unknown[]) ?? [];
  }),
}));

// Dynamic import after mocks are set up
let slugify: typeof import('../../app/lib/custom-agents').slugify;
let generateUniqueKey: typeof import('../../app/lib/custom-agents').generateUniqueKey;
let inferDefaults: typeof import('../../app/lib/custom-agents').inferDefaults;
let toAgentDef: typeof import('../../app/lib/custom-agents').toAgentDef;
let validateCustomAgentInput: typeof import('../../app/lib/custom-agents').validateCustomAgentInput;
let detectBaseDir: typeof import('../../app/lib/custom-agents').detectBaseDir;
let loadCustomAgents: typeof import('../../app/lib/custom-agents').loadCustomAgents;
let saveCustomAgents: typeof import('../../app/lib/custom-agents').saveCustomAgents;
let getAllAgents: typeof import('../../app/lib/custom-agents').getAllAgents;

beforeEach(async () => {
  mockCustomAgents = [];
  const mod = await import('../../app/lib/custom-agents');
  slugify = mod.slugify;
  generateUniqueKey = mod.generateUniqueKey;
  inferDefaults = mod.inferDefaults;
  toAgentDef = mod.toAgentDef;
  validateCustomAgentInput = mod.validateCustomAgentInput;
  detectBaseDir = mod.detectBaseDir;
  loadCustomAgents = mod.loadCustomAgents;
  saveCustomAgents = mod.saveCustomAgents;
  getAllAgents = mod.getAllAgents;
});

/* ─── slugify ─── */

describe('slugify', () => {
  it('converts normal names to lowercase kebab-case', () => {
    expect(slugify('QC Law Pro 3.0')).toBe('qc-law-pro-30');
  });

  it('handles underscores and spaces', () => {
    expect(slugify('Work_Buddy Test')).toBe('work-buddy-test');
  });

  it('strips non-ASCII characters (CJK)', () => {
    expect(slugify('工作助手')).toBe('');
  });

  it('strips emoji', () => {
    expect(slugify('My🚀Agent')).toBe('myagent');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('a - - b')).toBe('a-b');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify(' -hello- ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles string with only special characters', () => {
    expect(slugify('!@#$%^')).toBe('');
  });

  it('preserves numbers', () => {
    expect(slugify('Agent 42')).toBe('agent-42');
  });
});

/* ─── generateUniqueKey ─── */

describe('generateUniqueKey', () => {
  it('returns slug when no conflict', () => {
    expect(generateUniqueKey('QCLaw', new Set())).toBe('qclaw');
  });

  it('appends suffix on collision', () => {
    expect(generateUniqueKey('QCLaw', new Set(['qclaw']))).toBe('qclaw-2');
  });

  it('increments suffix on multiple collisions', () => {
    expect(generateUniqueKey('QCLaw', new Set(['qclaw', 'qclaw-2']))).toBe('qclaw-3');
  });

  it('falls back to custom-N for empty slug (CJK name)', () => {
    expect(generateUniqueKey('工作助手', new Set())).toBe('custom-1');
  });

  it('increments custom-N on collision', () => {
    expect(generateUniqueKey('工作', new Set(['custom-1']))).toBe('custom-2');
  });
});

/* ─── inferDefaults ─── */

describe('inferDefaults', () => {
  it('generates correct defaults from name and baseDir', () => {
    const result = inferDefaults('QCLaw', '~/.qclaw');
    expect(result.name).toBe('QCLaw');
    expect(result.baseDir).toBe('~/.qclaw/');
    expect(result.global).toBe('~/.qclaw/mcp.json');
    expect(result.project).toBeNull();
    expect(result.configKey).toBe('mcpServers');
    expect(result.format).toBe('json');
    expect(result.preferredTransport).toBe('stdio');
    expect(result.presenceDirs).toEqual(['~/.qclaw/']);
  });

  it('preserves trailing slash in baseDir', () => {
    const result = inferDefaults('Test', '~/.test/');
    expect(result.baseDir).toBe('~/.test/');
    expect(result.global).toBe('~/.test/mcp.json');
  });
});

/* ─── toAgentDef ─── */

describe('toAgentDef', () => {
  it('converts CustomAgentDef to AgentDef correctly', () => {
    const custom = {
      name: 'QCLaw',
      key: 'qclaw',
      baseDir: '~/.qclaw/',
      global: '~/.qclaw/mcp.json',
      configKey: 'mcpServers',
      format: 'json' as const,
      preferredTransport: 'stdio' as const,
      presenceDirs: ['~/.qclaw/'],
    };

    const def = toAgentDef(custom);
    expect(def.name).toBe('QCLaw');
    expect(def.key).toBe('mcpServers'); // AgentDef.key = configKey
    expect(def.global).toBe('~/.qclaw/mcp.json');
    expect(def.project).toBeNull();
    expect(def.preferredTransport).toBe('stdio');
    expect(def.format).toBe('json');
    expect(def.presenceDirs).toEqual(['~/.qclaw/']);
  });

  it('handles optional fields', () => {
    const custom = {
      name: 'Test',
      key: 'test',
      baseDir: '~/.test/',
      global: '~/.test/config.toml',
      configKey: 'mcp_servers',
      format: 'toml' as const,
      preferredTransport: 'http' as const,
      presenceDirs: ['~/.test/'],
      presenceCli: 'test-cli',
      globalNestedKey: 'mcp.servers',
    };

    const def = toAgentDef(custom);
    expect(def.format).toBe('toml');
    expect(def.preferredTransport).toBe('http');
    expect(def.presenceCli).toBe('test-cli');
    expect(def.globalNestedKey).toBe('mcp.servers');
  });
});

/* ─── validateCustomAgentInput ─── */

describe('validateCustomAgentInput', () => {
  it('returns null for valid input', () => {
    const err = validateCustomAgentInput(
      { name: 'QCLaw', baseDir: '~/.qclaw/' },
      new Set(),
    );
    expect(err).toBeNull();
  });

  it('rejects empty name', () => {
    const err = validateCustomAgentInput(
      { name: '', baseDir: '~/.qclaw/' },
      new Set(),
    );
    expect(err).toBe('Agent name is required');
  });

  it('rejects empty baseDir', () => {
    const err = validateCustomAgentInput(
      { name: 'Test', baseDir: '' },
      new Set(),
    );
    expect(err).toBe('Config directory is required');
  });

  it('rejects relative path', () => {
    const err = validateCustomAgentInput(
      { name: 'Test', baseDir: 'relative/path' },
      new Set(),
    );
    expect(err).toContain('absolute path');
  });

  it('rejects key conflict with built-in agent', () => {
    const err = validateCustomAgentInput(
      { name: 'Cursor', baseDir: '~/.my-cursor/' },
      new Set(),
    );
    expect(err).toContain('Conflicts with built-in agent');
  });

  it('rejects key conflict with existing custom agent', () => {
    const err = validateCustomAgentInput(
      { name: 'QCLaw', baseDir: '~/.qclaw/' },
      new Set(['qclaw']),
    );
    expect(err).toContain('already exists');
  });

  it('skips key conflict check in edit mode', () => {
    const err = validateCustomAgentInput(
      { name: 'QCLaw', baseDir: '~/.qclaw/' },
      new Set(['qclaw']),
      true,
    );
    expect(err).toBeNull();
  });

  it('accepts absolute path starting with /', () => {
    const err = validateCustomAgentInput(
      { name: 'Test', baseDir: '/opt/test/' },
      new Set(),
    );
    expect(err).toBeNull();
  });
});

/* ─── loadCustomAgents / saveCustomAgents ─── */

describe('loadCustomAgents', () => {
  it('returns empty array when no customAgents in config', () => {
    mockCustomAgents = [];
    const result = loadCustomAgents();
    expect(result).toEqual([]);
  });

  it('filters out invalid entries', () => {
    mockCustomAgents = [
      { name: 'Valid', key: 'valid', baseDir: '~/.valid/' },
      { invalid: true },
      null,
      'string',
    ];
    const result = loadCustomAgents();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Valid');
  });
});

/* ─── getAllAgents ─── */

describe('getAllAgents', () => {
  it('returns built-in agents when no custom agents exist', () => {
    mockCustomAgents = [];
    const all = getAllAgents();
    expect('cursor' in all).toBe(true);
    expect('claude-code' in all).toBe(true);
  });

  it('merges custom agents with built-in ones', () => {
    mockCustomAgents = [
      {
        name: 'QCLaw',
        key: 'qclaw',
        baseDir: '~/.qclaw/',
        global: '~/.qclaw/mcp.json',
        configKey: 'mcpServers',
        format: 'json',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.qclaw/'],
      },
    ];
    const all = getAllAgents();
    expect('qclaw' in all).toBe(true);
    expect(all.qclaw.name).toBe('QCLaw');
  });

  it('built-in agents take priority on key collision', () => {
    mockCustomAgents = [
      {
        name: 'My Cursor',
        key: 'cursor',
        baseDir: '~/.my-cursor/',
        global: '~/.my-cursor/mcp.json',
        configKey: 'mcpServers',
        format: 'json',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.my-cursor/'],
      },
    ];
    const all = getAllAgents();
    expect(all.cursor.name).toBe('Cursor'); // built-in wins
  });
});

/* ─── detectBaseDir ─── */

describe('detectBaseDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-detect-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns exists=false for non-existent directory', () => {
    const result = detectBaseDir('/tmp/nonexistent-dir-' + Date.now());
    expect(result.exists).toBe(false);
    expect(result.hasSkillsDir).toBe(false);
  });

  it('returns exists=true for existing directory', () => {
    const result = detectBaseDir(tempDir);
    expect(result.exists).toBe(true);
  });

  it('detects JSON config with mcpServers key', () => {
    fs.writeFileSync(
      path.join(tempDir, 'mcp.json'),
      JSON.stringify({ mcpServers: {} }),
    );
    const result = detectBaseDir(tempDir);
    expect(result.exists).toBe(true);
    expect(result.detectedFormat).toBe('json');
    expect(result.detectedConfigKey).toBe('mcpServers');
    expect(result.detectedConfig).toContain('mcp.json');
  });

  it('detects JSON config with servers key', () => {
    fs.writeFileSync(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({ servers: {} }),
    );
    const result = detectBaseDir(tempDir);
    expect(result.detectedFormat).toBe('json');
    expect(result.detectedConfigKey).toBe('servers');
  });

  it('detects skills/ subdirectory', () => {
    fs.mkdirSync(path.join(tempDir, 'skills'));
    const result = detectBaseDir(tempDir);
    expect(result.hasSkillsDir).toBe(true);
  });

  it('detects TOML config with mcp_servers section', () => {
    fs.writeFileSync(
      path.join(tempDir, 'config.toml'),
      '[mcp_servers]\nmindos = { command = "npx" }\n',
    );
    const result = detectBaseDir(tempDir);
    expect(result.detectedFormat).toBe('toml');
    expect(result.detectedConfigKey).toBe('mcp_servers');
  });

  it('handles empty directory', () => {
    const result = detectBaseDir(tempDir);
    expect(result.exists).toBe(true);
    expect(result.detectedConfig).toBeUndefined();
    expect(result.hasSkillsDir).toBe(false);
  });

  it('suggests name from directory name', () => {
    const namedDir = path.join(tempDir, 'qclaw');
    fs.mkdirSync(namedDir);
    const result = detectBaseDir(namedDir);
    expect(result.suggestedName).toBe('Qclaw');
  });
});
