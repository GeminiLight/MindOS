'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Monitor, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import { SettingCard } from './Primitives';

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

/* ── WebPortSection ────────────────────────────────────────────── */

export default function WebPortSection({ m }: { m: Record<string, any> }) {
  const [origPort, setOrigPort] = useState<number>(0);
  const [port, setPort] = useState<number>(0);
  const [status, setStatus] = useState<PortStatus>(EMPTY_STATUS);
  const [updating, setUpdating] = useState(false);
  const [overlayMsg, setOverlayMsg] = useState<string | null>(null);
  const [overlaySub, setOverlaySub] = useState<string | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    apiFetch<{ port?: number }>('/api/settings').then(d => {
      const p = d.port || 3456;
      setOrigPort(p);
      setPort(p);
    }).catch(() => {});
  }, []);

  useEffect(() => () => { clearInterval(pollRef.current); clearTimeout(timerRef.current); }, []);

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

  const handleUpdate = async () => {
    if (!hasChanges || portInvalid || portUnavailable || updating) return;

    setUpdating(true);
    try {
      // Final availability check
      const res = await apiFetch<CheckPortResult>('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (!res.available && !res.isSelf) {
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

      // Save port
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });

      // Full restart — Web port changed
      setOverlayMsg(m.portWebRestarting);
      setOverlaySub(m.portRedirecting);

      try {
        await apiFetch('/api/restart', { method: 'POST' });
      } catch {
        // Expected: server dies before response completes
      }

      // Poll new port for health
      const newOrigin = `${window.location.protocol}//${window.location.hostname}:${port}`;
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
          const r = await fetch(`${newOrigin}/api/health`, { signal: AbortSignal.timeout(2000) });
          if (r.ok) {
            clearInterval(pollRef.current);
            window.location.href = newOrigin;
          }
        } catch {
          // Server not up yet
        }
      }, 1500);
    } catch {
      setUpdating(false);
      toast.error(m.portUpdateFailed);
    }
  };

  if (origPort === 0) return null;

  return (
    <>
      <SettingCard
        icon={<Monitor size={15} />}
        title={m.webPortLabel}
        description={m.webPortHint}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number" min={1024} max={65535} value={port}
              onChange={e => {
                const v = parseInt(e.target.value, 10) || port;
                setPort(v);
                setStatus(EMPTY_STATUS);
                clearTimeout(timerRef.current);
                if (v >= 1024 && v <= 65535) {
                  timerRef.current = setTimeout(() => checkPort(v), 500);
                }
              }}
              onBlur={() => {
                clearTimeout(timerRef.current);
                if (port >= 1024 && port <= 65535) checkPort(port);
              }}
              className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-border bg-muted/30 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring tabular-nums"
            />
            <button
              type="button"
              onClick={handleUpdate}
              disabled={!hasChanges || portInvalid || portUnavailable || updating}
              className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors
                bg-[var(--amber)] text-[var(--amber-foreground)]
                hover:opacity-90
                disabled:opacity-40 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {updating ? m.portUpdating : m.portUpdateBtn}
            </button>
          </div>

          {/* Port status feedback */}
          {status.checking && (
            <p className="text-xs flex items-center gap-1 text-muted-foreground">
              <Loader2 size={11} className="animate-spin" /> {m.portChecking}
            </p>
          )}
          {!status.checking && status.available === false && !status.invalid && (
            <div className="flex items-center gap-2">
              <p className="text-xs flex items-center gap-1 text-[var(--amber)]">
                <AlertTriangle size={11} /> {m.portInUse(port)}
              </p>
              {status.suggestion !== null && (
                <button type="button"
                  onClick={() => { setPort(status.suggestion!); setStatus(EMPTY_STATUS); setTimeout(() => checkPort(status.suggestion!), 0); }}
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
      </SettingCard>

      {overlayMsg && <RestartOverlay message={overlayMsg} sub={overlaySub} />}
    </>
  );
}
