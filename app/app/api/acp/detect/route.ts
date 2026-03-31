export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getAcpAgents } from '@/lib/acp/registry';

/* ── Agent ID → known binary name mapping ─────────────────────────────── */

const AGENT_BINARY_MAP: Record<string, string> = {
  'claude-acp': 'claude',
  claude: 'claude',
  'claude-code': 'claude',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  'codex-acp': 'codex',
  codex: 'codex',
  cursor: 'cursor',
  cline: 'cline',
  'github-copilot-cli': 'github-copilot',
  goose: 'goose',
  opencode: 'opencode',
  kilo: 'kilo',
  'codebuddy-code': 'codebuddy',
  codebuddy: 'codebuddy',
  openclaw: 'openclaw',
  pi: 'pi',
  'pi-acp': 'pi',
  auggie: 'auggie',
  iflow: 'iflow',
  kimi: 'kimi',
  'qwen-code': 'qwen-code',
};

/* ── Install commands (shown in tooltip / used by install endpoint) ──── */

const INSTALL_COMMANDS: Record<string, string> = {
  'claude-acp': 'npm install -g @anthropic-ai/claude-code',
  gemini: 'npm install -g @google/gemini-cli',
  'codex-acp': 'npm install -g @openai/codex',
  cline: 'npm install -g cline',
  'github-copilot-cli': 'npm install -g @github/copilot',
  kilo: 'npm install -g @kilocode/cli',
  'qwen-code': 'npm install -g @qwen-code/qwen-code',
  'codebuddy-code': 'npm install -g @anthropic-ai/claude-code',
  goose: 'pip install goose-ai',
  opencode: 'go install github.com/opencode-ai/opencode@latest',
};

interface InstalledAgent {
  id: string;
  name: string;
  binaryPath: string;
}

interface NotInstalledAgent {
  id: string;
  name: string;
  installCmd: string;
  packageName?: string;
}

/* ── Detection helpers ─────────────────────────────────────────────────── */

function whichBinary(binary: string): string | null {
  try {
    return execSync(`which ${binary}`, { encoding: 'utf-8', timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

/** Check if an npm package is globally installed */
function isNpmGlobalInstalled(packageName: string): boolean {
  try {
    const out = execSync(`npm list -g ${packageName} --depth=0 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return out.includes(packageName);
  } catch {
    return false;
  }
}

/**
 * Multi-strategy detection for a single agent.
 * 1. `which <binaryName>` — check if globally in PATH
 * 2. For npx agents: `npm list -g <packageName>` — check if npm package exists globally
 * Returns the binary path string if found, or null.
 */
function detectAgent(
  agentId: string,
  packageName?: string,
): string | null {
  // Strategy 1: Check known binary name via `which`
  const binary = AGENT_BINARY_MAP[agentId];
  if (binary) {
    const path = whichBinary(binary);
    if (path) return path;
  }

  // Strategy 2: For npx-based agents, check if the npm package is globally installed
  if (packageName) {
    if (isNpmGlobalInstalled(packageName)) {
      return `npm:global:${packageName}`;
    }
  }

  return null;
}

/* ── Route handler ─────────────────────────────────────────────────────── */

export async function GET() {
  try {
    const agents = await getAcpAgents();
    const installed: InstalledAgent[] = [];
    const notInstalled: NotInstalledAgent[] = [];

    for (const agent of agents) {
      const binaryPath = detectAgent(agent.id, agent.packageName);

      if (binaryPath) {
        installed.push({ id: agent.id, name: agent.name, binaryPath });
      } else {
        const installCmd =
          INSTALL_COMMANDS[agent.id] ??
          (agent.packageName ? `npm install -g ${agent.packageName}` : '');
        notInstalled.push({
          id: agent.id,
          name: agent.name,
          installCmd,
          packageName: agent.packageName,
        });
      }
    }

    return NextResponse.json({ installed, notInstalled });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, installed: [], notInstalled: [] },
      { status: 500 },
    );
  }
}
