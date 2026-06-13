'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Settings } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import { saveSettingsPatch } from './settings-save';
import { PORT_MAX, PORT_MIN, type CheckPortResult } from './settings-port';
import { useSettingsPort } from './use-settings-port';
import type { SettingsMcpMessages } from './types';

/* ── McpPortSection (compact, inline) ──────────────────────────── */

export default function McpPortSection({ m }: { m: SettingsMcpMessages }) {
  const [updating, setUpdating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const {
    origPort,
    port,
    status,
    setStatus,
    setResolvedPort,
    hasChanges,
    portInvalid,
    portUnavailable,
    handlePortInputChange,
    handlePortInputBlur,
    applySuggestedPort,
  } = useSettingsPort();

  useEffect(() => {
    apiFetch<{ mcpPort?: number }>('/api/settings').then(d => {
      const p = d.mcpPort || 8781;
      setResolvedPort(p);
    }).catch(() => {});
  }, [setResolvedPort]);

  useEffect(() => () => { clearInterval(pollRef.current); }, []);

  const handleUpdate = async () => {
    if (!hasChanges || portInvalid || portUnavailable || updating) return;

    setUpdating(true);
    try {
      const res = await apiFetch<CheckPortResult>('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (!res.available && !res.isSelf) {
        setStatus({ checking: false, available: false, isSelf: false, suggestion: res.suggestion ?? null });
        setUpdating(false);
        toast.error(m.portInUse(port));
        return;
      }

      await saveSettingsPatch({ mcpPort: port });

      try {
        await apiFetch('/api/mcp/restart', { method: 'POST' });
      } catch {
        setUpdating(false);
        toast.error(m.portUpdateFailed);
        return;
      }

      const deadline = Date.now() + 60_000;
      pollRef.current = setInterval(async () => {
        if (Date.now() > deadline) {
          clearInterval(pollRef.current);
          setUpdating(false);
          toast.error(m.portRestartTimeout);
          return;
        }
        try {
          const s = await apiFetch<{ running: boolean; port: number }>('/api/mcp/status', { timeout: 3000 });
          if (s.running) {
            clearInterval(pollRef.current);
            setUpdating(false);
            setResolvedPort(port);
            toast.success(m.portUpdateSuccess);
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch {
      setUpdating(false);
      toast.error(m.portUpdateFailed);
    }
  };

  if (origPort === 0) return null;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Settings size={11} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{m.mcpPortLabel}</span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="number" min={PORT_MIN} max={PORT_MAX} value={port}
            onChange={e => handlePortInputChange(e.target.value)}
            onBlur={handlePortInputBlur}
            className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-border bg-muted/30 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring tabular-nums"
          />
          <button
            type="button"
            onClick={handleUpdate}
            disabled={!hasChanges || portInvalid || portUnavailable || updating}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0
              bg-[var(--amber)] text-[var(--amber-foreground)]
              hover:opacity-90
              disabled:opacity-40 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {updating ? <Loader2 size={12} className="animate-spin" /> : (m.portUpdateBtn)}
          </button>
        </div>

        {/* Status feedback */}
        {status.checking && (
          <p className="text-2xs flex items-center gap-1 text-muted-foreground">
            <Loader2 size={10} className="animate-spin" /> {m.portChecking}
          </p>
        )}
        {!status.checking && status.available === false && !status.invalid && (
          <div className="flex items-center gap-2">
            <p className="text-2xs flex items-center gap-1 text-[var(--amber)]">
              <AlertTriangle size={10} /> {m.portInUse(port)}
            </p>
            {status.suggestion !== null && (
              <button type="button"
                onClick={() => applySuggestedPort(status.suggestion!)}
                className="text-2xs px-1.5 py-0.5 rounded border border-[var(--amber)] text-[var(--amber)] transition-colors hover:bg-[var(--amber-subtle)]"
              >
                {m.portSuggest(status.suggestion)}
              </button>
            )}
          </div>
        )}
        {!status.checking && status.invalid && (
          <p className="text-2xs flex items-center gap-1 text-destructive">
            <AlertTriangle size={10} /> 1024 – 65535
          </p>
        )}
        {!status.checking && status.available === true && (
          <p className="text-2xs flex items-center gap-1 text-success">
            <CheckCircle2 size={10} /> {status.isSelf ? m.portSelf : m.portAvailable}
          </p>
        )}
      </div>
    </div>
  );
}
