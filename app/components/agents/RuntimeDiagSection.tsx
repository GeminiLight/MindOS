'use client';

import { useCallback, useState } from 'react';
import { Activity, Loader2, Wifi } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentInfo, McpStatus } from '../settings/types';
import { DetailLine, formatRelativeTime } from './agent-detail-primitives';

export default function RuntimeDiagSection({
  agent,
  status,
  isMindOS,
  mcpStatus,
}: {
  agent: AgentInfo;
  status: string;
  isMindOS: boolean;
  mcpStatus: McpStatus | null;
}) {
  const { t } = useLocale();
  const d = t.agentsContent.detail;
  const [pingState, setPingState] = useState<'idle' | 'pinging' | 'ok' | 'fail'>('idle');
  const [pingMs, setPingMs] = useState(0);

  const handlePing = useCallback(async () => {
    setPingState('pinging');
    const start = performance.now();
    try {
      const res = await fetch('/api/mcp/status', { method: 'GET', signal: AbortSignal.timeout(5000) });
      const elapsed = Math.round(performance.now() - start);
      setPingMs(elapsed);
      setPingState(res.ok ? 'ok' : 'fail');
    } catch {
      setPingState('fail');
    }
  }, []);

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><Activity size={13} className="text-[var(--amber)]" /></div>
          {d.runtimeDiagTitle}
        </h2>
        <button
          type="button"
          onClick={() => void handlePing()}
          disabled={pingState === 'pinging'}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pingState === 'pinging' ? (
            <><Loader2 size={10} className="animate-spin" /> {d.runtimePinging}</>
          ) : (
            <><Wifi size={10} /> {d.runtimePing}</>
          )}
        </button>
      </div>

      {pingState === 'ok' && (
        <div role="status" className="rounded-md bg-[var(--success)]/10 border border-[var(--success)]/20 px-3 py-1.5 text-2xs text-[var(--success)] font-medium animate-in fade-in duration-200">
          {d.runtimePingOk(pingMs)}
        </div>
      )}
      {pingState === 'fail' && (
        <div role="status" className="rounded-md bg-error/10 border border-error/20 px-3 py-1.5 text-2xs text-error font-medium animate-in fade-in duration-200">
          {d.runtimePingFail}
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 py-2 border-y border-border/30">
        <DetailLine label={d.status} value={status} />
        <DetailLine label={d.transport} value={agent.transport ?? agent.preferredTransport} />
        {isMindOS && mcpStatus && (
          <>
            <DetailLine label={d.runtimeVersion} value={mcpStatus.endpoint} />
            <DetailLine label={d.port} value={String(mcpStatus.port)} />
          </>
        )}
        <DetailLine label={d.lastActivityAt} value={formatRelativeTime(agent.runtimeLastActivityAt)} />
        {agent.runtimeConversationSignal !== undefined && (
          <DetailLine label={d.conversationSignal} value={agent.runtimeConversationSignal ? 'Active' : 'Inactive'} />
        )}
        {agent.runtimeUsageSignal !== undefined && (
          <DetailLine label={d.usageSignal} value={agent.runtimeUsageSignal ? 'Active' : 'Inactive'} />
        )}
      </div>

      {!agent.runtimeLastActivityAt && pingState === 'idle' && (
        <p className="text-2xs text-muted-foreground/50">{d.runtimeNoData}</p>
      )}
    </section>
  );
}
