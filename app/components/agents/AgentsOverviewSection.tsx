'use client';

import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import type { AgentBuckets, RiskItem } from './agents-content-model';

export default function AgentsOverviewSection({
  copy,
  buckets,
  riskQueue,
  topSkillsLabel,
  failedAgentsLabel,
  topSkillsValue,
  failedAgentsValue,
}: {
  copy: {
    connected: string;
    detected: string;
    notFound: string;
    riskQueue: string;
    noRisk: string;
    usagePulse: string;
    successRate7d: string;
    topSkills: string;
    failedAgents: string;
    na: string;
  };
  buckets: AgentBuckets;
  riskQueue: RiskItem[];
  topSkillsLabel: string;
  failedAgentsLabel: string;
  topSkillsValue: string;
  failedAgentsValue: string;
}) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard title={copy.connected} value={String(buckets.connected.length)} tone="ok" />
        <StatCard title={copy.detected} value={String(buckets.detected.length)} tone="warn" />
        <StatCard title={copy.notFound} value={String(buckets.notFound.length)} tone="warn" />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-3">{copy.riskQueue}</h2>
        {riskQueue.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.noRisk}</p>
        ) : (
          <ul className="space-y-2">
            {riskQueue.map((risk) => (
              <li key={risk.id} className="flex items-start gap-2 text-sm">
                <AlertTriangle size={14} className={risk.severity === 'error' ? 'text-destructive mt-0.5' : 'text-[var(--amber)] mt-0.5'} />
                <span className="text-foreground">{risk.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-3">{copy.usagePulse}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <InfoLine label={copy.successRate7d} value={copy.na} />
          <InfoLine label={topSkillsLabel || copy.topSkills} value={topSkillsValue} />
          <InfoLine label={failedAgentsLabel || copy.failedAgents} value={failedAgentsValue} />
        </div>
      </section>
    </div>
  );
}

function StatCard({ title, value, tone }: { title: string; value: string; tone: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{title}</p>
        {tone === 'ok' ? <CheckCircle2 size={14} className="text-success" /> : <Wrench size={14} className="text-[var(--amber)]" />}
      </div>
      <p className="text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-2xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm text-foreground truncate">{value}</p>
    </div>
  );
}
