export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createSession, closeSession, prompt, getSession, getActiveSessions } from '@/lib/acp/session';

export async function GET() {
  try {
    const sessions = getActiveSessions();
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/acp/session
 * Body: { agentId: string, env?: Record<string,string>, prompt?: string }
 *
 * If `prompt` is provided, creates a session, sends the prompt, returns
 * the response, and closes the session (one-shot mode).
 * Otherwise just creates and returns the session.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agentId, env, prompt: promptText } = body as {
      agentId?: string;
      env?: Record<string, string>;
      prompt?: string;
    };

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const session = await createSession(agentId, { env });

    // One-shot mode: send prompt, get response, close session
    if (promptText && typeof promptText === 'string') {
      try {
        const response = await prompt(session.id, promptText);
        // Clean up the session after getting the response
        await closeSession(session.id).catch(() => {});
        return NextResponse.json({ session, response });
      } catch (promptErr) {
        await closeSession(session.id).catch(() => {});
        return NextResponse.json(
          { error: `Prompt failed: ${(promptErr as Error).message}`, session },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ session });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    await closeSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
