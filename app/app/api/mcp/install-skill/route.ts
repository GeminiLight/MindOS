export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';

/* ── Agent classification ──────────────────────────────────────── */

// Universal agents read directly from ~/.agents/skills/ — no symlink needed.
const UNIVERSAL_AGENTS = new Set([
  'amp', 'cline', 'codex', 'cursor', 'gemini-cli',
  'github-copilot', 'kimi-cli', 'opencode', 'warp',
]);

// Agents that do NOT support Skills at all
const SKILL_UNSUPPORTED = new Set(['claude-desktop']);

// MCP agent key → npx skills agent name (for non-universal agents)
// Keys not listed here and not in UNIVERSAL/UNSUPPORTED will use the key as-is.
const AGENT_NAME_MAP: Record<string, string> = {
  'claude-code': 'claude-code',
  'windsurf': 'windsurf',
  'trae': 'trae',
  'openclaw': 'openclaw',
  'codebuddy': 'codebuddy',
};

/* ── POST handler ──────────────────────────────────────────────── */

interface SkillInstallRequest {
  skill: 'mindos' | 'mindos-zh';
  agents: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body: SkillInstallRequest = await req.json();
    const { skill, agents } = body;

    if (!skill || !['mindos', 'mindos-zh'].includes(skill)) {
      return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 });
    }

    // Source path: project root `skills/` directory
    const source = path.resolve(process.cwd(), 'skills');

    // Non-universal, skill-capable agents need explicit `-a` for symlink creation
    const additionalAgents = (agents || [])
      .filter(key => !UNIVERSAL_AGENTS.has(key) && !SKILL_UNSUPPORTED.has(key))
      .map(key => AGENT_NAME_MAP[key] || key);

    let cmd: string;
    if (additionalAgents.length > 0) {
      // Any -a command will also copy to ~/.agents/skills/ (Universal coverage)
      cmd = `npx skills add "${source}" -s ${skill} -a ${additionalAgents.join(',')} -g -y`;
    } else {
      // Fallback: only install to ~/.agents/skills/ for Universal agents
      cmd = `npx skills add "${source}" -s ${skill} -a universal -g -y`;
    }

    let stdout = '';
    let stderr = '';
    try {
      stdout = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30_000,
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      stdout = e.stdout || '';
      stderr = e.stderr || e.message || 'Unknown error';
      return NextResponse.json({
        ok: false,
        skill,
        agents: additionalAgents,
        cmd,
        stdout,
        stderr,
      });
    }

    return NextResponse.json({
      ok: true,
      skill,
      agents: additionalAgents,
      cmd,
      stdout: stdout.trim(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
