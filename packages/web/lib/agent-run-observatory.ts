import type {
  AgentRunObservatory,
  AgentRunObservatoryStatus,
  AgentRunObservatoryTrace,
} from '@geminilight/mindos/server';

export type AgentRunObservatoryFilter = 'all' | 'active' | 'waiting' | 'issues' | 'completed';

export async function fetchAgentRunObservatory(signal?: AbortSignal): Promise<AgentRunObservatory> {
  const response = await fetch('/api/agent-runs?limit=100&includeEvents=1', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload = await response.json().catch(() => null) as { observatory?: AgentRunObservatory; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Run observatory request failed (${response.status})`);
  if (!payload?.observatory || payload.observatory.schemaVersion !== 1 || !Array.isArray(payload.observatory.traces)) {
    throw new Error('Run observatory response was malformed.');
  }
  return payload.observatory;
}

export function filterAgentRunTraces(
  traces: AgentRunObservatoryTrace[],
  filter: AgentRunObservatoryFilter,
): AgentRunObservatoryTrace[] {
  if (filter === 'all') return traces;
  return traces.filter((trace) => {
    if (filter === 'active') return trace.status === 'queued' || trace.status === 'running' || trace.status === 'streaming';
    if (filter === 'waiting') return trace.status === 'waiting_approval';
    if (filter === 'issues') return trace.status === 'failed' || trace.status === 'timed_out' || trace.status === 'interrupted' || trace.status === 'canceled';
    return trace.status === 'completed';
  });
}

export function agentRunStatusLabel(status: AgentRunObservatoryStatus, locale: string = 'en'): string {
  if (locale === 'zh') {
    const labels: Record<AgentRunObservatoryStatus, string> = {
      queued: '排队中',
      running: '运行中',
      streaming: '生成中',
      completed: '已完成',
      failed: '失败',
      canceled: '已取消',
      timed_out: '已超时',
      waiting_approval: '待审批',
      interrupted: '已中断',
    };
    return labels[status];
  }
  if (status === 'waiting_approval') return 'Waiting for approval';
  if (status === 'timed_out') return 'Timed out';
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

export function agentRunViewHref(path: string): string {
  return `/view/${path.split('/').map(encodeURIComponent).join('/')}`;
}
