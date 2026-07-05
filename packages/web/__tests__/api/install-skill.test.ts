import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mockState = vi.hoisted(() => ({
  homeDir: '',
  execFileSyncMock: vi.fn(),
}));

/* ── Mock child_process.execFileSync ───────────────────────────────
 * We mock execFileSync so tests don't actually run npx.
 * Each test can configure the mock to succeed or throw.
 */
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mockState.execFileSyncMock(...args),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('os');
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => mockState.homeDir || actual.homedir(),
    },
    homedir: () => mockState.homeDir || actual.homedir(),
  };
});

beforeEach(() => {
  mockState.execFileSyncMock = vi.fn().mockReturnValue('Done!\n');
  mockState.homeDir = mkdtempSync(path.join(tmpdir(), 'mindos-web-install-skill-home-'));
});

afterEach(() => {
  if (mockState.homeDir) rmSync(mockState.homeDir, { recursive: true, force: true });
  mockState.homeDir = '';
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

/* ── Local install ───────────────────────────────────────────────── */

describe('POST /api/mcp/install-skill — local install', () => {
  it('installs the default skill to the universal shared workspace without npx', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: [] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      method: 'local-copy',
      agents: [],
      results: [{ agent: 'universal', status: 'copied' }],
    });
    expect(mockState.execFileSyncMock).not.toHaveBeenCalled();
    expect(existsSync(path.join(mockState.homeDir, '.agents', 'skills', 'mindos', 'SKILL.md'))).toBe(true);
  });

  it('installs mixed universal and private skill-dir agents locally', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos-zh', agents: ['codex', 'claude-code'] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      method: 'local-copy',
      agents: ['codex', 'claude-code'],
      results: [
        { agent: 'codex', mode: 'universal' },
        { agent: 'claude-code', mode: 'additional' },
      ],
    });
    expect(mockState.execFileSyncMock).not.toHaveBeenCalled();
    expect(readFileSync(path.join(mockState.homeDir, '.agents', 'skills', 'mindos-zh', 'SKILL.md'), 'utf-8')).toContain('name: mindos-zh');
    expect(readFileSync(path.join(mockState.homeDir, '.claude', 'skills', 'mindos-zh', 'SKILL.md'), 'utf-8')).toContain('name: mindos-zh');
  });

  it('handles null agents as universal local install', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ skill: 'mindos', agents: null as unknown as string[] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toEqual([expect.objectContaining({ agent: 'universal', status: 'copied' })]);
  });
});

/* ── Registry completeness ───────────────────────────────────────── */

describe('AGENT_NAME_MAP completeness', () => {
  it('every MCP agent key follows SKILL_AGENT_REGISTRY mode in local results', async () => {
    const { MCP_AGENTS, SKILL_AGENT_REGISTRY } = await import('../../lib/mcp-agents');
    const { POST } = await importRoute();

    for (const key of Object.keys(MCP_AGENTS)) {
      const res = await POST(makeReq({ skill: 'mindos', agents: [key] }));
      const body = await res.json();
      const reg = SKILL_AGENT_REGISTRY[key];
      expect(body.results?.[0], `Agent '${key}' should return a local install result`).toMatchObject({
        agent: key,
        mode: reg?.mode ?? 'unsupported',
      });
    }
  });
});
