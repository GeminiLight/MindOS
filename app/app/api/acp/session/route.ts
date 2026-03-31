export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import {
  createSession,
  loadSession,
  listSessions,
  closeSession,
  prompt,
  cancelPrompt,
  setMode,
  setConfigOption,
  getSession,
  getActiveSessions,
} from '@/lib/acp/session';

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
 * Action-based dispatch for all ACP session operations.
 *
 * Actions:
 *   create          — { action: "create", agentId, env?, cwd?, prompt? }
 *   load            — { action: "load", agentId, sessionId, env?, cwd? }
 *   prompt          — { action: "prompt", sessionId, text }
 *   cancel          — { action: "cancel", sessionId }
 *   set_mode        — { action: "set_mode", sessionId, modeId }
 *   set_config      — { action: "set_config", sessionId, configId, value }
 *   list_sessions   — { action: "list_sessions", sessionId, cursor?, cwd? }
 *
 * Legacy (no action field): treated as "create" for backwards compat.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action ?? 'create';

    switch (action) {
      case 'create': {
        const { agentId, env, cwd, prompt: promptText } = body as {
          agentId?: string;
          env?: Record<string, string>;
          cwd?: string;
          prompt?: string;
        };

        if (!agentId || typeof agentId !== 'string') {
          return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
        }

        const session = await createSession(agentId, { env, cwd });

        // One-shot mode: send prompt, get response, close session
        if (promptText && typeof promptText === 'string') {
          try {
            const response = await prompt(session.id, promptText);
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
      }

      case 'load': {
        const { agentId, sessionId, env, cwd } = body as {
          agentId?: string;
          sessionId?: string;
          env?: Record<string, string>;
          cwd?: string;
        };

        if (!agentId || typeof agentId !== 'string') {
          return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
        }
        if (!sessionId || typeof sessionId !== 'string') {
          return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        const session = await loadSession(agentId, sessionId, { env, cwd });
        return NextResponse.json({ session });
      }

      case 'prompt': {
        const { sessionId, text } = body as { sessionId?: string; text?: string };

        if (!sessionId || typeof sessionId !== 'string') {
          return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }
        if (!text || typeof text !== 'string') {
          return NextResponse.json({ error: 'text is required' }, { status: 400 });
        }

        const response = await prompt(sessionId, text);
        return NextResponse.json({ response });
      }

      case 'cancel': {
        const { sessionId } = body as { sessionId?: string };
        if (!sessionId || typeof sessionId !== 'string') {
          return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        await cancelPrompt(sessionId);
        return NextResponse.json({ ok: true });
      }

      case 'set_mode': {
        const { sessionId, modeId } = body as { sessionId?: string; modeId?: string };
        if (!sessionId || !modeId) {
          return NextResponse.json({ error: 'sessionId and modeId are required' }, { status: 400 });
        }

        await setMode(sessionId, modeId);
        return NextResponse.json({ ok: true });
      }

      case 'set_config': {
        const { sessionId, configId, value } = body as { sessionId?: string; configId?: string; value?: string };
        if (!sessionId || !configId || value === undefined) {
          return NextResponse.json({ error: 'sessionId, configId, and value are required' }, { status: 400 });
        }

        const configOptions = await setConfigOption(sessionId, configId, String(value));
        return NextResponse.json({ configOptions });
      }

      case 'list_sessions': {
        const { sessionId, cursor, cwd } = body as { sessionId?: string; cursor?: string; cwd?: string };
        if (!sessionId || typeof sessionId !== 'string') {
          return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        const result = await listSessions(sessionId, { cursor, cwd });
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('not found') ? 404 : msg.includes('not support') ? 501 : 500;
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
