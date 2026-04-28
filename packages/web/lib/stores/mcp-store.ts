'use client';

import { create } from 'zustand';
import { apiFetch } from '@/lib/api';
import type { McpStatus, AgentInfo, SkillInfo } from '@/components/settings/types';

/* ── Public interface (unchanged from old Context) ── */

export interface McpStoreState {
  status: McpStatus | null;
  agents: AgentInfo[];
  skills: SkillInfo[];
  loading: boolean;

  /* actions */
  refresh: () => Promise<void>;
  toggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  installAgent: (key: string, opts?: { scope?: string; transport?: string }) => Promise<boolean>;

  /* lifecycle (called once by McpStoreInit) */
  _init: () => () => void;
}

/** Keep the old name as an alias so consumers that import the type still compile. */
export type McpContextValue = McpStoreState;

/* ── Abort controller for race-condition safety ── */

let abortCtrl: AbortController | null = null;

/* ── Store ── */

const POLL_INTERVAL = 30_000;

async function fetchAll(set: (partial: Partial<McpStoreState>) => void) {
  abortCtrl?.abort();
  const ac = new AbortController();
  abortCtrl = ac;

  try {
    const [statusData, agentsData, skillsData] = await Promise.all([
      apiFetch<McpStatus>('/api/mcp/status', { signal: ac.signal }),
      apiFetch<{ agents: AgentInfo[] }>('/api/mcp/agents', { signal: ac.signal }),
      apiFetch<{ skills: SkillInfo[] }>('/api/skills', { signal: ac.signal }),
    ]);
    if (!ac.signal.aborted) {
      set({ status: statusData, agents: agentsData.agents, skills: skillsData.skills });
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
  } finally {
    if (!ac.signal.aborted) set({ loading: false });
  }
}

export const useMcpStore = create<McpStoreState>((set, get) => ({
  status: null,
  agents: [],
  skills: [],
  loading: true,

  refresh: () => fetchAll(set),

  toggleSkill: async (name, enabled) => {
    // Optimistic update
    set({ skills: get().skills.map(s => s.name === name ? { ...s, enabled } : s) });
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', name, enabled }),
      });
      return true;
    } catch {
      // Revert on failure
      set({ skills: get().skills.map(s => s.name === name ? { ...s, enabled: !enabled } : s) });
      return false;
    }
  },

  installAgent: async (key, opts) => {
    const agent = get().agents.find(a => a.key === key);
    if (!agent) return false;

    try {
      const res = await apiFetch<{ results: Array<{ agent?: string; status?: string; ok?: boolean; error?: string }> }>('/api/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: [{
            key,
            scope: opts?.scope ?? (agent.hasProjectScope ? 'project' : 'global'),
            transport: opts?.transport ?? agent.preferredTransport,
          }],
          transport: 'auto',
        }),
      });

      const first = res.results?.[0];
      const ok = first?.ok === true || first?.status === 'ok';
      if (ok) await fetchAll(set);
      return ok;
    } catch {
      return false;
    }
  },

  /**
   * Start polling + event listeners. Returns a cleanup function.
   * Must be called exactly once (by McpStoreInit).
   */
  _init: () => {
    // Initial fetch
    fetchAll(set);

    // Event listener: skill CRUD mutations (debounced 500ms)
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const onSkillsChanged = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchAll(set), 500);
    };
    window.addEventListener('mindos:skills-changed', onSkillsChanged);

    // 30s polling when visible
    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll(set);
    }, POLL_INTERVAL);

    return () => {
      abortCtrl?.abort();
      clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      window.removeEventListener('mindos:skills-changed', onSkillsChanged);
    };
  },
}));

/* ── Convenience hooks (backward-compatible API) ── */

/**
 * Required hook — same behavior as old useMcpData().
 * With Zustand this never throws because the store is global,
 * but we keep the name for migration compatibility.
 */
export function useMcpData(): McpStoreState {
  return useMcpStore();
}

/**
 * Optional hook — returns the full store (never null with Zustand).
 * Kept for backward-compat; callers that checked `if (!mcp)` will
 * now always get a value (loading=true initially, then loading=false).
 */
export function useMcpDataOptional(): McpStoreState {
  return useMcpStore();
}

/* ── Granular selectors — subscribe to individual fields to avoid unnecessary re-renders ── */

export const useMcpLoading = () => useMcpStore(s => s.loading);
export const useMcpAgents = () => useMcpStore(s => s.agents);
export const useMcpSkills = () => useMcpStore(s => s.skills);
export const useMcpStatus = () => useMcpStore(s => s.status);
export const useMcpRefresh = () => useMcpStore(s => s.refresh);
export const useMcpToggleSkill = () => useMcpStore(s => s.toggleSkill);
export const useMcpInstallAgent = () => useMcpStore(s => s.installAgent);
