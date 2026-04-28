'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronDown, ChevronRight, Wrench, Zap, Shield } from 'lucide-react';
import { toast } from '@/lib/toast';
import { apiFetch } from '@/lib/api';

interface ToolInfo {
  name: string;
  description: string;
}

interface ServerInfo {
  name: string;
  toolCount: number;
  tools: ToolInfo[];
  directTools: boolean | string[] | false;
  lifecycle: string;
  cached: boolean;
}

type DirectMode = 'proxy' | 'all' | 'select';

function getMode(dt: boolean | string[] | false): DirectMode {
  if (dt === true) return 'all';
  if (Array.isArray(dt) && dt.length > 0) return 'select';
  return 'proxy';
}

function getSelectedTools(dt: boolean | string[] | false): Set<string> {
  if (Array.isArray(dt)) return new Set(dt);
  return new Set();
}

export default function McpExternalTools() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchTools = useCallback(async () => {
    try {
      const data = await apiFetch<{ servers: ServerInfo[] }>('/api/mcp/tools');
      setServers(data.servers);
    } catch {
      // No MCP config or servers — show empty state
      setServers([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const handleModeChange = async (serverName: string, mode: DirectMode, selected?: string[]) => {
    setSaving(serverName);
    try {
      const directTools = mode === 'all' ? true : mode === 'select' ? (selected ?? []) : false;
      await apiFetch('/api/mcp/direct-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverName, directTools }),
      });
      setServers((prev) =>
        prev.map((s) => s.name === serverName ? { ...s, directTools } : s),
      );
      toast.success('Saved');
    } catch {
      toast.error('Failed to save');
    }
    setSaving(null);
  };

  const handleToggleTool = async (serverName: string, toolName: string, checked: boolean) => {
    const server = servers.find((s) => s.name === serverName);
    if (!server) return;
    const current = getSelectedTools(server.directTools);
    if (checked) current.add(toolName); else current.delete(toolName);
    const selected = [...current];
    await handleModeChange(serverName, selected.length > 0 ? 'select' : 'proxy', selected);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="px-1 py-3">
        <p className="text-xs text-muted-foreground">
          No external MCP servers configured. Add servers to <code className="text-2xs bg-muted px-1 py-0.5 rounded">~/.mindos/mcp.json</code> to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {servers.map((server) => {
        const mode = getMode(server.directTools);
        const selected = getSelectedTools(server.directTools);
        const isExpanded = expanded === server.name;
        const isSaving = saving === server.name;

        return (
          <div key={server.name} className="border border-border rounded-lg overflow-hidden">
            {/* Server header */}
            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : server.name)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
            >
              {isExpanded
                ? <ChevronDown size={12} className="text-muted-foreground shrink-0" />
                : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
              <span className="text-xs font-semibold text-foreground truncate">{server.name}</span>
              <span className="text-2xs text-muted-foreground">
                {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
              </span>
              <div className="flex-1" />
              <ModeBadge mode={mode} count={selected.size} />
              {isSaving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
            </button>

            {/* Expanded panel */}
            {isExpanded && (
              <div className="border-t border-border bg-muted/10 px-3 py-2.5 space-y-2.5">
                {/* Mode selector */}
                <div className="flex items-center gap-1.5">
                  <ModeButton
                    active={mode === 'proxy'}
                    onClick={() => handleModeChange(server.name, 'proxy')}
                    icon={<Shield size={11} />}
                    label="Proxy only"
                  />
                  <ModeButton
                    active={mode === 'all'}
                    onClick={() => handleModeChange(server.name, 'all')}
                    icon={<Zap size={11} />}
                    label="All direct"
                  />
                  <ModeButton
                    active={mode === 'select'}
                    onClick={() => {
                      if (mode !== 'select') {
                        handleModeChange(server.name, 'select', []);
                      }
                    }}
                    icon={<Wrench size={11} />}
                    label="Select"
                  />
                </div>

                {/* Tool list (shown for 'select' mode or expanded) */}
                {server.tools.length > 0 && (mode === 'select' || mode === 'all') && (
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {server.tools.map((tool) => {
                      const isChecked = mode === 'all' || selected.has(tool.name);
                      return (
                        <label
                          key={tool.name}
                          className="flex items-start gap-2 px-2 py-1 rounded hover:bg-muted/30 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={mode === 'all'}
                            onChange={(e) => handleToggleTool(server.name, tool.name, e.target.checked)}
                            className="mt-0.5 w-3 h-3 rounded accent-[var(--amber)] cursor-pointer"
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-mono text-foreground">{tool.name}</span>
                            {tool.description && (
                              <p className="text-2xs text-muted-foreground line-clamp-1">{tool.description}</p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* No cached tools hint */}
                {!server.cached && (
                  <p className="text-2xs text-muted-foreground italic">
                    Tool list not yet cached. Tools will appear after the first connection.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Info text */}
      <p className="text-2xs text-muted-foreground px-1 pt-1 leading-relaxed">
        <strong>Direct</strong> tools (~150 tokens each) can be called directly by the agent.{' '}
        <strong>Proxy</strong> tools (~200 tokens total) require <code className="text-2xs bg-muted px-0.5 rounded">mcp(&#123;search/call&#125;)</code> but save context.{' '}
        Changes take effect on the next agent session.
      </p>
    </div>
  );
}

/* ── Sub-components ── */

function ModeBadge({ mode, count }: { mode: DirectMode; count: number }) {
  if (mode === 'all') {
    return (
      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium leading-none">
        All direct
      </span>
    );
  }
  if (mode === 'select' && count > 0) {
    return (
      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium leading-none">
        {count} direct
      </span>
    );
  }
  return (
    <span className="text-2xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium leading-none">
      Proxy only
    </span>
  );
}

function ModeButton({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-medium transition-colors ${
        active
          ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)] border border-[var(--amber)]/30'
          : 'bg-muted/50 text-muted-foreground border border-border/50 hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
