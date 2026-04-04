'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Bot, ChevronDown, ArrowRight } from 'lucide-react';
import { useMcpDataOptional } from '@/lib/stores/mcp-store';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentInfo } from '@/components/settings/types';

/* ── Constants ── */

const COLLAPSE_KEY = 'mindos:pulse-collapsed';
const VISIBLE_AGENTS = 3;

/* ── Helpers ── */

function sortAgents(agents: AgentInfo[]): AgentInfo[] {
  return [...agents].sort((a, b) => {
    const score = (ag: AgentInfo) => (ag.installed ? 3 : ag.present ? 2 : 0);
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    const ta = a.runtimeLastActivityAt ? new Date(a.runtimeLastActivityAt).getTime() : 0;
    const tb = b.runtimeLastActivityAt ? new Date(b.runtimeLastActivityAt).getTime() : 0;
    return tb - ta;
  });
}

function activityAge(isoStr?: string): string | null {
  if (!isoStr) return null;
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 60_000) return '<1m';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

function initials(name: string): string {
  const words = name.split(/[\s-]+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/* ── Main Component ── */

export default function SystemPulse() {
  const mcp = useMcpDataOptional();
  const { t } = useLocale();
  const pulse = t.pulse;
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) setCollapsed(stored === '1');
  }, []);

  const agents = mcp?.agents ?? [];
  const status = mcp?.status ?? null;
  const sorted = useMemo(() => sortAgents(agents), [agents]);
  const connectedAgents = sorted.filter(a => a.installed);
  const mcpRunning = status?.running ?? false;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  };

  if (!mcp || mcp.loading) return (
    <section className="mb-8 animate-pulse">
      <div className="h-4 w-32 bg-muted rounded mb-3" />
      <div className="h-16 bg-muted/50 rounded-xl" />
    </section>
  );

  // ── State 0: No agents detected ──
  if (agents.every(a => !a.present)) {
    return (
      <section className="mb-10">
        {/* Use same title style as other sections */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[var(--amber)]"><Bot size={13} /></span>
          <h2 className="text-sm font-semibold font-display text-foreground">{pulse.title}</h2>
        </div>
        <div className="rounded-xl border border-dashed border-border/60 p-4">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-[var(--amber)]/8 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-[var(--amber)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{pulse.connectTitle}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{pulse.connectDesc}</p>
            </div>
            <Link
              href="/agents"
              className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-[var(--amber)] text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {pulse.connectAction}
              <ArrowRight size={11} />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const totalConnected = connectedAgents.length;

  // ── Collapsed ──
  if (collapsed) {
    return (
      <section className="mb-10">
        <button
          onClick={toggleCollapsed}
          className="w-full flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <span className="text-[var(--amber)]"><Bot size={13} /></span>
          <h2 className="text-sm font-semibold font-display text-foreground">{pulse.title}</h2>
          {totalConnected > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground font-display">{totalConnected}</span>
          )}
          {/* Inline status */}
          <div className="flex items-center gap-2 ml-1">
            {connectedAgents.slice(0, 3).map(agent => (
              <span key={agent.key} className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="hidden sm:inline">{agent.name}</span>
              </span>
            ))}
            {totalConnected > 3 && (
              <span className="text-xs text-muted-foreground/40">+{totalConnected - 3}</span>
            )}
          </div>
          <ChevronDown size={12} className="ml-auto text-muted-foreground/30 group-hover:text-[var(--amber)] transition-colors" />
        </button>
      </section>
    );
  }

  // ── Expanded ──
  const visibleAgents = showAll ? connectedAgents : connectedAgents.slice(0, VISIBLE_AGENTS);
  const hiddenCount = connectedAgents.length - VISIBLE_AGENTS;

  return (
    <section className="mb-10">
      {/* Section title — same pattern as Spaces / Recently Edited */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[var(--amber)]"><Bot size={13} /></span>
        <h2 className="text-sm font-semibold font-display text-foreground">{pulse.title}</h2>
        {totalConnected > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground font-display">{totalConnected}</span>
        )}
        {mcpRunning && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="hidden sm:inline">{pulse.running}</span>
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Link
            href="/agents"
            className="text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity font-display"
          >
            {pulse.manage}
          </Link>
          <button
            onClick={toggleCollapsed}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground/40 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Collapse"
          >
            <ChevronDown size={12} className="rotate-180" />
          </button>
        </div>
      </div>

      {/* Agent cards — grid layout */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {visibleAgents.map(agent => {
          const age = activityAge(agent.runtimeLastActivityAt);
          return (
            <Link
              key={agent.key}
              href={`/agents/${encodeURIComponent(agent.key)}`}
              className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border hover:border-[var(--amber)]/30 hover:shadow-sm transition-all duration-150 hover:bg-muted/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Avatar */}
              <div className="relative w-8 h-8 rounded-lg bg-[var(--amber)]/8 text-[var(--amber-text)] ring-1 ring-[var(--amber)]/15 flex items-center justify-center text-xs font-semibold font-display shrink-0">
                {initials(agent.name)}
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-[1.5px] ring-card" />
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground block truncate">{agent.name}</span>
                <span className="text-xs text-muted-foreground/60 block">
                  {pulse.active}
                  {age ? ` · ${age}` : ''}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Show more */}
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <ChevronDown size={12} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
          <span>{showAll ? pulse.showLess : pulse.showMore(hiddenCount)}</span>
        </button>
      )}
    </section>
  );
}
