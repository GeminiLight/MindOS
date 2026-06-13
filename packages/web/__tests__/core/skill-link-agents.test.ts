import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { listSkillLinkAgents } from '@/lib/mcp-agents';

/**
 * listSkillLinkAgents — the downstream-agent list backing the (skill × agent)
 * matrix: only present, skill-capable agents appear, plus present custom agents.
 */

// Partial mock: the @geminilight/mindos/server module graph needs the real
// execFile — only the CLI lookup helpers used by presence detection are stubbed.
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: vi.fn(),
  execSync: vi.fn(() => { throw new Error('shell command lookup should not be used'); }),
}));

vi.mock('@geminilight/mindos/server', async () => {
  return await import('../../../mindos/src/server');
});

const settingsState = vi.hoisted(() => ({
  customAgents: [] as unknown[],
}));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({
    ai: { activeProvider: '', providers: [] },
    mindRoot: '',
    customAgents: settingsState.customAgents,
  }),
  writeSettings: vi.fn(),
  readInstalledSkillAgents: vi.fn(() => []),
  clearInstalledSkillAgents: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

function mockDirent(name: string, kind: 'file' | 'dir' = 'dir'): fs.Dirent {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => false,
  } as fs.Dirent;
}

describe('listSkillLinkAgents', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let statSyncSpy: ReturnType<typeof vi.spyOn>;
  let readdirSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    settingsState.customAgents = [];
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
    statSyncSpy = vi.spyOn(fs, 'statSync');
    readdirSyncSpy = vi.spyOn(fs, 'readdirSync');
    mockExecFileSync.mockReset();
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
    existsSyncSpy.mockReturnValue(false);
    statSyncSpy.mockImplementation(() => { throw new Error('stat path not mocked'); });
    readdirSyncSpy.mockImplementation(() => { throw new Error('readdir path not mocked'); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists present additional-mode agents with their own skill directory', () => {
    // claude CLI present; ~/.claude exists for skill-dir resolution.
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args[0] === 'claude') return Buffer.from('/usr/bin/claude');
      throw new Error('not found');
    });
    existsSyncSpy.mockImplementation((p: fs.PathLike) => String(p).includes(`${path.sep}.claude`));
    statSyncSpy.mockReturnValue({ isFile: () => false, isDirectory: () => true } as fs.Stats);

    const agents = listSkillLinkAgents();

    expect(agents.map((agent) => agent.key)).toEqual(['claude-code']);
    expect(agents[0]).toEqual({
      key: 'claude-code',
      name: 'Claude Code',
      mode: 'additional',
      skillDir: path.join(os.homedir(), '.claude', 'skills'),
    });
  });

  it('excludes unsupported-mode agents even when they are present on this machine', () => {
    // hermes (unsupported) and claude (additional) CLIs both resolve.
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && (args[0] === 'hermes' || args[0] === 'claude')) return Buffer.from('/usr/bin/found');
      throw new Error('not found');
    });
    existsSyncSpy.mockImplementation((p: fs.PathLike) => String(p).includes(`${path.sep}.claude`));
    statSyncSpy.mockReturnValue({ isFile: () => false, isDirectory: () => true } as fs.Stats);

    const keys = listSkillLinkAgents().map((agent) => agent.key);

    expect(keys).toContain('claude-code');
    expect(keys).not.toContain('hermes');
    expect(keys).not.toContain('mindos');
  });

  it('excludes agents that are not detected on this machine', () => {
    const agents = listSkillLinkAgents();
    expect(agents).toEqual([]);
  });

  it('maps present universal-mode agents to the shared ~/.agents/skills directory', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => String(p).includes('.cursor'));
    statSyncSpy.mockReturnValue({ isFile: () => false, isDirectory: () => true } as fs.Stats);
    readdirSyncSpy.mockReturnValue([mockDirent('some-extension')] as unknown as ReturnType<typeof fs.readdirSync>);

    const agents = listSkillLinkAgents();

    expect(agents).toEqual([{
      key: 'cursor',
      name: 'Cursor',
      mode: 'universal',
      skillDir: path.join(os.homedir(), '.agents', 'skills'),
      // The mock reports the agent's own skills dir as existing, so the
      // private-dir awareness field is populated alongside the shared pool.
      nativeSkillDir: path.join(os.homedir(), '.cursor', 'extensions', 'skills'),
    }]);
  });

  it('omits nativeSkillDir when the universal agent has no own skills directory on disk', () => {
    // Presence dir exists, but its /skills child does not.
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      const str = String(p);
      return str.includes('.cursor') && !str.endsWith(`${path.sep}skills`);
    });
    statSyncSpy.mockReturnValue({ isFile: () => false, isDirectory: () => true } as fs.Stats);
    readdirSyncSpy.mockReturnValue([mockDirent('some-extension')] as unknown as ReturnType<typeof fs.readdirSync>);

    const agents = listSkillLinkAgents();

    expect(agents).toEqual([{
      key: 'cursor',
      name: 'Cursor',
      mode: 'universal',
      skillDir: path.join(os.homedir(), '.agents', 'skills'),
      nativeSkillDir: undefined,
    }]);
  });

  it('appends present custom agents and skips absent ones', () => {
    settingsState.customAgents = [
      {
        name: 'Foo Agent', key: 'foo-agent', baseDir: '~/.foo/', global: '~/.foo/mcp.json',
        configKey: 'mcpServers', format: 'json', preferredTransport: 'stdio', presenceDirs: ['~/.foo/'],
      },
      {
        name: 'Bar Agent', key: 'bar-agent', baseDir: '~/.bar/', global: '~/.bar/mcp.json',
        configKey: 'mcpServers', format: 'json', preferredTransport: 'stdio', presenceDirs: ['~/.bar/'],
      },
    ];
    existsSyncSpy.mockImplementation((p: fs.PathLike) => String(p).includes(`${path.sep}.foo`));

    const agents = listSkillLinkAgents();

    expect(agents).toEqual([{
      key: 'foo-agent',
      name: 'Foo Agent',
      mode: 'additional',
      skillDir: path.join(os.homedir(), '.foo', 'skills'),
    }]);
  });

  it('uses the custom agent skillDir override when configured', () => {
    settingsState.customAgents = [{
      name: 'Foo Agent', key: 'foo-agent', baseDir: '~/.foo/', global: '~/.foo/mcp.json',
      configKey: 'mcpServers', format: 'json', preferredTransport: 'stdio',
      presenceDirs: ['~/.foo/'], skillDir: '~/.foo/custom-skills/',
    }];
    existsSyncSpy.mockImplementation((p: fs.PathLike) => String(p).includes(`${path.sep}.foo`));

    const agents = listSkillLinkAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0].skillDir).toBe(path.join(os.homedir(), '.foo', 'custom-skills'));
  });
});
