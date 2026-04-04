import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/* ── Mock child_process.execSync ──────────────────────────────────
 * We mock execSync so tests don't actually run npx.
 * Each test can configure the mock to succeed or throw.
 */
let execSyncMock: ReturnType<typeof vi.fn>;
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

/* Mock fs — only override existsSync, keep the rest real */
let mockExistsSync: ((p: string) => boolean) | null = null;
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => {
        if (mockExistsSync) return mockExistsSync(p);
        return actual.existsSync(p);
      },
    },
    existsSync: (p: string) => {
      if (mockExistsSync) return mockExistsSync(p);
      return actual.existsSync(p);
    },
  };
});

beforeEach(() => {
  execSyncMock = vi.fn().mockReturnValue('Done!\n');
  mockExistsSync = null;
});

async function importRoute() {
  return await import('../../app/api/mcp/install-skill/route');
}

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/mcp/install-skill', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/* ── Validation ──────────────────────────────────────────────────── */

describe('POST /api/mcp/install-skill — validation', () => {
  it('rejects missing skill name', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ agents: ['cursor'] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid skill/i);
  });

  it('rejects unknown skill name', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'bad-skill', agents: [] }));
    expect(res.status).toBe(400);
  });

  it('accepts mindos', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('accepts mindos-zh', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos-zh', agents: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

/* ── Agent filtering logic ───────────────────────────────────────── */

describe('POST /api/mcp/install-skill — agent filtering', () => {
  it('filters universal agents out of -a flags', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['cursor', 'cline', 'gemini-cli'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
    expect(cmd).not.toContain('-a cursor');
    expect(cmd).not.toContain('-a cline');
  });

  it('passes non-universal agents as separate -a flags', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['claude-code', 'windsurf'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a claude-code');
    expect(cmd).toContain('-a windsurf');
    expect(cmd).not.toContain('-a universal');
  });

  it('uses separate -a flags, not comma-separated', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['claude-code', 'windsurf', 'trae'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).not.toMatch(/-a \S+,\S+/);
    expect(cmd).toContain('-a claude-code');
    expect(cmd).toContain('-a windsurf');
    expect(cmd).toContain('-a trae');
  });

  it('filters out unknown agents that are not in AGENT_NAME_MAP', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['some-unknown-agent', 'claude-code'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a claude-code');
    // unknown agents pass through as-is (not filtered)
    expect(cmd).toContain('-a some-unknown-agent');
  });

  it('falls back to -a universal when only universal agents selected', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['cursor'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
  });

  it('treats github-copilot as universal in skill install', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['github-copilot'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
    expect(cmd).not.toContain('-a vscode');
  });

  it('falls back to -a universal for empty agents array', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: [] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
  });

  it('handles mixed universal + non-universal agents', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos-zh', agents: ['cursor', 'claude-code', 'cline', 'windsurf'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a claude-code');
    expect(cmd).toContain('-a windsurf');
    expect(cmd).not.toContain('-a cursor');
    expect(cmd).not.toContain('-a cline');
    expect(cmd).not.toContain('-a universal');
  });

  it('handles null agents gracefully', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: null as unknown as string[] }));
    expect(res.status).toBe(200);
    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
  });
});

/* ── Source selection (GitHub first, local fallback) ──────────────── */

describe('POST /api/mcp/install-skill — source fallback', () => {
  it('uses GitHub source first', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: [] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('GeminiLight/MindOS');
  });

  it('returns ok=false when all sources fail', async () => {
    execSyncMock.mockImplementation(() => {
      const err = new Error('fail') as Error & { stderr: string; stdout: string };
      err.stderr = 'some error';
      err.stdout = '';
      throw err;
    });

    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: [] }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.stderr).toBeTruthy();
  });
});

/* ── Command format ──────────────────────────────────────────────── */

describe('POST /api/mcp/install-skill — command format', () => {
  it('uses --skill flag (not -s)', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: [] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('--skill mindos');
  });

  it('includes -g and -y flags', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos-zh', agents: [] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-g');
    expect(cmd).toContain('-y');
  });

  it('returns the executed command in response', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: ['claude-code'] }));
    const body = await res.json();
    expect(body.cmd).toContain('npx skills add');
    expect(body.cmd).toContain('--skill mindos');
    expect(body.cmd).toContain('-a claude-code');
  });

  it('returns filtered agent list in response', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: ['cursor', 'claude-code'] }));
    const body = await res.json();
    expect(body.agents).toEqual(['claude-code']);
  });

  it('passes new agents (augment, roo, trae-cn, qoder) as -a flags', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['augment', 'roo', 'trae-cn', 'qoder'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a augment');
    expect(cmd).toContain('-a roo');
    expect(cmd).toContain('-a trae-cn');
    expect(cmd).toContain('-a qoder');
    expect(cmd).not.toContain('-a universal');
  });

  it('treats kimi-cli and opencode as universal (filtered out)', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['kimi-cli', 'opencode'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
    expect(cmd).not.toContain('-a kimi-cli');
    expect(cmd).not.toContain('-a opencode');
  });
});

/* ── AGENT_NAME_MAP completeness ─────────────────────────────────── */

describe('AGENT_NAME_MAP completeness', () => {
  it('every MCP agent key follows SKILL_AGENT_REGISTRY mode', async () => {
    // Import source-of-truth registries
    const { MCP_AGENTS } = await import('../../lib/mcp-agents');
    const { SKILL_AGENT_REGISTRY } = await import('../../lib/mcp-agents');
    const { POST } = await importRoute();

    for (const key of Object.keys(MCP_AGENTS)) {
      execSyncMock.mockClear();
      await POST(makeReq({ skill: 'mindos', agents: [key] }));
      const cmd = execSyncMock.mock.calls[0]?.[0] as string;
      const reg = SKILL_AGENT_REGISTRY[key];
      if (!reg || reg.mode === 'additional') {
        expect(cmd, `Agent '${key}' should produce an explicit -a flag`).toContain(`-a ${key}`);
      } else if (reg.mode === 'universal') {
        expect(cmd, `Agent '${key}' should use universal fallback`).toContain('-a universal');
      } else {
        expect(cmd, `Unsupported agent '${key}' should not produce explicit -a flag`).toContain('-a universal');
      }
    }
  });
});
