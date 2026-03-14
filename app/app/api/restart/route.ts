export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export async function POST() {
  try {
    // process.cwd() is the Next.js app directory; cli.js is one level up at project root/bin/
    const cliPath = resolve(process.cwd(), '../bin/cli.js');
    const child = spawn(process.execPath, [cliPath, 'start'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    // Give a brief moment for the response to be sent before exiting
    setTimeout(() => process.exit(0), 500);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
