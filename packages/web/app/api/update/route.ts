export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { handleRouteErrorSimple } from '@/lib/errors';
import { resolveMindosCliPath } from '@/lib/project-root';

/**
 * Strip ALL MINDOS_ and MIND_ prefixed env vars so the update child
 * process re-derives paths from its own installation root after npm install.
 * This prevents the "fake update" bug where the new process inherits
 * stale MINDOS_PROJECT_ROOT / MINDOS_CLI_PATH pointing to old code.
 */
function cleanEnvForUpdate(): NodeJS.ProcessEnv {
  const cleaned = { ...process.env };
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith('MINDOS_') || key.startsWith('MIND_')) {
      delete cleaned[key];
    }
  }
  delete cleaned.AUTH_TOKEN;
  delete cleaned.WEB_PASSWORD;
  delete cleaned.NODE_OPTIONS;
  return cleaned;
}

/**
 * POST /api/update — trigger `mindos update` as a detached child process.
 *
 * Spawns the CLI command and returns immediately. The update process will
 * npm install, remove build stamp, and restart the server.
 * The current process will be killed during restart.
 */
export async function POST() {
  try {
    // Resolve CLI path BEFORE cleaning env (we still need current vars)
    const cliPath = resolveMindosCliPath();
    const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;

    const childEnv = cleanEnvForUpdate();

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
    return handleRouteErrorSimple(err);
  }
}
