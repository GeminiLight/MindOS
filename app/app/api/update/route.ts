export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * POST /api/update — trigger `mindos update` as a detached child process.
 *
 * Similar to /api/restart: spawns the CLI command and returns immediately.
 * The update process will npm install, remove build stamp, and restart
 * the server. The current process will be killed during restart.
 */
export async function POST() {
  try {
    const cliPath = process.env.MINDOS_CLI_PATH || resolve(process.env.MINDOS_PROJECT_ROOT || process.cwd(), '..', 'bin', 'cli.js');
    const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;

    // Strip MINDOS_* env vars so the child reads fresh config
    const childEnv = { ...process.env };
    delete childEnv.MINDOS_WEB_PORT;
    delete childEnv.MINDOS_MCP_PORT;
    delete childEnv.MIND_ROOT;
    delete childEnv.AUTH_TOKEN;
    delete childEnv.WEB_PASSWORD;

    const child = spawn(nodeBin, [cliPath, 'update'], {
      detached: true,
      stdio: 'ignore',
      env: childEnv,
    });
    child.unref();

    // Unlike /api/restart, we do NOT process.exit() here.
    // `mindos update` will npm install first (30s+), then restart which
    // kills this process. Exiting early would break the response.
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
