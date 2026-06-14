'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { getDesktopBridge } from '@/lib/desktop-bridge';
import { useCoreUpdateStore } from '@/lib/stores/core-update-store';

// Constants

const SKIP_DESKTOP_KEY = 'mindos_update_skip_desktop';
const SHOW_DELAY_MS = 10_000;  // Wait 10 s after startup before showing the shell toast
const CORE_AUTODISMISS_MS = 6_000; // Core "ready" nudge is transient
const DISMISS_MS = 200; // Match the CSS transition duration

// Helpers

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

type Visibility = 'hidden' | 'visible' | 'dismissing';

// Component

/**
 * Desktop-only update notifications (bottom-left).
 *
 * Two deliberately different policies (the redesign's direction 1):
 *  - Shell update (rare, needs an app restart): a PERSISTENT toast worth
 *    interrupting for: "View details / Skip version".
 *  - Core update (cheap, service-only): downloads silently via the core store;
 *    we only nudge once it is READY, as a quiet auto-dismissing toast offering
 *    "Apply now". We never toast a Core update that is merely available.
 *
 * Renders `null` in browser/CLI mode (no bridge).
 */
export default function UpdateToast() {
  const { t } = useLocale();
  const ut = t.settings.update.updateToast;
  const u = t.settings.update;

  const [isDesktop, setIsDesktop] = useState(false);
  const bridgeRef = useRef(getDesktopBridge());

  // Core store: drive silent check/download app-wide.
  const corePhase = useCoreUpdateStore((s) => s.phase);
  const coreLatest = useCoreUpdateStore((s) => s.latest);
  const coreInit = useCoreUpdateStore((s) => s.init);
  const applyNow = useCoreUpdateStore((s) => s.applyNow);

  // Shell (electron-updater) toast: persistent.
  const [shell, setShell] = useState<{ version: string } | null>(null);
  const [shellVis, setShellVis] = useState<Visibility>('hidden');

  // Core "ready" toast: transient.
  const [coreVis, setCoreVis] = useState<Visibility>('hidden');
  const [coreDismissed, setCoreDismissed] = useState<string>('');

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
  }, []);

  useEffect(() => {
    const b = getDesktopBridge();
    bridgeRef.current = b;
    setIsDesktop(!!b);
  }, []);

  useEffect(() => { coreInit(); }, [coreInit]);

  // Subscribe to shell availability.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge?.onUpdateAvailable) return;
    const teardown = bridge.onUpdateAvailable((info) => {
      const version = info?.version;
      if (!version) return;
      const skipped = localStorage.getItem(SKIP_DESKTOP_KEY);
      if (skipped && !isNewer(version, skipped)) return;
      setShell({ version });
      after(SHOW_DELAY_MS, () => setShellVis('visible'));
    });
    return () => { teardown?.(); };
  }, [isDesktop, after]);

  // Surface the Core "ready" nudge (transient, auto-dismiss).
  useEffect(() => {
    if (corePhase !== 'ready' || !coreLatest || coreLatest === coreDismissed) return;
    setCoreVis('visible');
    after(CORE_AUTODISMISS_MS, () => setCoreVis('dismissing'));
    after(CORE_AUTODISMISS_MS + DISMISS_MS, () => setCoreVis('hidden'));
  }, [corePhase, coreLatest, coreDismissed, after]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const openSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'update' } }));
  }, []);

  const dismissShell = useCallback((skip: boolean) => {
    if (skip && shell) localStorage.setItem(SKIP_DESKTOP_KEY, shell.version);
    setShellVis('dismissing');
    after(DISMISS_MS, () => setShellVis('hidden'));
  }, [shell, after]);

  const dismissCore = useCallback(() => {
    if (coreLatest) setCoreDismissed(coreLatest);
    setCoreVis('dismissing');
    after(DISMISS_MS, () => setCoreVis('hidden'));
  }, [coreLatest, after]);

  if (!isDesktop) return null;

  // Shell (persistent) takes priority over the transient Core nudge.
  if (shellVis !== 'hidden' && shell) {
    return (
      <ToastShell
        show={shellVis === 'visible'}
        title={u?.shellBannerTitle ? u.shellBannerTitle(shell.version) : `App v${shell.version} available`}
        subtitle={u?.shellBannerDesc ?? 'Requires downloading and restarting the app.'}
        onClose={() => dismissShell(true)}
        primaryLabel={ut.viewDetails}
        onPrimary={() => { openSettings(); dismissShell(false); }}
        secondaryLabel={ut.skipVersion}
        onSecondary={() => dismissShell(true)}
      />
    );
  }

  if (coreVis !== 'hidden' && coreLatest) {
    return (
      <ToastShell
        show={coreVis === 'visible'}
        title={u?.coreReadyToastTitle ? u.coreReadyToastTitle(coreLatest) : `MindOS v${coreLatest} ready`}
        subtitle={u?.coreReadyToastSub ?? 'Applies on next restart'}
        onClose={dismissCore}
        primaryLabel={u?.coreApplyNow ?? 'Apply now'}
        onPrimary={() => { void applyNow(); dismissCore(); }}
        secondaryLabel={u?.later ?? 'Later'}
        onSecondary={dismissCore}
      />
    );
  }

  return null;
}

// Presentational toast box.

function ToastShell(props: {
  show: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-14 left-14 z-40 pointer-events-none transition-all duration-200 ${
        props.show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <div className="pointer-events-auto flex flex-col gap-2.5 bg-card border border-border rounded-xl shadow-lg px-4 py-3 w-[290px]">
        <div className="flex items-start gap-2">
          <span className="mt-[5px] w-2 h-2 rounded-full bg-[var(--amber)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-snug">{props.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{props.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={props.onPrimary}
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--amber-foreground)] bg-[var(--amber)] hover:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {props.primaryLabel}
          </button>
          <button
            type="button"
            onClick={props.onSecondary}
            className="flex-1 px-3 py-1.5 text-xs rounded-lg text-muted-foreground border border-border hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {props.secondaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
