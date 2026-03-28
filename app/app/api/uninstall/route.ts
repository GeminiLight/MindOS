export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * POST /api/uninstall
 *
 * Accepts JSON body: { removeConfig?: boolean }
 *
 * Always: stops services + removes daemon + npm uninstall -g.
 * Optionally: removes ~/.mindos/ config directory.
 * Knowledge base is NEVER touched from the Web UI.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const removeConfig = body.removeConfig !== false; // default true

    const cliPath = process.env.MINDOS_CLI_PATH || resolve(process.env.MINDOS_PROJECT_ROOT || process.cwd(), '..', 'bin', 'cli.js');
    const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;

    // Build stdin answers for the interactive CLI prompts:
    // 1. "Proceed with uninstall?" → always Y
    // 2. "Remove config directory?" → Y or N based on option
    // 3. "Remove knowledge base?" → always N (never delete KB from Web UI)
    const answers = `Y\n${removeConfig ? 'Y' : 'N'}\nN\n`;

    const child = spawn(nodeBin, [cliPath, 'uninstall'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env },
    });

    if (child.stdin) {
      child.stdin.write(answers);
      child.stdin.end();
    }

    child.unref();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
