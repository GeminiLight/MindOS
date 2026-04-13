'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

/* ── Bridge interface ──────────────────────────────────────────────── */

interface MindosDesktopBridge {
  checkUpdate?: () => Promise<{ available: boolean; version?: string }>;
  onUpdateAvailable?: (cb: (info: { version?: string }) => void) => () => void;
  checkCoreUpdate?: () => Promise<{
    available: boolean;
    currentVersion: string;
    latestVersion: string;
  }>;
  onCoreUpdateAvailable?: (
    cb: (info: { current: string; latest: string; ready?: boolean }) => void,
  ) => () => void;
}

function getDesktopBridge(): MindosDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { mindos?: MindosDesktopBridge };
  return w.mindos?.checkUpdate ? (w.mindos as MindosDesktopBridge) : null;
}

/* ── Types ─────────────────────────────────────────────────────────── */

interface PendingUpdate {
  type: 'desktop' | 'core';
  version: string;
}

type ToastVisibility = 'hidden' | 'visible' | 'dismissing';

/* ── Constants ─────────────────────────────────────────────────────── */

const SKIP_DESKTOP_KEY = 'mindos_update_skip_desktop';
const SKIP_CORE_KEY = 'mindos_update_skip_core';
const SHOW_DELAY_MS = 10_000; // Wait 10 s after startup before showing
const DISMISS_MS = 200; // Match the CSS transition duration

/* ── Helpers ───────────────────────────────────────────────────────── */

/** Proper semantic-version comparison: returns true when `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}

/* ── Component ─────────────────────────────────────────────────────── */

/**
 * Desktop-only update notification toast.
 *
 * Appears in the bottom-left corner when the Electron bridge reports a new
 * Desktop shell or MindOS Core update.  Persists until the user clicks
 * "View Details" (→ Settings > Update tab) or "Skip Version" (→ stored in
 * localStorage so it won't re-appear for that version).
 *
 * Renders `null` in browser/CLI mode (no bridge).
 */
export default function UpdateToast() {
  const { t } = useLocale();
  const ut = t.settings.update.updateToast;

  const [visibility, setVisibility] = useState<ToastVisibility>('hidden');
  const [updates, setUpdates] = useState<{
    desktop?: PendingUpdate;
    core?: PendingUpdate;
  }>({});

  // Stable ref for the bridge — avoids re-running the effect every render.
  const bridgeRef = useRef<MindosDesktopBridge | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // Timeout bookkeeping — prevents stale setState after dismiss / unmount.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const queued = useRef<{ desktop?: string; core?: string }>({});

  // ── Timeout helpers ─────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  const schedule = useCallback((state: ToastVisibility, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      setVisibility(state);
    }, ms);
    timers.current.add(id);
  }, []);

  // ── Detect Desktop bridge once on mount ─────────────────────────────

  useEffect(() => {
    const b = getDesktopBridge();
    bridgeRef.current = b;
    setIsDesktop(!!b);
  }, []);

  // ── Subscribe to IPC update events ──────────────────────────────────

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;

    clearTimers();
    const teardowns: Array<() => void> = [];

    // Helper: queue an update unless already queued for this version.
    const enqueue = (
      key: 'desktop' | 'core',
      version: string,
      skipKey: string,
    ) => {
      const skipped = localStorage.getItem(skipKey);
      if (skipped && !isNewer(version, skipped)) return;
      if (queued.current[key] === version) return; // de-dup

      queued.current[key] = version;
      setUpdates(prev => ({ ...prev, [key]: { type: key, version } }));
      schedule('visible', SHOW_DELAY_MS);
    };

    if (bridge.onUpdateAvailable) {
      teardowns.push(
        bridge.onUpdateAvailable(info => {
          if (info?.version) enqueue('desktop', info.version, SKIP_DESKTOP_KEY);
        }),
      );
    }

    if (bridge.onCoreUpdateAvailable) {
      teardowns.push(
        bridge.onCoreUpdateAvailable(info => {
          if (info?.latest && !info.ready) {
            enqueue('core', info.latest, SKIP_CORE_KEY);
          }
        }),
      );
    }

    return () => {
      teardowns.forEach(fn => fn());
      clearTimers();
    };
  }, [isDesktop, clearTimers, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => clearTimers(), [clearTimers]);

  // ── Actions ─────────────────────────────────────────────────────────

  const handleViewDetails = useCallback(() => {
    clearTimers();
    window.dispatchEvent(
      new CustomEvent('mindos:open-settings', { detail: { tab: 'update' } }),
    );
    setVisibility('dismissing');
    schedule('hidden', DISMISS_MS);
  }, [clearTimers, schedule]);

  const handleSkip = useCallback(() => {
    clearTimers();
    if (updates.desktop) localStorage.setItem(SKIP_DESKTOP_KEY, updates.desktop.version);
    if (updates.core) localStorage.setItem(SKIP_CORE_KEY, updates.core.version);
    setVisibility('dismissing');
    schedule('hidden', DISMISS_MS);
  }, [updates, clearTimers, schedule]);

  // ── Render ──────────────────────────────────────────────────────────

  if (!isDesktop || visibility === 'hidden') return null;

  const hasBoth = !!(updates.desktop && updates.core);
  const title = hasBoth
    ? ut.titleMultiple
    : updates.desktop
      ? ut.titleSingle(ut.desktopLabel, updates.desktop.version)
      : updates.core
        ? ut.titleSingle(ut.coreLabel, updates.core.version)
        : '';

  const subtitle = hasBoth
    ? `${ut.desktopLabel} v${updates.desktop!.version} \u00B7 ${ut.coreLabel} v${updates.core!.version}`
    : '';

  const show = visibility === 'visible';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        fixed bottom-14 left-14 z-40 pointer-events-none
        transition-all duration-200
        ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      `}
    >
      <div className="pointer-events-auto flex flex-col gap-2.5 bg-card border border-border rounded-xl shadow-lg px-4 py-3 w-[290px]">
        {/* ── Title row ── */}
        <div className="flex items-start gap-2">
          {/* Amber indicator dot */}
          <span className="mt-[5px] w-2 h-2 rounded-full bg-[var(--amber)] shrink-0" />

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-snug">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
            )}
          </div>

          {/* Close = same as skip */}
          <button
            type="button"
            onClick={handleSkip}
            className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleViewDetails}
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--amber-foreground)] bg-[var(--amber)] hover:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {ut.viewDetails}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="flex-1 px-3 py-1.5 text-xs rounded-lg text-muted-foreground border border-border hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {hasBoth ? ut.skipAll : ut.skipVersion}
          </button>
        </div>
      </div>
    </div>
  );
}
