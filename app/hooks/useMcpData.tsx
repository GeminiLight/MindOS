'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api';
import type { McpStatus, AgentInfo, SkillInfo } from '@/components/settings/types';

/* ── Context shape ── */

export interface McpContextValue {
  status: McpStatus | null;
  agents: AgentInfo[];
  skills: SkillInfo[];
  loading: boolean;
  refresh: () => Promise<void>;
  toggleSkill: (name: string, enabled: boolean) => Promise<void>;
  installAgent: (key: string, opts?: { scope?: string; transport?: string }) => Promise<boolean>;
}

const McpContext = createContext<McpContextValue | null>(null);

export function useMcpData(): McpContextValue {
  const ctx = useContext(McpContext);
  if (!ctx) throw new Error('useMcpData must be used within McpProvider');
  return ctx;
}

/** Optional hook that returns null outside provider (for components that may or may not be wrapped) */
export function useMcpDataOptional(): McpContextValue | null {
  return useContext(McpContext);
}

/* ── Provider ── */

const POLL_INTERVAL = 30_000;

export default function McpProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  // Ref for agents to avoid stale closure in installAgent
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const fetchAll = useCallback(async () => {
    // Abort any in-flight request to prevent race conditions
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const [statusData, agentsData, skillsData] = await Promise.all([
        apiFetch<McpStatus>('/api/mcp/status', { signal: ac.signal }),
        apiFetch<{ agents: AgentInfo[] }>('/api/mcp/agents', { signal: ac.signal }),
        apiFetch<{ skills: SkillInfo[] }>('/api/skills', { signal: ac.signal }),
      ]);
      if (!ac.signal.aborted) {
        setStatus(statusData);
        setAgents(agentsData.agents);
        setSkills(skillsData.skills);
      }
    } catch (err: unknown) {
      // Ignore abort errors
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // On error, keep existing data
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  // Listen for skill changes from SkillsSection (settings CRUD — create/delete/edit)
  // Debounce to coalesce rapid mutations into a single refresh
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchAll(), 500);
    };
    window.addEventListener('mindos:skills-changed', handler);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mindos:skills-changed', handler);
    };
  }, [fetchAll]);

  // 30s polling when visible
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const startPolling = () => {
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') fetchAll();
      }, POLL_INTERVAL);
    };

    startPolling();
    return () => clearInterval(timer);
  }, [fetchAll]);

  const refresh = useCallback(async () => {
    await fetchAll();
  }, [fetchAll]);

  const toggleSkill = useCallback(async (name: string, enabled: boolean) => {
    // Optimistic update
    setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', name, enabled }),
      });
    } catch {
      // Revert on failure
      setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled: !enabled } : s));
    }
  }, []);

  const installAgent = useCallback(async (key: string, opts?: { scope?: string; transport?: string }): Promise<boolean> => {
    const agent = agentsRef.current.find(a => a.key === key);
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
      if (ok) {
        // Refresh to pick up newly installed agent
        await fetchAll();
      }
      return ok;
    } catch {
      return false;
    }
  }, [fetchAll]);

  const value = useMemo<McpContextValue>(() => ({
    status,
    agents,
    skills,
    loading,
    refresh,
    toggleSkill,
    installAgent,
  }), [status, agents, skills, loading, refresh, toggleSkill, installAgent]);

  return <McpContext.Provider value={value}>{children}</McpContext.Provider>;
}
