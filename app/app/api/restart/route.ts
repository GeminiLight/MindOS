export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export async function POST() {
  try {
    const cliPath = process.env.MINDOS_CLI_PATH || resolve(process.env.MINDOS_PROJECT_ROOT || process.cwd(), '..', 'bin', 'cli.js');
    const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;
    // Use 'restart' (stop all → wait for ports free → start) instead of bare
    // 'start' which would fail assertPortFree because the current process and
    // its MCP child are still holding the ports.
    //
    // IMPORTANT: Strip MINDOS_* env vars so the child's loadConfig() reads
    // the *updated* config file instead of inheriting stale values from this
    // process.  Without this, changing ports in the GUI has no effect on the
    // restarted server — it would start on the old ports.
    //
    // Pass the current (old) ports via MINDOS_OLD_* so the restart command
    // can clean up processes still listening on the previous ports.
    const childEnv = { ...process.env };
    const oldWebPort = childEnv.MINDOS_WEB_PORT;
    const oldMcpPort = childEnv.MINDOS_MCP_PORT;
    delete childEnv.MINDOS_WEB_PORT;
    delete childEnv.MINDOS_MCP_PORT;
    delete childEnv.MIND_ROOT;
    delete childEnv.AUTH_TOKEN;
    delete childEnv.WEB_PASSWORD;
    if (oldWebPort) childEnv.MINDOS_OLD_WEB_PORT = oldWebPort;
    if (oldMcpPort) childEnv.MINDOS_OLD_MCP_PORT = oldMcpPort;
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
