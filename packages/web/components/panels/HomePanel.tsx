'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Brain, ChevronDown, ChevronRight, FolderTree, Loader2, MessageSquare, Network, Plus, RefreshCw, Search, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Logo from '@/components/Logo';
import MindFileTreeSections from '@/components/file-tree/MindFileTreeSections';
import type { AgentRuntimeIdentity, FileNode, ChatSession } from '@/lib/types';
import type { MindSystemSlot } from '@/lib/mind-system';
import { getSessionAgentRuntime } from '@/lib/ask-agent';
import {
  buildChatSessionListEntry,
  chatSessionTitle,
  sessionListAgentFilterId,
  sessionListEntryMatchesSearch,
  type ChatSessionListEntry,
  type SessionListAgentFilter,
  type SessionListAgentKind,
} from '@/lib/session-list-entry';
import { groupChatSessionEntriesByProject, type SessionProjectGroup } from '@/lib/session-project-groups';
import {
  loadCollapsedSessionProjectGroups,
  loadCollapsedHomeSessionSections,
  loadHomeSessionViewMode,
  persistCollapsedHomeSessionSections,
  persistCollapsedSessionProjectGroups,
  persistHomeSessionViewMode,
  type HomeSessionSectionId,
  type HomeSessionViewMode,
} from '@/lib/home-session-view-preferences';
import { agentIconFile } from '@/lib/agent-icons';
import { attachRuntimeSession, deleteSession, forkSession, loadSession, refreshSessions, renameSession, resetSession, togglePinSession, useActiveSessionId, useSessions } from '@/lib/agent-session-store';
import { useRunSummary } from '@/lib/agent-run-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { useLocale } from '@/lib/stores/locale-store';
import { SessionRowActions } from '@/components/shared/SessionRowActions';
import PanelHeader from './PanelHeader';
import { importBoundRuntimeSessionHistory } from '@/lib/runtime-session-history';

type HomeSidebarMode = 'sessions' | 'files';
type CoreSessionAgentFilter = Extract<SessionListAgentFilter, 'all' | 'mindos' | 'codex' | 'claude'>;
type AcpSessionAgentFilter = Extract<SessionListAgentFilter, `acp:${string}`>;
type SessionAgentFilter = SessionListAgentFilter;

const HOME_AGENT_FILTER_BUTTON_PX = 32;
const HOME_AGENT_FILTER_GAP_PX = 4;
const HOME_AGENT_FILTER_MORE_PX = 40;

export interface HomeAgentFilterLayout {
  visibleIds: SessionAgentFilter[];
  hiddenIds: SessionAgentFilter[];
}

interface HomeAgentFilterItem {
  id: SessionAgentFilter;
  label: string;
  count: number;
  icon: ReactNode;
}

export function computeHomeAgentFilterLayout(
  containerWidth: number | null,
  filterIds: SessionAgentFilter[],
  activeId: SessionAgentFilter,
): HomeAgentFilterLayout {
  if (containerWidth === null || filterIds.length === 0) {
    return { visibleIds: filterIds, hiddenIds: [] };
  }

  const maxWithoutOverflow = Math.floor((containerWidth + HOME_AGENT_FILTER_GAP_PX) / (HOME_AGENT_FILTER_BUTTON_PX + HOME_AGENT_FILTER_GAP_PX));
  if (filterIds.length <= maxWithoutOverflow) {
    return { visibleIds: filterIds, hiddenIds: [] };
  }

  const availableForItems = Math.max(0, containerWidth - HOME_AGENT_FILTER_MORE_PX - HOME_AGENT_FILTER_GAP_PX);
  const canFitItemWithOverflow = containerWidth >= HOME_AGENT_FILTER_MORE_PX + HOME_AGENT_FILTER_GAP_PX + HOME_AGENT_FILTER_BUTTON_PX;
  const visibleCapacity = canFitItemWithOverflow
    ? Math.max(1, Math.floor((availableForItems + HOME_AGENT_FILTER_GAP_PX) / (HOME_AGENT_FILTER_BUTTON_PX + HOME_AGENT_FILTER_GAP_PX)))
    : 0;
  let visibleIds = filterIds.slice(0, Math.min(filterIds.length, visibleCapacity));

  if (visibleCapacity > 0 && filterIds.includes(activeId) && !visibleIds.includes(activeId)) {
    visibleIds = visibleIds.length <= 1
      ? [activeId]
      : [...visibleIds.slice(0, -1), activeId];
  }

  const visibleSet = new Set(visibleIds);
  return {
    visibleIds,
    hiddenIds: filterIds.filter((id) => !visibleSet.has(id)),
  };
}

function acpAgentIconSrc(runtime: AgentRuntimeIdentity | null | undefined): string | null {
  if (!runtime || runtime.kind !== 'acp') return null;
  const iconFile = agentIconFile(runtime.id) ?? agentIconFile(runtime.name) ?? agentIconFile(`${runtime.id} ${runtime.name}`);
  return iconFile ? `/agent-icons/${iconFile}` : null;
}

function collectAcpSessionFilters(entries: ChatSessionListEntry[]): Array<{
  id: AcpSessionAgentFilter;
  runtime: AgentRuntimeIdentity;
  count: number;
}> {
  const filters = new Map<string, { runtime: AgentRuntimeIdentity; count: number }>();
  for (const entry of entries) {
    const runtime = entry.agentKind === 'acp' ? entry.runtime : null;
    if (!runtime) continue;
    const existing = filters.get(runtime.id);
    if (existing) {
      existing.count += 1;
    } else {
      filters.set(runtime.id, { runtime, count: 1 });
    }
  }

  return Array.from(filters.entries()).map(([runtimeId, entry]) => ({
    id: `acp:${runtimeId}` as AcpSessionAgentFilter,
    ...entry,
  }));
}

function HomeModeSwitch({
  mode,
  onModeChange,
}: {
  mode: HomeSidebarMode;
  onModeChange: (mode: HomeSidebarMode) => void;
}) {
  const { t } = useLocale();
  const options: Array<{ id: HomeSidebarMode; label: string; icon: ReactNode }> = [
    { id: 'sessions', label: t.sidebar.homeAgentSessions, icon: <MessageSquare size={14} aria-hidden="true" /> },
    { id: 'files', label: t.sidebar.homeMindFiles, icon: <Brain size={14} aria-hidden="true" /> },
  ];

  return (
    <div className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border/70 bg-background/70 p-0.5" role="group" aria-label={t.sidebar.home}>
      {options.map((option) => {
        const active = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-home-sidebar-mode={option.id}
            data-hit-active={active ? 'true' : undefined}
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            onClick={() => onModeChange(option.id)}
            className={`hit-target-box inline-flex h-7 w-7 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] ${
              active
                ? 'text-[var(--amber)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-border-width:1px] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
                : 'text-muted-foreground/55 [--hit-target-hover-bg:var(--muted)] hover:text-foreground'
            }`}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}

function AgentMark({
  kind,
  id,
  active,
  size = 'md',
  runtime,
}: {
  kind: SessionListAgentKind;
  id: string;
  active?: boolean;
  size?: 'sm' | 'md';
  runtime?: AgentRuntimeIdentity | null;
}) {
  const boxSize = size === 'sm' ? 'h-5 w-5 rounded-md' : 'h-6 w-6 rounded-md';
  const iconSize = size === 'sm' ? 10 : 12;
  const logoClass = size === 'sm' ? 'h-2 w-3.5' : 'h-2.5 w-[18px]';
  const runtimeLogoClass = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const shared = `inline-flex shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-background/85 shadow-[0_1px_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)] dark:bg-muted/70 dark:shadow-none ${boxSize}`;

  if (kind === 'mindos') {
    return (
      <span
        data-home-session-agent={kind}
        className={`${shared} text-[var(--amber)] ${active ? 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--amber)_22%,transparent)_inset]' : ''}`}
      >
        <Logo id={`home-agent-${safeId}`} className={logoClass} />
      </span>
    );
  }

  if (kind === 'codex') {
    return (
      <span data-home-session-agent={kind} className={shared}>
        <img src="/agent-icons/openai.svg" alt="" aria-hidden="true" className={`${runtimeLogoClass} object-contain`} />
      </span>
    );
  }

  if (kind === 'claude') {
    return (
      <span data-home-session-agent={kind} className={shared}>
        <img src="/agent-icons/claude.svg" alt="" aria-hidden="true" className={`${runtimeLogoClass} object-contain`} />
      </span>
    );
  }

  const acpIconSrc = acpAgentIconSrc(runtime);
  if (kind === 'acp' && acpIconSrc) {
    return (
      <span data-home-session-agent={kind} data-home-session-agent-runtime={runtime?.id} className={shared}>
        <img src={acpIconSrc} alt="" aria-hidden="true" className={`${runtimeLogoClass} object-contain`} />
      </span>
    );
  }

  return (
    <span data-home-session-agent={kind} className={`${shared} text-[var(--tool-read)]`}>
      <Network size={iconSize} aria-hidden="true" />
    </span>
  );
}

function SessionStatusDot({
  running,
  status,
  className = '',
}: {
  running: boolean;
  status?: string;
  className?: string;
}) {
  const { t } = useLocale();
  if (!running && (!status || status === 'active')) return null;

  const failed = status === 'failed' || status === 'missing' || status === 'signed-out';
  const label = running ? t.sidebar.homeRuntimeRunning : status || t.sidebar.homeRuntimeIdle;

  return (
    <span
      data-home-session-status={running ? 'running' : status}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${className}`}
      aria-label={label}
      title={label}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          running
            ? 'bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_14%,transparent)] motion-safe:animate-pulse'
            : failed
              ? 'bg-[var(--error)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--error)_12%,transparent)]'
              : 'bg-[var(--amber)] shadow-[0_0_0_3px_var(--amber-subtle)]'
        }`}
      />
    </span>
  );
}

function HomeHeaderIconButton({
  label,
  onClick,
  children,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active ?? undefined}
      data-hit-active={active ? 'true' : undefined}
      className={`hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)] ${
        active ? 'text-foreground [--hit-target-active-bg:var(--amber-subtle)]' : ''
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function HomeSessionSearchField({
  value,
  onChange,
  onClear,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useLocale();
  return (
    <div className="px-2 pb-1.5" data-home-session-search>
      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/75 px-2 focus-within:border-[var(--amber)]/40 focus-within:ring-2 focus-within:ring-[var(--amber)]/15">
        <Search size={13} aria-hidden="true" className="shrink-0 text-muted-foreground/60" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onInput={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClear();
            }
          }}
          placeholder={t.sidebar.homeSearchSessionsPlaceholder}
          aria-label={t.sidebar.homeSearchSessions}
          data-home-session-search-input
          className="min-w-0 flex-1 bg-transparent text-[12px] leading-4 text-foreground outline-none placeholder:text-muted-foreground/45"
        />
        {value.trim() ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={t.sidebar.homeClearSessionSearch}
            title={t.sidebar.homeClearSessionSearch}
            className="hit-target-box inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HomeAgentFilter({
  value,
  onChange,
  counts,
  acpFilters,
}: {
  value: SessionAgentFilter;
  onChange: (value: SessionAgentFilter) => void;
  counts: Record<CoreSessionAgentFilter, number>;
  acpFilters: Array<{ id: AcpSessionAgentFilter; runtime: AgentRuntimeIdentity; count: number }>;
}) {
  const { t } = useLocale();
  const filterRailRef = useRef<HTMLDivElement>(null);
  const [filterRailWidth, setFilterRailWidth] = useState<number | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const filters: HomeAgentFilterItem[] = [
    { id: 'all', label: t.sidebar.homeFilterAll, count: counts.all, icon: <MessageSquare size={14} aria-hidden="true" /> },
    { id: 'mindos', label: t.sidebar.homeFilterMindOS, count: counts.mindos, icon: <AgentMark kind="mindos" id="filter-mindos" size="md" /> },
    { id: 'codex', label: t.sidebar.homeFilterCodex, count: counts.codex, icon: <AgentMark kind="codex" id="filter-codex" size="md" /> },
    { id: 'claude', label: t.sidebar.homeFilterClaude, count: counts.claude, icon: <AgentMark kind="claude" id="filter-claude" size="md" /> },
    ...acpFilters.map((filter) => ({
      id: filter.id,
      label: `${t.sidebar.homeFilterAcp}: ${filter.runtime.name}`,
      count: filter.count,
      icon: <AgentMark kind="acp" id={`filter-${filter.runtime.id}`} size="md" runtime={filter.runtime} />,
    })),
  ];
  const filterIds = useMemo(() => filters.map((filter) => filter.id), [filters]);
  const filterById = useMemo(() => new Map(filters.map((filter) => [filter.id, filter])), [filters]);
  const filterLayout = useMemo(
    () => computeHomeAgentFilterLayout(filterRailWidth, filterIds, value),
    [filterIds, filterRailWidth, value],
  );
  const visibleFilters = filterLayout.visibleIds
    .map((id) => filterById.get(id))
    .filter((filter): filter is HomeAgentFilterItem => Boolean(filter));
  const hiddenFilters = filterLayout.hiddenIds
    .map((id) => filterById.get(id))
    .filter((filter): filter is HomeAgentFilterItem => Boolean(filter));
  const moreLabel = t.sidebar.homeFilterMore ?? 'More agents';

  useEffect(() => {
    const node = filterRailRef.current;
    if (!node) return;
    const updateWidth = (width: number) => {
      const next = Math.floor(width);
      if (next > 0) setFilterRailWidth((current) => (current === next ? current : next));
    };
    updateWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateWidth(entry?.contentRect.width ?? node.getBoundingClientRect().width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hiddenFilters.length === 0) setOverflowOpen(false);
  }, [hiddenFilters.length]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!filterRailRef.current?.contains(event.target as Node)) setOverflowOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [overflowOpen]);

  return (
    <div ref={filterRailRef} className="relative flex min-w-0 shrink-0 items-center gap-1 px-2 pb-1.5 pt-2" role="group" aria-label={t.sidebar.homeAgentFilter} data-home-agent-filter-rail>
      {visibleFilters.map((filter) => {
        const active = value === filter.id;
        return (
          <button
            key={filter.id}
            type="button"
            data-home-agent-filter={filter.id}
            data-hit-active={active ? 'true' : undefined}
            aria-label={`${filter.label} (${filter.count})`}
            aria-pressed={active}
            title={`${filter.label} (${filter.count})`}
            onClick={() => onChange(filter.id)}
            className={`hit-target-box inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] [--hit-target-hover-bg:var(--muted)] ${
              active
                ? 'text-[var(--amber)] [--hit-target-border-width:1px] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
                : 'text-muted-foreground/55 hover:text-foreground'
            }`}
          >
            {filter.icon}
          </button>
        );
      })}
      {hiddenFilters.length > 0 ? (
        <>
          <button
            type="button"
            data-home-agent-filter-overflow-trigger
            data-hit-active={overflowOpen ? 'true' : undefined}
            aria-label={`${moreLabel} (${hiddenFilters.length})`}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            title={`${moreLabel} (${hiddenFilters.length})`}
            onClick={() => setOverflowOpen((open) => !open)}
            className={`hit-target-box inline-flex h-8 min-w-10 shrink-0 items-center justify-center px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] [--hit-target-hover-bg:var(--muted)] ${
              overflowOpen
                ? 'text-[var(--amber)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-border-width:1px] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
                : 'text-muted-foreground/55 hover:text-foreground'
            }`}
          >
            +{hiddenFilters.length}
          </button>
          {overflowOpen ? (
            <div
              role="menu"
              data-home-agent-filter-overflow-menu
              aria-label={moreLabel}
              className="absolute right-2 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border/70 bg-background p-1 shadow-lg shadow-foreground/10"
            >
              {hiddenFilters.map((filter) => {
                const active = value === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    data-home-agent-filter-option={filter.id}
                    data-hit-active={active ? 'true' : undefined}
                    onClick={() => {
                      onChange(filter.id);
                      setOverflowOpen(false);
                    }}
                    className={`hit-target-box flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)] ${
                      active
                        ? 'text-[var(--amber)] [--hit-target-active-bg:var(--amber-subtle)]'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="shrink-0">{filter.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{filter.label}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground/45">{filter.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function HomeSessionViewToolbar({
  viewMode,
  onViewModeChange,
  onNewSession,
  onSearchSessions,
  onRefreshSessions,
  refreshingSessions,
  searchActive,
}: {
  viewMode: HomeSessionViewMode;
  onViewModeChange: (value: HomeSessionViewMode) => void;
  onNewSession: () => void;
  onSearchSessions: () => void;
  onRefreshSessions: () => void;
  refreshingSessions: boolean;
  searchActive: boolean;
}) {
  const { t } = useLocale();
  const groupByProject = viewMode === 'project';
  const groupByProjectLabel = t.sidebar.homeGroupByProject ?? 'Group by project';

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-1.5" data-home-session-toolbar>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          data-home-session-project-toggle
          data-hit-active={groupByProject ? 'true' : undefined}
          aria-label={groupByProjectLabel}
          aria-pressed={groupByProject}
          onClick={() => onViewModeChange(groupByProject ? 'recent' : 'project')}
          className={`hit-target-box inline-flex h-8 w-8 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] ${
            groupByProject
              ? 'text-[var(--amber)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-border-width:1px] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
              : 'text-muted-foreground/55 [--hit-target-hover-bg:var(--muted)] hover:text-foreground'
          }`}
          title={groupByProjectLabel}
        >
          <FolderTree size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <HomeHeaderIconButton label={t.sidebar.homeNewSession} onClick={onNewSession}>
          <Plus size={13} aria-hidden="true" />
        </HomeHeaderIconButton>
        <HomeHeaderIconButton
          label={t.sidebar.homeSearchSessions}
          onClick={onSearchSessions}
          active={searchActive}
        >
          <Search size={13} aria-hidden="true" />
        </HomeHeaderIconButton>
        <HomeHeaderIconButton label={t.sidebar.homeRefreshSessions} onClick={onRefreshSessions} disabled={refreshingSessions}>
          {refreshingSessions ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
        </HomeHeaderIconButton>
      </div>
    </div>
  );
}

function HomeSessionSection({
  id,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: HomeSessionSectionId;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0" data-home-session-section={id}>
      <button
        type="button"
        data-home-session-section-header={id}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="hit-target-box flex h-7 w-full min-w-0 items-center gap-1.5 px-1.5 text-left text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
      >
        <span className="min-w-0 truncate">{title}</span>
        {collapsed ? <ChevronRight size={12} aria-hidden="true" className="shrink-0" /> : <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}
      </button>
      {!collapsed ? (
        <div className="mt-1 space-y-1" data-home-session-section-entries={id}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function HomeSessionProjectGroupHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: SessionProjectGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const title = group.kind === 'mind-root'
    ? t.sidebar.homeSessionGroupMind
    : group.kind === 'no-project'
      ? t.sidebar.homeSessionGroupNoProject
      : group.title;
  const tooltip = group.pathLabel ? `${title} · ${group.pathLabel}` : title;

  return (
    <button
      type="button"
      data-home-session-project-group-header={group.id}
      aria-expanded={!collapsed}
      onClick={onToggle}
      title={tooltip}
      className="hit-target-box flex h-7 w-full min-w-0 items-center gap-1.5 px-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
    >
      {collapsed ? <ChevronRight size={12} aria-hidden="true" className="shrink-0" /> : <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal leading-none text-muted-foreground/70" data-home-session-project-group-count>
        {group.entries.length}
      </span>
    </button>
  );
}

function HomeSessionRow({
  session,
  listEntry,
  active,
  running,
  editing,
  editValue,
  inputRef,
  onOpen,
  onEditValueChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onTogglePin,
  onFork,
  onArchive,
  showProjectPath = true,
}: {
  session: ChatSession;
  listEntry: ChatSessionListEntry;
  active: boolean;
  running: boolean;
  editing: boolean;
  editValue: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpen: () => void;
  onEditValueChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onTogglePin: () => void;
  onFork: () => void;
  onArchive: () => void;
  showProjectPath?: boolean;
}) {
  const { t } = useLocale();
  const sessionRuntime = listEntry.runtime;
  const agentKind = listEntry.agentKind;
  const title = listEntry.title;
  const pinLabel = session.pinned ? t.sidebar.homeUnpinSession : t.sidebar.homePinSession;
  const hasRuntimeStatus = running || Boolean(listEntry.status && listEntry.status !== 'active');
  const msgCount = listEntry.messageCount ?? 0;
  const updatedAtLabel = listEntry.updatedAtLabel;
  const statusIndicator = !editing && hasRuntimeStatus ? (
    <SessionStatusDot
      running={running}
      status={listEntry.status ?? undefined}
    />
  ) : null;
  const titleTrailingInsetClass = !editing
    ? updatedAtLabel
      ? statusIndicator
        ? 'pr-16'
        : 'pr-14'
      : statusIndicator
        ? 'pr-6'
        : undefined
    : undefined;
  return (
    <div
      data-home-session-row={session.id}
      data-hit-active={active ? 'true' : undefined}
      className={`hit-target-box group relative w-full min-w-0 px-1.5 py-1.5 text-left transition-colors focus-within:text-foreground [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-bg:var(--muted)] ${
        active
          ? '[--hit-target-border-width:1px] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
          : ''
      }`}
    >
      <button
        type="button"
        data-home-session-open
        onClick={onOpen}
        aria-label={title}
        title={title}
        className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="pointer-events-none relative z-10 min-w-0">
        <div
          data-home-session-label
          aria-hidden={!editing}
          className="relative flex min-w-0 items-center gap-1.5"
        >
          <AgentMark kind={agentKind} id={session.id} active={active} runtime={sessionRuntime} />
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(event) => onEditValueChange(event.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onCommitRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              aria-label={t.sidebar.homeRenameSession}
              className="pointer-events-auto min-w-0 flex-1 border-b border-[var(--amber)] bg-transparent text-[12px] font-medium leading-4 text-foreground outline-none"
              placeholder={t.sidebar.homeRenameSession}
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate text-[12px] font-medium leading-4 text-foreground/90 ${titleTrailingInsetClass ?? ''}`} title={title}>
              {title}
            </span>
          )}
          {!editing && (updatedAtLabel || statusIndicator) && (
            <span
              data-home-session-time
              className="pointer-events-none absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground/40 transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0"
            >
              {statusIndicator && (
                <span className="inline-flex shrink-0 items-center">
                  {statusIndicator}
                </span>
              )}
              {updatedAtLabel && (
                <span className="shrink-0">
                  {updatedAtLabel}
                </span>
              )}
            </span>
          )}
          {!editing && (
            <span
              data-home-session-actions
              className="pointer-events-none absolute right-0 top-1/2 z-20 inline-flex -translate-y-1/2 items-center justify-end rounded-md bg-background/90 pl-1 opacity-0 backdrop-blur-sm transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            >
              <SessionRowActions
                pinned={session.pinned}
                onTogglePin={onTogglePin}
                onRename={onStartRename}
                onFork={onFork}
                onArchive={onArchive}
                labels={{
                  pin: pinLabel,
                  unpin: t.sidebar.homeUnpinSession,
                  rename: t.sidebar.homeRenameSession,
                  fork: t.sidebar.homeForkSession,
                  archive: t.sidebar.homeArchiveSession,
                }}
              />
            </span>
          )}
        </div>
        <div
          data-home-session-meta
          className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-7 text-[10px] text-muted-foreground/45 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
          title={listEntry.metadataTitle}
        >
          {listEntry.status && listEntry.status !== 'active' && (
            <>
              <span className="shrink-0">{listEntry.status}</span>
              <span className="shrink-0 text-muted-foreground/25">·</span>
            </>
          )}
          {showProjectPath && listEntry.compactRuntimePath && (
            <>
              <span className="truncate font-mono">{listEntry.compactRuntimePath}</span>
              <span className="shrink-0 text-muted-foreground/25">·</span>
            </>
          )}
          <span className="inline-flex shrink-0 items-center gap-1">
            <MessageSquare size={9} aria-hidden="true" />
            {t.ask.historyMsgs?.(msgCount) ?? `${msgCount} msgs`}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function HomePanel({
  active,
  fileTree,
  mindSystemSlots,
  onNavigate,
}: {
  active: boolean;
  fileTree: FileNode[];
  mindSystemSlots: MindSystemSlot[];
  onNavigate?: () => void;
  onSearchOpenOrFocus?: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const smoothPush = useSmoothRouterPush();
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();
  const runSummary = useRunSummary();
  const [mode, setMode] = useState<HomeSidebarMode>('sessions');
  const [agentFilter, setAgentFilter] = useState<SessionAgentFilter>('all');
  const [refreshingSessions, setRefreshingSessions] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionTitle, setEditSessionTitle] = useState('');
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [sessionViewMode, setSessionViewModeState] = useState<HomeSessionViewMode>(loadHomeSessionViewMode);
  const [collapsedSessionSectionIds, setCollapsedSessionSectionIds] = useState<Set<HomeSessionSectionId>>(loadCollapsedHomeSessionSections);
  const [collapsedProjectGroupIds, setCollapsedProjectGroupIds] = useState<Set<string>>(loadCollapsedSessionProjectGroups);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) setMode('sessions');
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void refreshSessions();
  }, [active]);

  useEffect(() => {
    if (editingSessionId) setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [editingSessionId]);

  useEffect(() => {
    if (sessionSearchOpen) setTimeout(() => sessionSearchInputRef.current?.focus(), 0);
  }, [sessionSearchOpen]);

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  }), [sessions]);
  const sessionEntries = useMemo(() => (
    sortedSessions.map((session) => buildChatSessionListEntry(session, { emptyTitleFallback: t.ask.historyEmptyHint }))
  ), [sortedSessions, t.ask.historyEmptyHint]);
  const acpFilters = useMemo(() => collectAcpSessionFilters(sessionEntries), [sessionEntries]);

  const agentCounts = useMemo(() => {
    const counts: Record<CoreSessionAgentFilter, number> = {
      all: sessionEntries.length,
      mindos: 0,
      codex: 0,
      claude: 0,
    };
    for (const entry of sessionEntries) {
      const filterId = sessionListAgentFilterId(entry);
      if (filterId === 'mindos' || filterId === 'codex' || filterId === 'claude') {
        counts[filterId] += 1;
      }
    }
    return counts;
  }, [sessionEntries]);

  const availableFilterIds = useMemo(() => new Set<SessionAgentFilter>([
    'all',
    'mindos',
    'codex',
    'claude',
    ...acpFilters.map((filter) => filter.id),
  ]), [acpFilters]);

  useEffect(() => {
    if (!availableFilterIds.has(agentFilter)) setAgentFilter('all');
  }, [agentFilter, availableFilterIds]);

  const agentFilteredEntries = useMemo(() => (
    agentFilter === 'all'
      ? sessionEntries
      : sessionEntries.filter((entry) => sessionListAgentFilterId(entry) === agentFilter)
  ), [agentFilter, sessionEntries]);

  const filteredEntries = useMemo(() => {
    const query = sessionSearchQuery.trim();
    if (!query) return agentFilteredEntries;
    return agentFilteredEntries.filter((entry) => sessionListEntryMatchesSearch(entry, query));
  }, [agentFilteredEntries, sessionSearchQuery]);
  const pinnedEntries = useMemo(() => filteredEntries.filter((entry) => entry.pinned), [filteredEntries]);
  const unpinnedEntries = useMemo(() => filteredEntries.filter((entry) => !entry.pinned), [filteredEntries]);
  const projectGroups = useMemo(() => (
    groupChatSessionEntriesByProject(unpinnedEntries).filter((group) => group.kind !== 'no-project')
  ), [unpinnedEntries]);
  const projectEntryIds = useMemo(() => new Set(projectGroups.flatMap((group) => group.entries.map((entry) => entry.id))), [projectGroups]);
  const chatEntries = useMemo(() => (
    unpinnedEntries.filter((entry) => !projectEntryIds.has(entry.id))
  ), [projectEntryIds, unpinnedEntries]);
  const normalizedSessionSearchQuery = sessionSearchQuery.trim();
  const sessionSearchActive = sessionSearchOpen || Boolean(normalizedSessionSearchQuery);

  const setSessionViewMode = useCallback((value: HomeSessionViewMode) => {
    setSessionViewModeState(value);
    persistHomeSessionViewMode(value);
  }, []);

  const toggleProjectGroup = useCallback((groupId: string) => {
    setCollapsedProjectGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      persistCollapsedSessionProjectGroups(next);
      return next;
    });
  }, []);

  const toggleSessionSection = useCallback((sectionId: HomeSessionSectionId) => {
    setCollapsedSessionSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      persistCollapsedHomeSessionSections(next);
      return next;
    });
  }, []);

  const handleSearchSessions = useCallback(() => {
    if (sessionSearchActive) {
      setSessionSearchQuery('');
      setSessionSearchOpen(false);
      return;
    }
    setSessionSearchOpen(true);
    setTimeout(() => sessionSearchInputRef.current?.focus(), 0);
  }, [sessionSearchActive]);

  const clearSessionSearch = useCallback(() => {
    setSessionSearchQuery('');
    setSessionSearchOpen(false);
  }, []);

  const handleNewSession = useCallback(() => {
    resetSession();
    if (pathname !== '/') smoothPush('/');
  }, [pathname, smoothPush]);

  const handleRefreshSessions = useCallback(() => {
    if (refreshingSessions) return;
    setRefreshingSessions(true);
    void refreshSessions().finally(() => setRefreshingSessions(false));
  }, [refreshingSessions]);

  const startRenameSession = useCallback((session: ChatSession) => {
    const title = chatSessionTitle(session);
    setEditingSessionId(session.id);
    setEditSessionTitle(title === '(empty session)' ? '' : title);
  }, []);

  const commitRenameSession = useCallback(() => {
    if (editingSessionId && editSessionTitle.trim()) {
      renameSession(editingSessionId, editSessionTitle.trim());
    }
    setEditingSessionId(null);
  }, [editingSessionId, editSessionTitle]);

  const forkHomeSession = useCallback((id: string) => {
    const forkedId = forkSession(id);
    if (!forkedId) return;
    setEditingSessionId(null);
    if (pathname !== '/') smoothPush('/');
  }, [pathname, smoothPush]);

  const archiveHomeSession = useCallback((session: ChatSession) => {
    if (editingSessionId === session.id) setEditingSessionId(null);
    deleteSession(session.id, { runtime: getSessionAgentRuntime(session) });
  }, [editingSessionId]);

  const openSession = useCallback((id: string) => {
    const target = sessions.find((session) => session.id === id) ?? null;
    loadSession(id);
    if (target) {
      void importBoundRuntimeSessionHistory(
        target,
        getSessionAgentRuntime(target),
        (runtime, binding, metadata) => attachRuntimeSession(runtime, binding, metadata),
      );
    }
    if (pathname !== '/') smoothPush('/');
  }, [pathname, sessions, smoothPush]);

  const renderSessionRow = (entry: ChatSessionListEntry, showProjectPath = true) => (
    <HomeSessionRow
      key={entry.id}
      session={entry.session}
      listEntry={entry}
      active={entry.id === activeSessionId}
      running={runSummary.running.has(entry.id)}
      editing={editingSessionId === entry.id}
      editValue={editSessionTitle}
      inputRef={renameInputRef}
      onEditValueChange={setEditSessionTitle}
      onOpen={() => openSession(entry.id)}
      onStartRename={() => startRenameSession(entry.session)}
      onCommitRename={commitRenameSession}
      onCancelRename={() => setEditingSessionId(null)}
      onTogglePin={() => togglePinSession(entry.id)}
      onFork={() => forkHomeSession(entry.id)}
      onArchive={() => archiveHomeSession(entry.session)}
      showProjectPath={showProjectPath}
    />
  );

  return (
    <div className="flex h-full flex-col" data-home-sidebar-panel>
      <PanelHeader title={t.sidebar.home}>
        <HomeModeSwitch mode={mode} onModeChange={setMode} />
      </PanelHeader>

      {mode === 'sessions' ? (
        <>
          <HomeAgentFilter value={agentFilter} onChange={setAgentFilter} counts={agentCounts} acpFilters={acpFilters} />
          <HomeSessionViewToolbar
            viewMode={sessionViewMode}
            onViewModeChange={setSessionViewMode}
            onNewSession={handleNewSession}
            onSearchSessions={handleSearchSessions}
            onRefreshSessions={handleRefreshSessions}
            refreshingSessions={refreshingSessions}
            searchActive={sessionSearchActive}
          />
          {sessionSearchActive ? (
            <HomeSessionSearchField
              value={sessionSearchQuery}
              onChange={setSessionSearchQuery}
              onClear={clearSessionSearch}
              inputRef={sessionSearchInputRef}
            />
          ) : null}
          <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-home-session-list>
          {sortedSessions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-5 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <MessageSquare size={17} aria-hidden="true" />
              </div>
              <p className="text-sm text-foreground">{t.sidebar.homeEmptySessions}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.sidebar.homeEmptySessionsHint}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setMode('files')}
                  className="hit-target-box inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium text-foreground [--hit-target-border-width:1px] [--hit-target-border:var(--border)] [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
                >
                  <Brain size={13} aria-hidden="true" />
                  {t.sidebar.homeMindFiles}
                </button>
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="hit-target-box inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium text-[var(--amber-foreground)] [--hit-target-bg:var(--amber)] [--hit-target-hover-bg:var(--amber)] [--hit-target-radius:var(--radius-md)]"
                >
                  <Plus size={13} aria-hidden="true" />
                  {t.sidebar.homeNewSession}
                </button>
              </div>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-5 text-center" data-home-session-search-empty>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <Search size={17} aria-hidden="true" />
              </div>
              <p className="text-sm text-foreground">{t.sidebar.homeNoSessionSearchResults}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.sidebar.homeNoSessionSearchResultsHint}</p>
            </div>
          ) : sessionViewMode === 'project' ? (
            <div className="space-y-2" data-home-session-project-view>
              {pinnedEntries.length > 0 ? (
                <HomeSessionSection
                  id="pinned"
                  title={t.sidebar.homeSessionSectionPinned ?? 'Pinned'}
                  collapsed={collapsedSessionSectionIds.has('pinned') && !normalizedSessionSearchQuery}
                  onToggle={() => toggleSessionSection('pinned')}
                >
                  {pinnedEntries.map((entry) => renderSessionRow(entry))}
                </HomeSessionSection>
              ) : null}
              {projectGroups.length > 0 ? (
                <HomeSessionSection
                  id="projects"
                  title={t.sidebar.homeSessionSectionProjects ?? 'Projects'}
                  collapsed={collapsedSessionSectionIds.has('projects') && !normalizedSessionSearchQuery}
                  onToggle={() => toggleSessionSection('projects')}
                >
                  {projectGroups.map((group) => {
                    const collapsed = collapsedProjectGroupIds.has(group.id) && !normalizedSessionSearchQuery;
                    return (
                      <section key={group.id} className="min-w-0" data-home-session-project-group={group.id}>
                        <HomeSessionProjectGroupHeader
                          group={group}
                          collapsed={collapsed}
                          onToggle={() => toggleProjectGroup(group.id)}
                        />
                        {!collapsed ? (
                          <div className="mt-1 space-y-1" data-home-session-project-group-entries={group.id}>
                            {group.entries.map((entry) => renderSessionRow(entry, false))}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </HomeSessionSection>
              ) : null}
              {chatEntries.length > 0 ? (
                <HomeSessionSection
                  id="chats"
                  title={t.sidebar.homeSessionSectionChats ?? 'Chats'}
                  collapsed={collapsedSessionSectionIds.has('chats') && !normalizedSessionSearchQuery}
                  onToggle={() => toggleSessionSection('chats')}
                >
                  {chatEntries.map((entry) => renderSessionRow(entry))}
                </HomeSessionSection>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1" data-home-session-recent-view>
              {pinnedEntries.length > 0 ? (
                <HomeSessionSection
                  id="pinned"
                  title={t.sidebar.homeSessionSectionPinned ?? 'Pinned'}
                  collapsed={collapsedSessionSectionIds.has('pinned') && !normalizedSessionSearchQuery}
                  onToggle={() => toggleSessionSection('pinned')}
                >
                  {pinnedEntries.map((entry) => renderSessionRow(entry))}
                </HomeSessionSection>
              ) : null}
              {unpinnedEntries.length > 0 ? (
                <HomeSessionSection
                  id="chats"
                  title={t.sidebar.homeSessionSectionChats ?? 'Chats'}
                  collapsed={collapsedSessionSectionIds.has('chats') && !normalizedSessionSearchQuery}
                  onToggle={() => toggleSessionSection('chats')}
                >
                  {unpinnedEntries.map((entry) => renderSessionRow(entry))}
                </HomeSessionSection>
              ) : null}
            </div>
          )}
          </div>
        </>
      ) : (
        <div
          className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto px-2 py-2"
          data-home-mind-files
          onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) e.stopPropagation(); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
          onDrop={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
        >
          <MindFileTreeSections
            fileTree={fileTree}
            mindSystemSlots={mindSystemSlots}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}
