'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Cable,
  ChevronDown,
  Globe,
  MoreHorizontal,
  Plus,
  Server,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentInfo } from '@/components/settings/types';
import type { AgentBuckets, RiskItem } from './agents-content-model';
import { resolveAgentStatus } from './agents-content-model';
import { AgentAvatar } from './AgentsPrimitives';
import RecentActivityFeed from './RecentActivityFeed';

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
  mcpEnabled = true,
  enabledSkillCount,
  allAgents,
  pulseCopy,
  a2aCount,
  onAddCustomAgent,
  onEditCustomAgent,
  onRemoveCustomAgent,
}: {
  copy: OverviewCopy;
  buckets: AgentBuckets;
  riskQueue: RiskItem[];
  mcpRunning: boolean;
  mcpPort: number | null;
  mcpToolCount: number;
  mcpEnabled?: boolean;
  enabledSkillCount: number;
  allAgents: AgentInfo[];
  pulseCopy: PulseCopy;
  a2aCount?: number;
  onAddCustomAgent?: () => void;
  onEditCustomAgent?: (agent: AgentInfo) => void;
  onRemoveCustomAgent?: (agent: AgentInfo) => void;
}) {
  const allHealthy = riskQueue.length === 0 && (!mcpEnabled || mcpRunning);
  const [riskOpen, setRiskOpen] = useState(false);

  const sortedAgents = useMemo(
    () =>
      [...allAgents]
        .filter(a => a.present || a.isCustom) // custom agents always visible
        .sort((a, b) => {
          const rank = (x: AgentInfo) => (x.installed ? 0 : 1);
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
            total={sortedAgents.length}
            tone="ok"
          />
          <StatCell
            icon={<Cable size={14} aria-hidden="true" />}
            label={pulseCopy.detected}
            value={buckets.detected.length}
            tone={buckets.detected.length > 0 ? 'warn' : 'muted'}
          />
          <StatCell
            icon={<Zap size={14} aria-hidden="true" />}
            label={pulseCopy.enabledSkills}
            value={enabledSkillCount}
            tone="ok"
          />
          {mcpEnabled && (
            <StatCell
              icon={<Server size={14} aria-hidden="true" />}
              label={copy.pulseMcp as string}
              value={mcpRunning ? `:${mcpPort}` : '—'}
              tone={mcpRunning ? 'ok' : 'warn'}
            />
          )}
          {a2aCount != null && (
            <StatCell
              icon={<Globe size={14} aria-hidden="true" />}
              label={copy.a2aLabel as string ?? 'A2A'}
              value={a2aCount}
              tone={a2aCount > 0 ? 'ok' : 'muted'}
            />
          )}
        </div>
      </section>

      {/* ═══════════ RISK CAPSULE ═══════════ */}
      {riskQueue.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setRiskOpen(!riskOpen)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--amber)]/25 bg-[var(--amber)]/[0.06] px-3 py-1.5 text-sm font-medium text-[var(--amber)] transition-colors duration-150 hover:bg-[var(--amber)]/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="overflow-hidden" {...(!riskOpen && { inert: true } as React.HTMLAttributes<HTMLDivElement>)}>
              <ul className="mt-3 space-y-2" role="list">
                {riskQueue.map((risk, i) => (
                  <li
                    key={risk.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm ${
                      risk.severity === 'error'
                        ? 'border-destructive/20 bg-destructive/[0.03]'
                        : 'border-[var(--amber)]/15 bg-background'
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
                          : 'bg-[var(--amber-dim)] text-[var(--amber-text)]'
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

      {/* ═══════════ RECENT ACTIVITY ═══════════ */}
      <RecentActivityFeed />

      {/* ═══════════ AGENT CARDS ═══════════ */}
      {sortedAgents.length > 0 ? (
        <section aria-label={copy.usagePulse}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]"><Bot size={13} /></div>
              <h2 className="text-[13px] font-semibold text-foreground tracking-wide">{copy.usagePulse}</h2>
            </div>
            <span className="text-2xs text-muted-foreground tabular-nums select-none">
              {copy.agentCount(sortedAgents.length)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Add Custom Agent Button — Always First */}
            {onAddCustomAgent && (
              <button
                type="button"
                onClick={onAddCustomAgent}
                className="group rounded-xl border-2 border-dashed border-border/60 bg-transparent p-3.5
                  hover:border-[var(--amber)]/30 hover:bg-muted/20
                  active:scale-[0.98]
                  transition-all duration-150
                  flex flex-col items-center justify-center gap-2 min-h-[100px]
                  cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={copy.addCustomAgent as string}
              >
                <div className="w-8 h-8 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center group-hover:border-[var(--amber)]/50 transition-colors duration-150">
                  <Plus size={16} className="text-muted-foreground/50 group-hover:text-[var(--amber)] transition-colors duration-150" />
                </div>
                <span className="text-xs text-muted-foreground/60 group-hover:text-muted-foreground transition-colors duration-150">
                  {copy.addCustomAgent as string}
                </span>
              </button>
            )}
            {/* Agent Cards */}
            {sortedAgents.map((agent, i) => (
              <AgentCard
                key={agent.key}
                agent={agent}
                copy={copy}
                index={i}
                mcpEnabled={mcpEnabled}
                onEdit={agent.isCustom ? onEditCustomAgent : undefined}
                onRemove={agent.isCustom ? onRemoveCustomAgent : undefined}
              />
            ))}
          </div>
        </section>
      ) : (
        <section
          className="rounded-xl border border-border/40 bg-card/30 p-12 text-center"
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
      ? 'text-[var(--success)]/70'
      : tone === 'warn'
        ? 'text-[var(--amber)]/70'
        : 'text-muted-foreground/40';
  const hoverBg =
    tone === 'ok'
      ? 'hover:bg-muted/20'
      : tone === 'warn'
        ? 'hover:bg-[var(--amber)]/[0.04]'
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

/* ────────── Agent Card ────────── */

function AgentCard({
  agent,
  copy,
  index,
  mcpEnabled = true,
  onEdit,
  onRemove,
}: {
  agent: AgentInfo;
  copy: OverviewCopy;
  index: number;
  mcpEnabled?: boolean;
  onEdit?: (agent: AgentInfo) => void;
  onRemove?: (agent: AgentInfo) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const status = resolveAgentStatus(agent);
  const mcpCount = agent.configuredMcpServerCount ?? agent.configuredMcpServers?.length ?? 0;
  const skillCount = agent.installedSkillCount ?? agent.installedSkillNames?.length ?? 0;
  const hasRuntime = agent.runtimeConversationSignal || agent.runtimeUsageSignal;
  const isCustom = agent.isCustom;

  const statusLabel =
    status === 'connected' ? copy.connected : status === 'detected' ? copy.detected : copy.notFound;
  const statusColor =
    status === 'connected'
      ? 'bg-muted text-muted-foreground'
      : status === 'detected'
        ? 'bg-[var(--amber-dim)] text-[var(--amber-text)]'
        : 'bg-error/10 text-error';

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <Link
      href={`/agents/${encodeURIComponent(agent.key)}`}
      className={cn(
        'group relative rounded-xl border border-border bg-card p-3.5',
        'hover:border-[var(--amber)]/30 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]',
        'active:scale-[0.98]',
        'transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isCustom && 'border-l-2 border-l-[var(--amber)]/40',
      )}
    >
      {/* Custom agent "..." menu */}
      {isCustom && (onEdit || onRemove) && (
        <div ref={menuRef} className="absolute top-2.5 right-2.5 z-10">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
            aria-label="Agent options"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-32 bg-card border border-border rounded-lg shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100">
              {onEdit && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onEdit(agent); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors duration-100 cursor-pointer"
                >
                  {copy.customAgentEdit as string}
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onRemove(agent); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors duration-100 cursor-pointer"
                >
                  {copy.customAgentRemove as string}
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
        {mcpEnabled && (
          <MetricChip icon={<Server size={11} aria-hidden="true" />} value={mcpCount} label={copy.colMcp as string} />
        )}
        <MetricChip icon={<Zap size={11} aria-hidden="true" />} value={skillCount} label={copy.colSkills as string} />
        <span className="flex-1 min-w-[4px]" />
        {hasRuntime && (
          <span
            className="flex items-center gap-1 text-[var(--success)]"
            title={copy.runtimeActive}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" aria-hidden="true" />
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
