'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Cable,
  ChevronDown,
  Server,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentInfo } from '@/components/settings/types';
import type { AgentBuckets, RiskItem } from './agents-content-model';
import { resolveAgentStatus } from './agents-content-model';
import { AgentAvatar } from './AgentsPrimitives';

interface OverviewCopy {
  connected: string;
  detected: string;
  notFound: string;
  riskQueue: string;
  usagePulse: string;
  nextAction: string;
  nextActionHint: string;
  riskLevelError: string;
  riskLevelWarn: string;
  colAgent: string;
  colStatus: string;
  colMcp: string;
  colSkills: string;
  colMode: string;
  colRuntime: string;
  pulseMcp: string;
  pulseTools: string;
  mcpOffline: string;
  toolsUnit: (n: number) => string;
  enabledUnit: (n: number) => string;
  agentCount: (n: number) => string;
  runtimeActive: string;
  [k: string]: unknown;
}

interface PulseCopy {
  title: string;
  healthy: string;
  needsAttention: (n: number) => string;
  connected: string;
  detected: string;
  notFound: string;
  risk: string;
  enabledSkills: string;
}

export default function AgentsOverviewSection({
  copy,
  buckets,
  riskQueue,
  mcpRunning,
  mcpPort,
  mcpToolCount,
  enabledSkillCount,
  allAgents,
  pulseCopy,
}: {
  copy: OverviewCopy;
  buckets: AgentBuckets;
  riskQueue: RiskItem[];
  mcpRunning: boolean;
  mcpPort: number | null;
  mcpToolCount: number;
  enabledSkillCount: number;
  allAgents: AgentInfo[];
  pulseCopy: PulseCopy;
}) {
  const allHealthy = riskQueue.length === 0 && mcpRunning;
  const totalAgents = allAgents.length;
  const [riskOpen, setRiskOpen] = useState(false);

  const sortedAgents = useMemo(
    () =>
      [...allAgents].sort((a, b) => {
        const rank = (x: AgentInfo) => (x.present && x.installed ? 0 : x.present ? 1 : 2);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      }),
    [allAgents],
  );

  return (
    <div className="space-y-5">
      {/* ═══════════ HERO STATS BAR ═══════════ */}
      <section
        className="rounded-xl border border-border bg-gradient-to-b from-card to-card/80 overflow-hidden"
        aria-label={pulseCopy.connected}
      >
        <div className="flex divide-x divide-border/50 [&>*]:flex-1">
          <StatCell
            icon={<Zap size={14} aria-hidden="true" />}
            label={pulseCopy.connected}
            value={buckets.connected.length}
            total={totalAgents}
            tone="ok"
          />
          <StatCell
            icon={<Cable size={14} aria-hidden="true" />}
            label={pulseCopy.detected}
            value={buckets.detected.length}
            tone={buckets.detected.length > 0 ? 'warn' : 'muted'}
          />
          {buckets.notFound.length > 0 && (
            <StatCell
              icon={<AlertTriangle size={14} aria-hidden="true" />}
              label={pulseCopy.notFound}
              value={buckets.notFound.length}
              tone="muted"
            />
          )}
          <StatCell
            icon={<Zap size={14} aria-hidden="true" />}
            label={pulseCopy.enabledSkills}
            value={enabledSkillCount}
            tone="ok"
          />
          <StatCell
            icon={<Server size={14} aria-hidden="true" />}
            label={copy.pulseMcp as string}
            value={mcpRunning ? `:${mcpPort}` : '—'}
            tone={mcpRunning ? 'ok' : 'warn'}
          />
        </div>
      </section>

      {/* ═══════════ RISK CAPSULE ═══════════ */}
      {riskQueue.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setRiskOpen(!riskOpen)}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/[0.06] px-3 py-1.5 text-sm font-medium text-[var(--amber)] transition-colors duration-150 hover:bg-amber-500/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={riskOpen}
          >
            <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
            {copy.riskQueue}
            <span className="tabular-nums text-2xs bg-[var(--amber-dim)] px-1.5 py-0.5 rounded-full select-none">
              {riskQueue.length}
            </span>
            <ChevronDown
              size={13}
              className={cn('shrink-0 transition-transform duration-200', riskOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>

          <div
            className={cn(
              'grid transition-[grid-template-rows] duration-250 ease-out',
              riskOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div className="overflow-hidden">
              <ul className="mt-3 space-y-2" role="list">
                {riskQueue.map((risk, i) => (
                  <li
                    key={risk.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm ${
                      risk.severity === 'error'
                        ? 'border-destructive/20 bg-destructive/[0.03]'
                        : 'border-amber-500/15 bg-background'
                    }`}
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        risk.severity === 'error' ? 'bg-destructive' : 'bg-[var(--amber)]'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="text-foreground flex-1 min-w-0">{risk.title}</span>
                    <span
                      className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 select-none ${
                        risk.severity === 'error'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-[var(--amber-dim)] text-[var(--amber)]'
                      }`}
                    >
                      {risk.severity === 'error' ? copy.riskLevelError : copy.riskLevelWarn}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ QUICK NAVIGATION ═══════════ */}
      <nav className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-label="Quick navigation">
        <QuickNavCard
          href="/agents?tab=mcp"
          icon={<Server size={18} aria-hidden="true" />}
          title="MCP"
          stat={mcpRunning ? copy.toolsUnit(mcpToolCount) : copy.mcpOffline}
          statTone={mcpRunning ? 'ok' : 'warn'}
          description={copy.nextActionHint as string}
        />
        <QuickNavCard
          href="/agents?tab=skills"
          icon={<Zap size={18} aria-hidden="true" />}
          title="Skills"
          stat={copy.enabledUnit(enabledSkillCount)}
          statTone="ok"
          description={`${pulseCopy.enabledSkills}: ${enabledSkillCount}`}
        />
      </nav>

      {/* ═══════════ AGENT CARDS ═══════════ */}
      {sortedAgents.length > 0 ? (
        <section aria-label={copy.usagePulse}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-foreground">{copy.usagePulse}</h2>
            <span className="text-2xs text-muted-foreground tabular-nums select-none">
              {copy.agentCount(totalAgents)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedAgents.map((agent, i) => (
              <AgentCard key={agent.key} agent={agent} copy={copy} index={i} />
            ))}
          </div>
        </section>
      ) : (
        <section
          className="rounded-xl border border-dashed border-border/60 bg-gradient-to-b from-card/80 to-card/40 p-12 text-center"
          aria-label={copy.usagePulse}
        >
          <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-4">
            <Cable size={22} className="text-muted-foreground/50" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground/70 leading-relaxed max-w-xs mx-auto">
            {copy.nextActionHint as string}
          </p>
        </section>
      )}
    </div>
  );
}

/* ────────── Stat Cell ────────── */

function StatCell({
  icon,
  label,
  value,
  total,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  total?: number;
  tone: 'ok' | 'warn' | 'muted';
}) {
  const textColor =
    tone === 'ok'
      ? 'text-foreground'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground';
  const iconColor =
    tone === 'ok'
      ? 'text-emerald-500/70'
      : tone === 'warn'
        ? 'text-amber-500/70'
        : 'text-muted-foreground/40';
  const hoverBg =
    tone === 'ok'
      ? 'hover:bg-emerald-500/[0.04]'
      : tone === 'warn'
        ? 'hover:bg-amber-500/[0.04]'
        : 'hover:bg-muted/20';

  return (
    <div
      className={`px-3 py-4 text-center ${hoverBg} transition-colors duration-150 group/stat`}
      role="group"
      aria-label={`${label}: ${value}${total !== undefined ? `/${total}` : ''}`}
    >
      <div className={`flex items-center justify-center gap-1.5 mb-2 ${iconColor} group-hover/stat:opacity-100 transition-all duration-150`}>
        {icon}
      </div>
      <p className={`text-xl font-semibold tabular-nums leading-none mb-1.5 ${textColor}`}>
        {value}
        {total !== undefined && (
          <span className="text-xs font-normal text-muted-foreground ml-0.5">/{total}</span>
        )}
      </p>
      <span className="text-2xs text-muted-foreground/70 truncate block">{label}</span>
    </div>
  );
}

/* ────────── Quick Nav Card ────────── */

function QuickNavCard({
  href,
  icon,
  title,
  stat,
  statTone,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  stat: string;
  statTone: 'ok' | 'warn';
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-card p-4 flex items-start gap-3.5
        hover:border-[var(--amber)]/30 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]
        active:scale-[0.99]
        transition-all duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="shrink-0 w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center text-muted-foreground/70 group-hover:text-[var(--amber)] group-hover:bg-[var(--amber)]/[0.08] transition-all duration-200">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span
            className={`text-2xs px-2 py-0.5 rounded-full font-medium select-none ${
              statTone === 'ok'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            }`}
          >
            {stat}
          </span>
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">{description}</p>
      </div>
      <ArrowRight
        size={14}
        className="shrink-0 mt-1.5 text-muted-foreground/20 group-hover:text-[var(--amber)] group-hover:translate-x-0.5 transition-all duration-200"
        aria-hidden="true"
      />
    </Link>
  );
}

/* ────────── Agent Card ────────── */

function AgentCard({
  agent,
  copy,
  index,
}: {
  agent: AgentInfo;
  copy: OverviewCopy;
  index: number;
}) {
  const status = resolveAgentStatus(agent);
  const mcpCount = agent.configuredMcpServerCount ?? agent.configuredMcpServers?.length ?? 0;
  const skillCount = agent.installedSkillCount ?? agent.installedSkillNames?.length ?? 0;
  const hasRuntime = agent.runtimeConversationSignal || agent.runtimeUsageSignal;

  const statusLabel =
    status === 'connected' ? copy.connected : status === 'detected' ? copy.detected : copy.notFound;
  const statusColor =
    status === 'connected'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'detected'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-zinc-500/10 text-zinc-500';

  return (
    <Link
      href={`/agents/${encodeURIComponent(agent.key)}`}
      className={`group rounded-xl border border-border bg-card p-3.5
        hover:border-[var(--amber)]/30 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]
        active:scale-[0.98]
        transition-all duration-150 animate-in
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
    >
      {/* Top row: avatar + name + status */}
      <div className="flex items-center gap-2.5 mb-3">
        <AgentAvatar name={agent.name} status={status} size="sm" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground block truncate group-hover:text-[var(--amber)] transition-colors duration-150">
            {agent.name}
          </span>
          {agent.transport && status === 'connected' && (
            <span className="text-2xs text-muted-foreground/60 font-mono">{agent.transport}</span>
          )}
        </div>
        <span className={`text-2xs px-2 py-0.5 rounded-full font-medium shrink-0 select-none ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-1 pt-2.5 border-t border-border/40">
        <MetricChip icon={<Server size={11} aria-hidden="true" />} value={mcpCount} label={copy.colMcp as string} />
        <MetricChip icon={<Zap size={11} aria-hidden="true" />} value={skillCount} label={copy.colSkills as string} />
        <span className="flex-1 min-w-[4px]" />
        {hasRuntime && (
          <span
            className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
            title={copy.runtimeActive}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span className="text-2xs font-medium">{copy.runtimeActive}</span>
          </span>
        )}
      </div>
    </Link>
  );
}

/* ────────── Metric Chip ────────── */

function MetricChip({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md ${value > 0 ? 'bg-muted/40' : ''}`}
      title={label}
      aria-label={`${label}: ${value}`}
    >
      <span className={value > 0 ? 'text-muted-foreground' : 'text-muted-foreground/30'}>{icon}</span>
      <span className={`tabular-nums text-xs ${value > 0 ? 'text-foreground font-medium' : 'text-muted-foreground/40'}`}>
        {value}
      </span>
    </span>
  );
}
