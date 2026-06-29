export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { handleAgentSessionsGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  activeCards,
  deleteImprintCard,
  generateImprintsWithAi,
  getImprintScheduleStatus,
  readImprintGenerationState,
  updateImprintSchedule,
  updateImprintCard,
  type ImprintGenerationTrigger,
} from '@/lib/echo-imprint-generator';
import { createDefaultAiTaskRunner } from '@/lib/ai/model-client';

type ImprintsPostBody = {
  trigger?: unknown;
};

type ImprintsPatchBody = {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  schedule?: unknown;
};

type ImprintsDeleteBody = {
  id?: unknown;
};

export function GET() {
  try {
    const state = readImprintGenerationState(getMindRoot());
    return NextResponse.json({
      state: summarizeState(state),
      cards: activeCards(state),
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: NextRequest) {
  let body: ImprintsPostBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const trigger = normalizeTrigger(body.trigger);
    const mindRoot = getMindRoot();
    const now = new Date();
    const currentState = readImprintGenerationState(mindRoot);
    if (trigger === 'auto' && !getImprintScheduleStatus(currentState, now).due) {
      return NextResponse.json({
        state: summarizeState(currentState, now),
        cards: activeCards(currentState),
        skipped: true,
      });
    }
    const result = await generateImprintsWithAi({
      mindRoot,
      sessions: readAgentSessions(),
      trigger,
      now,
      aiTaskRunner: createDefaultAiTaskRunner(),
      signal: req.signal,
    });
    return NextResponse.json({
      state: summarizeState(result.state),
      cards: result.cards,
      sourceWindow: result.sourceWindow,
      extraction: result.extraction,
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function PATCH(req: NextRequest) {
  let body: ImprintsPatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    if ('schedule' in body) {
      const state = updateImprintSchedule(getMindRoot(), body.schedule);
      return NextResponse.json({
        ok: true,
        state: summarizeState(state),
        cards: activeCards(state),
      });
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const card = updateImprintCard(getMindRoot(), id, {
      title: body.title,
      summary: body.summary,
    });
    if (!card) return NextResponse.json({ error: 'Imprint card not found' }, { status: 404 });
    const state = readImprintGenerationState(getMindRoot());
    return NextResponse.json({
      ok: true,
      card,
      state: summarizeState(state),
      cards: activeCards(state),
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function DELETE(req: NextRequest) {
  let body: ImprintsDeleteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const card = deleteImprintCard(getMindRoot(), id);
    if (!card) return NextResponse.json({ error: 'Imprint card not found' }, { status: 404 });
    const state = readImprintGenerationState(getMindRoot());
    return NextResponse.json({
      ok: true,
      state: summarizeState(state),
      cards: activeCards(state),
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

function normalizeTrigger(value: unknown): ImprintGenerationTrigger {
  return value === 'manual' ? 'manual' : 'auto';
}

function readAgentSessions(): unknown[] {
  const response = handleAgentSessionsGet();
  return Array.isArray(response.body) ? response.body : [];
}

function summarizeState(state: ReturnType<typeof readImprintGenerationState>, now = new Date()) {
  return {
    schemaVersion: state.schemaVersion,
    checkpointAt: state.checkpointAt,
    lastGeneratedAt: state.lastGeneratedAt,
    lastTrigger: state.lastTrigger,
    lastGenerationMode: state.lastGenerationMode,
    lastGenerationError: state.lastGenerationError,
    runCount: state.runCount,
    windowMinutes: state.windowMinutes,
    activeCount: activeCards(state).length,
    schedule: getImprintScheduleStatus(state, now),
  };
}
