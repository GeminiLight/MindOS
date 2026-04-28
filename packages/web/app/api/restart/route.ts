export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { handleRouteErrorSimple } from '@/lib/errors';
import { resolveMindosCliPath } from '@/lib/project-root';

/**
 * Strip ALL MINDOS_ and MIND_ prefixed env vars so the restart child
 * process re-derives paths from its own installation root.
 * Preserves old port values via MINDOS_OLD_ for cleanup.
 */
function cleanEnvForRestart(): { env: NodeJS.ProcessEnv; oldWebPort?: string; oldMcpPort?: string } {
  const cleaned = { ...process.env };
  const oldWebPort = cleaned.MINDOS_WEB_PORT;
  const oldMcpPort = cleaned.MINDOS_MCP_PORT;
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith('MINDOS_') || key.startsWith('MIND_')) {
      delete cleaned[key];
    }
  }
  delete cleaned.AUTH_TOKEN;
  delete cleaned.WEB_PASSWORD;
  delete cleaned.NODE_OPTIONS;
  // Pass old ports so restart command can clean up stale listeners
  if (oldWebPort) cleaned.MINDOS_OLD_WEB_PORT = oldWebPort;
  if (oldMcpPort) cleaned.MINDOS_OLD_MCP_PORT = oldMcpPort;
  return { env: cleaned, oldWebPort, oldMcpPort };
}

export async function POST() {
  try {
    // Resolve CLI path BEFORE cleaning env (we still need current vars)
    const cliPath = resolveMindosCliPath();
    const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;

    const { env: childEnv } = cleanEnvForRestart();
    const child = spawn(nodeBin, [cliPath, 'restart'], {
      detached: true,
      stdio: 'ignore',
      env: childEnv,
    });
    child.unref();
    // Give a brief moment for the response to be sent before exiting.
    // The spawned 'restart' command will handle stopping this process via
    // stopMindos() (kill by PID + port cleanup), so process.exit here is
    // just a safety net in case the parent isn't killed cleanly.
    setTimeout(() => process.exit(0), 1500);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
