'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bot, ChevronDown, ChevronRight, Wifi, WifiOff, Sparkles, X } from 'lucide-react';
import { useMcpDataOptional } from '@/hooks/useMcpData';
import { useLocale } from '@/lib/LocaleContext';
import type { AgentInfo } from '@/components/settings/types';

/* ── Persistence ── */

const COLLAPSE_KEY = 'mindos:pulse-collapsed';

function getCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSE_KEY) === '1';
}

/* ── Helpers ── */

function agentStatusIcon(agent: AgentInfo) {
  if (agent.installed) return 'bg-emerald-500';
  if (agent.present) return 'bg-amber-400';
  return 'bg-muted-foreground/30';
}

function agentStatusLabel(agent: AgentInfo, t: ReturnType<typeof useLocale>['t']['pulse']) {
  if (agent.installed) return t.active;
  if (agent.present) return t.detected;
  return t.notFound;
}

/** Relative time for agent activity */
function activityAge(isoStr?: string): string | null {
  if (!isoStr) return null;
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 60_000) return '<1m';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

/* ── Component ── */

export default function SystemPulse() {
  const mcp = useMcpDataOptional();
  const { t } = useLocale();
  const pulse = t.pulse;
  const [collapsed, setCollapsed] = useState(true); // SSR-safe default

  // Hydrate from localStorage after mount
  useEffect(() => {
    setCollapsed(getCollapsed());
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  };

  // Loading or no provider — don't render
  if (!mcp || mcp.loading) return null;

  const { agents, status, skills } = mcp;
  const connectedAgents = agents.filter(a => a.installed);
  const detectedAgents = agents.filter(a => a.present && !a.installed);
  const mcpRunning = status?.running ?? false;
  const totalFiles = 0; // TODO: pass from parent if needed
  const enabledSkills = skills.filter(s => s.enabled).length;

  // ── State 0: No agents at all ──
  if (agents.length === 0 || agents.every(a => !a.present)) {
    return (
      <div className="mb-8 rounded-xl border border-dashed border-border bg-card/50 p-4 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--amber)]/10 flex items-center justify-center shrink-0">
            <Bot size={16} className="text-[var(--amber)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{pulse.connectTitle}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pulse.connectDesc}</p>
          </div>
          <Link
            href="/agents"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--amber)] text-[var(--amber-foreground)] transition-opacity hover:opacity-90"
          >
            {pulse.connectAction}
          </Link>
        </div>
      </div>
    );
  }

  // ── Collapsed: single-line summary ──
  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        className="mb-8 w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-card/80 transition-all duration-150 hover:border-[var(--amber)]/30 hover:bg-card cursor-pointer group"
      >
        <div className="flex items-center gap-1.5">
          {connectedAgents.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          <Bot size={13} className="text-muted-foreground" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {pulse.summary(connectedAgents.length, enabledSkills)}
        </span>
        {mcpRunning && (
          <span className="text-xs text-muted-foreground/50 hidden sm:inline">
            · MCP {pulse.running}
          </span>
        )}
        <ChevronRight size={12} className="ml-auto text-muted-foreground/40 group-hover:text-[var(--amber)] transition-colors" />
      </button>
    );
  }

  // ── Expanded: full pulse ──
  return (
    <div className="mb-8 rounded-xl border border-border/60 bg-gradient-to-b from-card to-card/60 overflow-hidden transition-all duration-200">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-1.5">
          {connectedAgents.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          <Bot size={14} className="text-[var(--amber)]" />
        </div>
        <span className="text-xs font-semibold font-display text-foreground uppercase tracking-wider">
          {pulse.title}
        </span>
        <Link
          href="/agents"
          className="ml-auto text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity font-display"
        >
          {pulse.manage}
        </Link>
        <button
          onClick={toggleCollapsed}
          className="p-1 -mr-1 rounded hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Collapse"
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Agent list */}
      <div className="px-4 py-3 space-y-2">
        {connectedAgents.map(agent => (
          <div key={agent.key} className="flex items-center gap-2.5 group/agent">
            <span className={`w-2 h-2 rounded-full shrink-0 ${agentStatusIcon(agent)}`} />
            <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
              {agent.name}
            </span>
            <span className="text-xs text-muted-foreground/60 tabular-nums shrink-0">
              {agentStatusLabel(agent, pulse)}
            </span>
            {agent.runtimeLastActivityAt && (
              <span className="text-xs text-muted-foreground/40 tabular-nums shrink-0 hidden sm:inline">
                · {activityAge(agent.runtimeLastActivityAt)}
              </span>
            )}
          </div>
        ))}

        {detectedAgents.length > 0 && (
          <div className="pt-1 border-t border-border/20">
            {detectedAgents.map(agent => (
              <div key={agent.key} className="flex items-center gap-2.5 py-0.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${agentStatusIcon(agent)}`} />
                <span className="text-sm text-muted-foreground flex-1 min-w-0 truncate">
                  {agent.name}
                </span>
                <span className="text-xs text-muted-foreground/40 shrink-0">
                  {agentStatusLabel(agent, pulse)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="px-4 py-2.5 border-t border-border/20 bg-muted/20 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {mcpRunning
            ? <Wifi size={11} className="text-emerald-500" />
            : <WifiOff size={11} className="text-muted-foreground/40" />
          }
          <span>MCP {mcpRunning ? pulse.running : pulse.offline}</span>
        </span>
        <span className="tabular-nums">{pulse.skillCount(enabledSkills, skills.length)}</span>
        {status?.port && (
          <span className="tabular-nums text-muted-foreground/40 hidden sm:inline">
            :{status.port}
          </span>
        )}
      </div>
    </div>
  );
}
