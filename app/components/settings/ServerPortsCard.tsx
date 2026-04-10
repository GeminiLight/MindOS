'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Monitor, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
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

/* ── PortField ─────────────────────────────────────────────────── */

function PortField({
  label, hint, value, onChange, status, onCheckPort, m,
}: {
  label: string; hint: string; value: number;
  onChange: (v: number) => void;
  status: PortStatus;
  onCheckPort: (port: number) => void;
  m: Record<string, any>;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10) || value;
    onChange(v);
    clearTimeout(timerRef.current);
    if (v >= 1024 && v <= 65535) {
      timerRef.current = setTimeout(() => onCheckPort(v), 500);
    }
  };
  const handleBlur = () => {
    clearTimeout(timerRef.current);
    if (value >= 1024 && value <= 65535) onCheckPort(value);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <p className="text-2xs text-muted-foreground">{hint}</p>
      <input
        type="number" min={1024} max={65535} value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-muted/30 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring tabular-nums"
      />
      {status.checking && (
        <p className="text-xs flex items-center gap-1 text-muted-foreground">
          <Loader2 size={11} className="animate-spin" /> {m.portChecking}
        </p>
      )}
      {!status.checking && status.available === false && !status.invalid && (
        <div className="flex items-center gap-2">
          <p className="text-xs flex items-center gap-1 text-[var(--amber)]">
            <AlertTriangle size={11} /> {m.portInUse(value)}
          </p>
          {status.suggestion !== null && (
            <button type="button"
              onClick={() => { onChange(status.suggestion!); setTimeout(() => onCheckPort(status.suggestion!), 0); }}
              className="text-xs px-2 py-0.5 rounded border border-[var(--amber)] text-[var(--amber)] transition-colors hover:bg-[var(--amber-subtle)]"
            >
              {m.portSuggest(status.suggestion)}
            </button>
          )}
        </div>
      )}
      {!status.checking && status.invalid && (
        <p className="text-xs flex items-center gap-1 text-destructive">
          <AlertTriangle size={11} /> 1024 – 65535
        </p>
      )}
      {!status.checking && status.available === true && (
        <p className="text-xs flex items-center gap-1 text-success">
          <CheckCircle2 size={11} /> {status.isSelf ? m.portSelf : m.portAvailable}
        </p>
      )}
    </div>
  );
}

/* ── Full-screen restart overlay ───────────────────────────────── */

function RestartOverlay({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="text-center space-y-4 max-w-sm px-6">
        <Loader2 size={32} className="animate-spin mx-auto text-[var(--amber)]" />
        <p className="text-sm font-medium text-foreground">{message}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

/* ── ServerPortsCard ───────────────────────────────────────────── */

export default function ServerPortsCard({ m }: { m: Record<string, any> }) {
  // Loaded from /api/settings
  const [origWebPort, setOrigWebPort] = useState<number>(0);
  const [origMcpPort, setOrigMcpPort] = useState<number>(0);

  const [webPort, setWebPort] = useState<number>(0);
  const [mcpPort, setMcpPort] = useState<number>(0);

  const [webStatus, setWebStatus] = useState<PortStatus>(EMPTY_STATUS);
  const [mcpStatus, setMcpStatus] = useState<PortStatus>(EMPTY_STATUS);

  const [updating, setUpdating] = useState(false);
  const [overlayMsg, setOverlayMsg] = useState<string | null>(null);
  const [overlaySub, setOverlaySub] = useState<string | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Load current ports from API
  useEffect(() => {
    apiFetch<{ port?: number; mcpPort?: number }>('/api/settings').then(d => {
      const wp = d.port || 3456;
      const mp = d.mcpPort || 8781;
      setOrigWebPort(wp); setWebPort(wp);
      setOrigMcpPort(mp); setMcpPort(mp);
    }).catch(() => {});
  }, []);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const hasChanges = webPort !== origWebPort || mcpPort !== origMcpPort;
  const portConflict = webPort === mcpPort && webPort > 0;
  const portInvalid = webPort < 1024 || webPort > 65535 || mcpPort < 1024 || mcpPort > 65535;
  const webChanged = webPort !== origWebPort;
  const mcpChanged = mcpPort !== origMcpPort;

  // Port check via existing API
  const checkPort = useCallback(async (port: number, which: 'web' | 'mcp') => {
    const setStatus = which === 'web' ? setWebStatus : setMcpStatus;
    if (port < 1024 || port > 65535) {
      setStatus({ ...EMPTY_STATUS, available: false, invalid: true });
      return;
    }
    setStatus({ ...EMPTY_STATUS, checking: true });
    try {
      const res = await apiFetch<CheckPortResult>('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
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

  // Update handler
  const handleUpdate = async () => {
    if (!hasChanges || portConflict || portInvalid || updating) return;

    setUpdating(true);
    try {
      // 0. Final port availability check before committing
      //    User may have waited a while since input — port state could have changed.
      const portsToCheck: Array<{ port: number; which: 'web' | 'mcp' }> = [];
      if (webChanged) portsToCheck.push({ port: webPort, which: 'web' });
      if (mcpChanged) portsToCheck.push({ port: mcpPort, which: 'mcp' });

      for (const { port, which } of portsToCheck) {
        const res = await apiFetch<CheckPortResult>('/api/setup/check-port', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port }),
        });
        if (!res.available && !res.isSelf) {
          // Port became occupied since last check
          const setStatus = which === 'web' ? setWebStatus : setMcpStatus;
          setStatus({
            checking: false,
            available: false,
            isSelf: false,
            suggestion: res.suggestion ?? null,
          });
          setUpdating(false);
          toast.error(m.portInUse(port));
          return;
        }
      }

      // 1. Save both ports to config
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: webPort,
          mcpPort,
        }),
      });

      // 2. Determine restart strategy
      if (webChanged) {
        // Full restart needed — Web port changed
        setOverlayMsg(m.portWebRestarting);
        setOverlaySub(m.portRedirecting);

        try {
          await apiFetch('/api/restart', { method: 'POST' });
        } catch {
          // Expected: server dies before response completes
        }

        // Poll new port for health
        const newOrigin = `${window.location.protocol}//${window.location.hostname}:${webPort}`;
        const deadline = Date.now() + 30_000;
        pollRef.current = setInterval(async () => {
          if (Date.now() > deadline) {
            clearInterval(pollRef.current);
            setOverlayMsg(null);
            setUpdating(false);
            toast.error(m.portRestartTimeout);
            return;
          }
          try {
            const res = await fetch(`${newOrigin}/api/health`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
              clearInterval(pollRef.current);
              // Redirect to new port
              window.location.href = newOrigin;
            }
          } catch {
            // Server not up yet, keep polling
          }
        }, 1500);
      } else if (mcpChanged) {
        // MCP-only restart
        setOverlayMsg(m.portMcpRestarting);
        try {
          await apiFetch('/api/mcp/restart', { method: 'POST' });
        } catch {
          setOverlayMsg(null);
          setUpdating(false);
          toast.error(m.portUpdateFailed);
          return;
        }

        // Poll MCP status
        const deadline = Date.now() + 60_000;
        pollRef.current = setInterval(async () => {
          if (Date.now() > deadline) {
            clearInterval(pollRef.current);
            setOverlayMsg(null);
            setUpdating(false);
            toast.error(m.portRestartTimeout);
            return;
          }
          try {
            const s = await apiFetch<{ running: boolean; port: number }>('/api/mcp/status', { timeout: 3000 });
            if (s.running) {
              clearInterval(pollRef.current);
              setOverlayMsg(null);
              setUpdating(false);
              setOrigMcpPort(mcpPort);
              toast.success(m.portUpdateSuccess);
            }
          } catch {
            // keep polling
          }
        }, 3000);
      } else {
        // No restart needed (shouldn't reach here, but guard)
        setUpdating(false);
        toast.success(m.portUpdateSuccess);
      }
    } catch {
      setUpdating(false);
      toast.error(m.portUpdateFailed);
    }
  };

  // Don't render until data loaded
  if (origWebPort === 0) return null;

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Monitor size={14} className="text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{m.portsCardTitle}</h3>
            <p className="text-2xs text-muted-foreground">{m.portsCardDesc}</p>
          </div>
        </div>
        <div className="px-4 pb-4 space-y-4">
          <PortField
            label={m.webPortLabel} hint={m.webPortHint}
            value={webPort} onChange={v => { setWebPort(v); setWebStatus(EMPTY_STATUS); }}
            status={webStatus} onCheckPort={p => checkPort(p, 'web')} m={m}
          />
          <PortField
            label={m.mcpPortLabel} hint={m.mcpPortHint}
            value={mcpPort} onChange={v => { setMcpPort(v); setMcpStatus(EMPTY_STATUS); }}
            status={mcpStatus} onCheckPort={p => checkPort(p, 'mcp')} m={m}
          />

          {/* Conflict warning */}
          {portConflict && (
            <p className="text-xs flex items-center gap-1.5 text-[var(--amber)]">
              <AlertTriangle size={12} /> {m.portConflict}
            </p>
          )}

          {/* Update button */}
          <button
            type="button"
            onClick={handleUpdate}
            disabled={!hasChanges || portConflict || portInvalid || updating}
            className="w-full py-2 rounded-lg text-xs font-medium transition-colors
              bg-[var(--amber)] text-[var(--amber-foreground)]
              hover:opacity-90
              disabled:opacity-40 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {updating ? m.portUpdating : m.portUpdateBtn}
          </button>
        </div>
      </div>

      {/* Full-screen restart overlay */}
      {overlayMsg && <RestartOverlay message={overlayMsg} sub={overlaySub} />}
    </>
  );
}
