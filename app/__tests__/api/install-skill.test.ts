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

  it('filters out claude-desktop (skill-unsupported)', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['claude-desktop', 'claude-code'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a claude-code');
    expect(cmd).not.toContain('-a claude-desktop');
  });

  it('falls back to -a universal when only unsupported agents', async () => {
    const { POST } = await importRoute();
    await POST(makeReq({ skill: 'mindos', agents: ['claude-desktop'] }));

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-a universal');
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
    const res = await POST(makeReq({ skill: 'mindos', agents: ['cursor', 'claude-code', 'claude-desktop'] }));
    const body = await res.json();
    expect(body.agents).toEqual(['claude-code']);
  });
});
