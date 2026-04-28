'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Settings } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';

/* ── Types ─────────────────────────────────────────────────────── */

interface PortStatus {
  checking: boolean;
  available: boolean | null;
  isSelf: boolean;
  suggestion: number | null;
  invalid?: boolean;
}

interface CheckPortResult {
  available: boolean;
  isSelf?: boolean;
  suggestion?: number | null;
}

const EMPTY_STATUS: PortStatus = { checking: false, available: null, isSelf: false, suggestion: null };

/* ── McpPortSection (compact, inline) ──────────────────────────── */

export default function McpPortSection({ m }: { m: Record<string, any> }) {
  const [origPort, setOrigPort] = useState<number>(0);
  const [port, setPort] = useState<number>(0);
  const [status, setStatus] = useState<PortStatus>(EMPTY_STATUS);
  const [updating, setUpdating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    apiFetch<{ mcpPort?: number }>('/api/settings').then(d => {
      const p = d.mcpPort || 8781;
      setOrigPort(p);
      setPort(p);
    }).catch(() => {});
  }, []);

  useEffect(() => () => { clearTimeout(timerRef.current); clearInterval(pollRef.current); }, []);

  const hasChanges = port !== origPort;
  const portInvalid = port < 1024 || port > 65535;
  const portUnavailable = status.checking || (status.available === false && !status.isSelf);

  const checkPort = useCallback(async (p: number) => {
    if (p < 1024 || p > 65535) {
      setStatus({ ...EMPTY_STATUS, available: false, invalid: true });
      return;
    }
    setStatus({ ...EMPTY_STATUS, checking: true });
    try {
      const res = await apiFetch<CheckPortResult>('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: p }),
      });
      setStatus({
        checking: false,
        available: res.available,
        isSelf: res.isSelf ?? false,
        suggestion: res.suggestion ?? null,
      });
    } catch {
      setStatus(EMPTY_STATUS);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10) || port;
    setPort(v);
    setStatus(EMPTY_STATUS);
    clearTimeout(timerRef.current);
    if (v >= 1024 && v <= 65535) {
      timerRef.current = setTimeout(() => checkPort(v), 500);
    }
  };

  const handleBlur = () => {
    clearTimeout(timerRef.current);
    if (port >= 1024 && port <= 65535) checkPort(port);
  };

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

      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpPort: port }),
      });

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
            setOrigPort(port);
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
            type="number" min={1024} max={65535} value={port}
            onChange={handleChange}
            onBlur={handleBlur}
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
                onClick={() => { setPort(status.suggestion!); setStatus(EMPTY_STATUS); setTimeout(() => checkPort(status.suggestion!), 0); }}
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
