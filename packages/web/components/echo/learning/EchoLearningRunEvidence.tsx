'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentRunObservatoryTrace } from '@geminilight/mindos/server';
import { fetchAgentRunObservatory } from '@/lib/agent-run-observatory';
import { contextAssetViewHref } from '@/lib/context-observability';
import type { LearningCopy } from './learning-client';

export default function EchoLearningRunEvidence({ receiptId, p }: { receiptId: string; p: LearningCopy }) {
  const [result, setResult] = useState<{ id: string; trace?: AgentRunObservatoryTrace }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchAgentRunObservatory(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]))
      .then((data) => {
        if (!controller.signal.aborted) setResult({ id: receiptId, trace: data.traces.find((trace) => trace.receipts.some((receipt) => receipt.id === receiptId)) });
      }).catch(() => { if (!controller.signal.aborted) setResult({ id: receiptId }); });
    return () => controller.abort();
  }, [receiptId]);
  if (result?.id !== receiptId) return <p role="status" className="text-xs text-muted-foreground">{p.joint.runLoading}</p>;
  const trace = result.trace;
  return <div className="space-y-3 rounded-lg bg-muted/25 p-3">
    {trace?.status ? <p className="text-xs font-medium">{p.joint.runState} · {p.joint.runStates[trace.status]}</p> : <p className="text-xs leading-5 text-muted-foreground">{p.joint.contextPrepared}</p>}
    {trace && ['failed', 'canceled', 'timed_out', 'interrupted'].includes(trace.status) ? <p className="text-xs leading-5 text-error">{trace.error || p.joint.runFailure}</p> : null}
    <p className="text-xs text-muted-foreground">{p.joint.runSummary}</p>
    {trace?.outputSummary ? <p className="whitespace-pre-wrap break-words text-sm leading-6">{trace.outputSummary}</p> : <p className="text-xs leading-5 text-muted-foreground">{p.joint.runMissing}</p>}
    {trace?.artifacts.some((artifact) => artifact.path) ? <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{p.joint.runArtifacts}</p>
      {trace.artifacts.filter((artifact) => artifact.path).slice(0, 10).map((artifact) => <Link key={artifact.id} target="_blank" rel="noopener noreferrer" href={contextAssetViewHref(artifact.path!)} className="flex min-h-11 items-center break-words rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{artifact.title || artifact.path}</Link>)}
    </div> : null}
  </div>;
}
