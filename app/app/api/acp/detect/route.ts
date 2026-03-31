export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getAcpAgents } from '@/lib/acp/registry';

/* ── Agent ID → binary name mapping ─────────────────────────────────── */

const AGENT_BINARY_MAP: Record<string, string> = {
  claude: 'claude',
  'claude-code': 'claude',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  codex: 'codex',
  cursor: 'cursor',
  cline: 'cline',
  goose: 'goose',
  opencode: 'opencode',
  kilo: 'kilo',
  codebuddy: 'codebuddy',
  openclaw: 'openclaw',
  pi: 'pi',
  augment: 'auggie',
  iflow: 'iflow',
  kimi: 'kimi',
};

const INSTALL_COMMANDS: Record<string, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  'claude-code': 'npm install -g @anthropic-ai/claude-code',
  gemini: 'npm install -g @anthropic-ai/claude-code && npx @anthropic-ai/claude-code',
  'gemini-cli': 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  goose: 'pip install goose-ai',
  opencode: 'go install github.com/opencode-ai/opencode@latest',
  codebuddy: 'npm install -g @anthropic-ai/claude-code',
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
}

function whichBinary(binary: string): string | null {
  try {
    return execSync(`which ${binary}`, { encoding: 'utf-8', timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const agents = await getAcpAgents();
    const installed: InstalledAgent[] = [];
    const notInstalled: NotInstalledAgent[] = [];

    for (const agent of agents) {
      const binary = AGENT_BINARY_MAP[agent.id] ?? AGENT_BINARY_MAP[agent.command] ?? agent.command;
      if (!binary) {
        notInstalled.push({ id: agent.id, name: agent.name, installCmd: '' });
        continue;
      }

      const binaryPath = whichBinary(binary);
      if (binaryPath) {
        installed.push({ id: agent.id, name: agent.name, binaryPath });
      } else {
        notInstalled.push({
          id: agent.id,
          name: agent.name,
          installCmd: INSTALL_COMMANDS[agent.id] ?? `npm install -g ${agent.command}`,
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
