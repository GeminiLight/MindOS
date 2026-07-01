export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { handleAgentSessionsGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { createDefaultAiTaskRunner } from '@/lib/ai/model-client';
import {
  activeEchoCards,
  deleteEchoCard,
  generateEchoCardsWithAi,
  getEchoCardScheduleStatus,
  readEchoCardsState,
  updateEchoCard,
  updateEchoCardSchedule,
} from '@/lib/echo-card-generator';
import {
  normalizeEchoCardLocale,
  normalizeEchoCardSegment,
  type EchoCardSegment,
  type EchoGenerationTrigger,
  type EchoOutputLocale,
} from '@/lib/echo-cards';

type CardsPostBody = {
  segment?: unknown;
  trigger?: unknown;
  locale?: unknown;
};

type CardsPatchBody = {
  segment?: unknown;
  id?: unknown;
  title?: unknown;
  content?: unknown;
  schedule?: unknown;
};

type CardsDeleteBody = {
  segment?: unknown;
  id?: unknown;
};

export function GET(req: NextRequest) {
  try {
    const segment = normalizeRequestSegment(req.nextUrl.searchParams.get('segment'));
    if (!segment) return NextResponse.json({ error: 'segment is required' }, { status: 400 });
    const state = readEchoCardsState(getMindRoot());
    return NextResponse.json({
      state: summarizeSegmentState(state, segment),
      cards: activeEchoCards(state, segment),
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: NextRequest) {
  let body: CardsPostBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const segment = normalizeRequestSegment(body.segment);
    if (!segment) return NextResponse.json({ error: 'segment is required' }, { status: 400 });
    const trigger = normalizeTrigger(body.trigger);
    const locale = normalizeRequestLocale(body.locale, req);
    const mindRoot = getMindRoot();
    const now = new Date();
    const currentState = readEchoCardsState(mindRoot);
    if (trigger === 'auto' && !getEchoCardScheduleStatus(currentState.segments[segment], now).due) {
      return NextResponse.json({
        state: summarizeSegmentState(currentState, segment, now),
        cards: activeEchoCards(currentState, segment),
        skipped: true,
      });
    }
    const result = await generateEchoCardsWithAi({
      mindRoot,
      segment,
      sessions: readAgentSessions(),
      trigger,
      locale,
      now,
      aiTaskRunner: createDefaultAiTaskRunner(),
      signal: req.signal,
    });
    return NextResponse.json({
      state: summarizeSegmentState(result.state, segment),
      cards: result.cards,
      sourceWindow: result.sourceWindow,
      extraction: result.extraction,
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function PATCH(req: NextRequest) {
  let body: CardsPatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const segment = normalizeRequestSegment(body.segment);
    if (!segment) return NextResponse.json({ error: 'segment is required' }, { status: 400 });
    if ('schedule' in body) {
      const state = updateEchoCardSchedule(getMindRoot(), segment, body.schedule);
      return NextResponse.json({
        ok: true,
        state: summarizeSegmentState(state, segment),
        cards: activeEchoCards(state, segment),
      });
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (typeof body.title !== 'string' && typeof body.content !== 'string') {
      return NextResponse.json({ error: 'title or content is required' }, { status: 400 });
    }
    const card = updateEchoCard(getMindRoot(), segment, id, {
      title: body.title,
      content: body.content,
    });
    if (!card) return NextResponse.json({ error: 'Echo card not found' }, { status: 404 });
    const state = readEchoCardsState(getMindRoot());
    return NextResponse.json({
      ok: true,
      card,
      state: summarizeSegmentState(state, segment),
      cards: activeEchoCards(state, segment),
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function DELETE(req: NextRequest) {
  let body: CardsDeleteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const segment = normalizeRequestSegment(body.segment);
    if (!segment) return NextResponse.json({ error: 'segment is required' }, { status: 400 });
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const card = deleteEchoCard(getMindRoot(), segment, id);
    if (!card) return NextResponse.json({ error: 'Echo card not found' }, { status: 404 });
    const state = readEchoCardsState(getMindRoot());
    return NextResponse.json({
      ok: true,
      state: summarizeSegmentState(state, segment),
      cards: activeEchoCards(state, segment),
    });
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

function normalizeRequestSegment(value: unknown): EchoCardSegment | null {
  return normalizeEchoCardSegment(value);
}

function normalizeTrigger(value: unknown): EchoGenerationTrigger {
  return value === 'manual' ? 'manual' : 'auto';
}

function normalizeRequestLocale(value: unknown, req: NextRequest): EchoOutputLocale {
  const explicit = normalizeEchoCardLocale(value);
  if (explicit === 'zh' || value === 'en') return explicit;

  const cookieLocale = req.cookies.get('locale')?.value;
  if (cookieLocale === 'zh' || cookieLocale === 'en') return cookieLocale;

  const acceptLanguage = req.headers.get('accept-language') ?? '';
  return acceptLanguage.toLowerCase().includes('zh') ? 'zh' : 'en';
}

function readAgentSessions(): unknown[] {
  const response = handleAgentSessionsGet();
  return Array.isArray(response.body) ? response.body : [];
}

function summarizeSegmentState(state: ReturnType<typeof readEchoCardsState>, segment: EchoCardSegment, now = new Date()) {
  const segmentState = state.segments[segment];
  return {
    schemaVersion: state.schemaVersion,
    segment,
    checkpointAt: segmentState.checkpointAt,
    lastGeneratedAt: segmentState.lastGeneratedAt,
    lastTrigger: segmentState.lastTrigger,
    lastGenerationMode: segmentState.lastGenerationMode,
    lastGenerationError: segmentState.lastGenerationError,
    runCount: segmentState.runCount,
    windowMinutes: segmentState.windowMinutes,
    activeCount: activeEchoCards(state, segment).length,
    schedule: getEchoCardScheduleStatus(segmentState, now),
  };
}
