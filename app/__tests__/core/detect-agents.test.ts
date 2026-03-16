import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { execSync } from 'child_process';
import { detectAgentPresence, MCP_AGENTS } from '@/lib/mcp-agents';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('detectAgentPresence', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
    mockExecSync.mockReset();
    existsSyncSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for unknown agent key', () => {
    expect(detectAgentPresence('nonexistent-agent')).toBe(false);
  });

  it('returns true when CLI is found via which', () => {
    mockExecSync.mockReturnValue(Buffer.from('/usr/bin/claude'));
    existsSyncSpy.mockReturnValue(false);
    expect(detectAgentPresence('claude-code')).toBe(true);
  });

  it('returns true when data directory exists (no CLI)', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).includes('.cursor');
    });
    expect(detectAgentPresence('cursor')).toBe(true);
  });

  it('returns false when neither CLI nor dirs found', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    existsSyncSpy.mockReturnValue(false);
    expect(detectAgentPresence('claude-code')).toBe(false);
  });

  it('returns true when dir found even if CLI fails (gemini-cli)', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).includes('.gemini');
    });
    expect(detectAgentPresence('gemini-cli')).toBe(true);
  });

  it('detects claude-desktop via dir only (no CLI check)', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).includes('Claude');
    });
    expect(detectAgentPresence('claude-desktop')).toBe(true);
    // claude-desktop has no presenceCli, so execSync should not be called
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('detects cline via globalStorage dir', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return String(p).includes('saoudrizwan.claude-dev');
    });
    expect(detectAgentPresence('cline')).toBe(true);
  });

  it('detects codebuddy via claude-internal CLI', () => {
    mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/claude-internal'));
    existsSyncSpy.mockReturnValue(false);
    expect(detectAgentPresence('codebuddy')).toBe(true);
  });

  it('every agent in MCP_AGENTS has presenceCli or presenceDirs', () => {
    for (const [key, agent] of Object.entries(MCP_AGENTS)) {
      const hasCli = !!agent.presenceCli;
      const hasDirs = Array.isArray(agent.presenceDirs) && agent.presenceDirs.length > 0;
      expect(hasCli || hasDirs, `${key} missing presenceCli and presenceDirs`).toBe(true);
    }
  });
});
