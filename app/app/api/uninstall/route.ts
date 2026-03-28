export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * POST /api/uninstall
 *
 * Spawns a non-interactive uninstall process that:
 * 1. Stops all running MindOS processes
 * 2. Removes the background daemon (launchd/systemd)
 * 3. Removes ~/.mindos/ config directory
 * 4. Runs npm uninstall -g @geminilight/mindos
 *
 * Knowledge base is NOT touched.
 * The process runs detached — this server will be killed as part of the uninstall.
 */
export async function POST() {
  try {
    const cliPath = process.env.MINDOS_CLI_PATH || resolve(process.env.MINDOS_PROJECT_ROOT || process.cwd(), '..', 'bin', 'cli.js');
    const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;

    // Spawn the CLI uninstall with pre-answered stdin (Y to proceed, Y to remove config, N to remove KB).
    // This avoids interactive prompts since we're running from the Web UI.
    const child = spawn(nodeBin, [cliPath, 'uninstall'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env },
    });

    // Pre-answer the interactive prompts:
    // 1. "Proceed with uninstall?" → Y
    // 2. "Remove config directory?" → Y
    // 3. "Remove knowledge base?" → N (never delete KB from Web UI)
    if (child.stdin) {
      child.stdin.write('Y\nY\nN\n');
      child.stdin.end();
    }

    child.unref();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
