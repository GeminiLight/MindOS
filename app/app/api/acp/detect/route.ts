export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getAcpAgents } from '@/lib/acp/registry';
import { getDescriptorBinary, getDescriptorInstallCmd, resolveAgentCommand } from '@/lib/acp/agent-descriptors';
import { readSettings } from '@/lib/settings';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface InstalledAgent {
  id: string;
  name: string;
  binaryPath: string;
  /** Resolved launch command — lets the UI show what will actually run */
  resolvedCommand: {
    cmd: string;
    args: string[];
    source: 'user-override' | 'descriptor' | 'registry';
  };
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
 * Uses unified AGENT_DESCRIPTORS for binary name lookup.
 */
function detectAgent(
  agentId: string,
  packageName?: string,
): string | null {
  // Strategy 1: Check known binary name via `which` (from unified descriptors)
  const binary = getDescriptorBinary(agentId);
  if (binary) {
    const binPath = whichBinary(binary);
    if (binPath) return binPath;
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
    const settings = readSettings();
    const installed: InstalledAgent[] = [];
    const notInstalled: NotInstalledAgent[] = [];

    for (const agent of agents) {
      const userOverride = settings.acpAgents?.[agent.id];
      const binaryPath = detectAgent(agent.id, agent.packageName);

      if (binaryPath) {
        const resolved = resolveAgentCommand(agent.id, agent, userOverride);
        installed.push({
          id: agent.id,
          name: agent.name,
          binaryPath,
          resolvedCommand: {
            cmd: resolved.cmd,
            args: resolved.args,
            source: resolved.source,
          },
        });
      } else {
        const installCmd =
          getDescriptorInstallCmd(agent.id) ??
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
