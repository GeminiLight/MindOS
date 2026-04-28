export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { handleRouteErrorSimple } from '@/lib/errors';

interface InstallRequest {
  agentId: string;
  packageName: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InstallRequest;

    if (!body.agentId || !body.packageName) {
      return NextResponse.json(
        { error: 'agentId and packageName are required' },
        { status: 400 },
      );
    }

    // Validate packageName to prevent command injection
    // Allow scoped packages like @scope/name and plain names
    if (!/^(@[\w-]+\/)?[\w][\w./-]*$/.test(body.packageName)) {
      return NextResponse.json(
        { error: 'Invalid package name' },
        { status: 400 },
      );
    }

    // Run npm install -g in background (fire-and-forget for the HTTP response)
    const child = exec(
      `npm install -g ${body.packageName}`,
      { timeout: 120_000 },
    );

    // Detach so the process continues after response
    child.unref();

    return NextResponse.json({
      status: 'installing',
      agentId: body.agentId,
      packageName: body.packageName,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
