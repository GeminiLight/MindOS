export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { getAcpAgents } from '@/lib/acp/registry';
import { getDescriptorBinary, getDescriptorInstallCmd, resolveAgentCommand } from '@/lib/acp/agent-descriptors';
import { readSettings } from '@/lib/settings';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface InstalledAgent {
  id: string;
  name: string;
  binaryPath: string;
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

/* ── Server-side detection cache (5 min TTL) ──────────────────────────── */

const DETECT_CACHE_TTL_MS = 5 * 60 * 1000;
let detectCache: { data: { installed: InstalledAgent[]; notInstalled: NotInstalledAgent[] }; ts: number } | null = null;

/* ── Async detection helpers ──────────────────────────────────────────── */

function whichAsync(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = exec(`which ${binary}`, { encoding: 'utf-8', timeout: 2000 }, (err, stdout) => {
      resolve(err ? null : (stdout.trim() || null));
    });
    child.on('error', () => resolve(null));
  });
}

/**
 * Batch `which` for multiple unique binaries in a single call.
 * Returns a Map<binary, path | null>.
 */
async function whichBatch(binaries: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(binaries)];
  if (unique.length === 0) return new Map();

  const results = await Promise.all(unique.map(async (bin) => {
    const path = await whichAsync(bin);
    return [bin, path] as const;
  }));

  return new Map(results);
}

/* ── Route handler ─────────────────────────────────────────────────────── */

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get('force') === '1';
    if (!force && detectCache && Date.now() - detectCache.ts < DETECT_CACHE_TTL_MS) {
      return NextResponse.json(detectCache.data);
    }

    const agents = await getAcpAgents();
    const settings = readSettings();

    const binaryNames = agents.map((a) => getDescriptorBinary(a.id)).filter(Boolean) as string[];
    const whichMap = await whichBatch(binaryNames);

    const installed: InstalledAgent[] = [];
    const notInstalled: NotInstalledAgent[] = [];

    for (const agent of agents) {
      const binary = getDescriptorBinary(agent.id);
      const binaryPath = binary ? (whichMap.get(binary) ?? null) : null;

      if (binaryPath) {
        const userOverride = settings.acpAgents?.[agent.id];
        const resolved = resolveAgentCommand(agent.id, agent, userOverride);
        installed.push({
          id: agent.id,
          name: agent.name,
          binaryPath,
          resolvedCommand: { cmd: resolved.cmd, args: resolved.args, source: resolved.source },
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

    const data = { installed, notInstalled };
    detectCache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, installed: [], notInstalled: [] },
      { status: 500 },
    );
  }
}
