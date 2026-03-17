export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/* ── Constants ────────────────────────────────────────────────── */

const GITHUB_SOURCE = 'GeminiLight/MindOS';

// Universal agents read directly from ~/.agents/skills/ — no symlink needed.
const UNIVERSAL_AGENTS = new Set([
  'amp', 'cline', 'codex', 'cursor', 'gemini-cli',
  'github-copilot', 'kimi-cli', 'opencode', 'warp',
]);

// Agents that do NOT support Skills at all
const SKILL_UNSUPPORTED = new Set<string>([]);

// MCP agent key → npx skills agent name (for non-universal agents)
const AGENT_NAME_MAP: Record<string, string> = {
  'claude-code': 'claude-code',
  'windsurf': 'windsurf',
  'trae': 'trae',
  'openclaw': 'openclaw',
  'codebuddy': 'codebuddy',
  'iflow-cli': 'iflow-cli',
  'pi': 'pi',
  'augment': 'augment',
  'qwen-code': 'qwen-code',
  'trae-cn': 'trae-cn',
  'roo': 'roo',
};

/* ── Helpers ──────────────────────────────────────────────────── */

/** Fallback: find local skills directory for offline installs */
function findLocalSkillsDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'data/skills'),   // app/data/skills/
    path.resolve(process.cwd(), '..', 'skills'),   // project-root/skills/
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function buildCommand(
  source: string,
  skill: string,
  additionalAgents: string[],
): string {
  // Each agent needs its own -a flag (skills CLI does NOT accept comma-separated)
  const agentFlags = additionalAgents.length > 0
    ? additionalAgents.map(a => `-a ${a}`).join(' ')
    : '-a universal';
  // Quote source if it looks like a local path (contains / or \)
  const quotedSource = /[/\\]/.test(source) ? `"${source}"` : source;
  return `npx skills add ${quotedSource} --skill ${skill} ${agentFlags} -g -y`;
}

/* ── POST handler ─────────────────────────────────────────────── */

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

    const additionalAgents = (agents || [])
      .filter(key => !UNIVERSAL_AGENTS.has(key) && !SKILL_UNSUPPORTED.has(key))
      .map(key => AGENT_NAME_MAP[key] || key);

    // Try GitHub source first, fall back to local path
    const sources = [GITHUB_SOURCE];
    const localDir = findLocalSkillsDir();
    if (localDir) sources.push(localDir);

    let lastCmd = '';
    let lastStdout = '';
    let lastStderr = '';

    for (const source of sources) {
      const cmd = buildCommand(source, skill, additionalAgents);
      lastCmd = cmd;
      try {
        lastStdout = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 30_000,
          env: { ...process.env, NODE_ENV: 'production' },
          stdio: 'pipe',
        });
        // Success — return immediately
        return NextResponse.json({
          ok: true,
          skill,
          agents: additionalAgents,
          cmd,
          stdout: lastStdout.trim(),
        });
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        lastStdout = e.stdout || '';
        lastStderr = e.stderr || e.message || 'Unknown error';
        // Try next source
      }
    }

    // All sources failed
    return NextResponse.json({
      ok: false,
      skill,
      agents: additionalAgents,
      cmd: lastCmd,
      stdout: lastStdout,
      stderr: lastStderr,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
