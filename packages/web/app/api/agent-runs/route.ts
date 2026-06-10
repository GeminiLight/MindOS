export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import {
  listAgentEvents,
  listAgentRuns,
  type AgentEventCategory,
  type AgentEventType,
  type AgentNodeKind,
  type AgentRunStatus,
} from '@/lib/agent/run-ledger';

const AGENT_KINDS = new Set<AgentNodeKind>(['mindos-main', 'mindos-headless', 'native-runtime', 'pi-subagent', 'acp', 'a2a']);
const RUN_STATUSES = new Set<AgentRunStatus>([
  'queued',
  'running',
  'streaming',
  'completed',
  'failed',
  'canceled',
  'timed_out',
]);
const EVENT_TYPES = new Set<AgentEventType>([
  'run_started',
  'run_updated',
  'run_completed',
  'run_canceled',
  'run_failed',
  'text',
  'tool_started',
  'tool_updated',
  'tool_completed',
  'file_changed',
  'permission_requested',
  'permission_resolved',
  'user_question_started',
  'user_question_resolved',
  'runtime_status',
  'error',
]);
const EVENT_CATEGORIES = new Set<AgentEventCategory>(['status', 'text', 'tool', 'file', 'permission', 'question', 'error']);

function optionalEnum<T extends string>(value: string | null, allowed: Set<T>): T | undefined {
  return value && allowed.has(value as T) ? value as T : undefined;
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
  const runId = url.searchParams.get('runId') ?? undefined;
  const rootRunId = url.searchParams.get('rootRunId') ?? undefined;
  const startedAfter = optionalNumber(url.searchParams.get('startedAfter'));
  const runs = listAgentRuns({
    runId,
    rootRunId,
    kind: optionalEnum(url.searchParams.get('kind'), AGENT_KINDS),
    status: optionalEnum(url.searchParams.get('status'), RUN_STATUSES),
    parentRunId: url.searchParams.get('parentRunId') ?? undefined,
    chatSessionId: url.searchParams.get('chatSessionId') ?? undefined,
    ...(rootRunId ? {} : { startedAfter }),
    limit: Number.isFinite(limit) ? limit : 100,
  });
  const includeEvents = url.searchParams.get('includeEvents') === '1' || url.searchParams.get('includeEvents') === 'true';
  if (!includeEvents) return NextResponse.json({ runs });

  const events = listAgentEvents({
    runId,
    rootRunId,
    chatSessionId: url.searchParams.get('chatSessionId') ?? undefined,
    type: optionalEnum(url.searchParams.get('eventType'), EVENT_TYPES),
    category: optionalEnum(url.searchParams.get('eventCategory'), EVENT_CATEGORIES),
    ...(rootRunId ? {} : { startedAfter }),
    limit: Number.isFinite(limit) ? limit : 100,
  });
  return NextResponse.json({ runs, events });
}
