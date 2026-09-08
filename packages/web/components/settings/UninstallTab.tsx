'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Trash2, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import { SettingCard } from './Primitives';

type Phase = 'idle' | 'confirming' | 'running' | 'started' | 'error';

interface DesktopBridge {
  uninstallApp?: () => Promise<{ ok: boolean; error?: string }>;
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { mindos?: DesktopBridge };
  return w.mindos?.uninstallApp ? (w.mindos as DesktopBridge) : null;
}

// Keep the component identity stable so changing an option does not remount
// its input and discard keyboard focus.
function UninstallOption({ checked, onChange, label, desc, disabled, requiredLabel }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; desc: string; disabled?: boolean; requiredLabel?: string;
}) {
  return (
    <label className={`flex min-h-11 items-start gap-2.5 rounded p-2.5 select-none ${disabled ? 'cursor-default' : 'cursor-pointer bg-muted/30 hover:bg-muted/50'}`}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} className="mt-0.5 form-check" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {requiredLabel && <p className="text-xs text-muted-foreground">{requiredLabel}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </label>
  );
}

export function UninstallTab() {
  const { t } = useLocale();
  const u = t.settings.uninstall;
  const isDesktop = !!getDesktopBridge();

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const uninstallInFlightRef = useRef(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef<Phase>('idle');
  const confirmationId = useId();

  useEffect(() => {
    if (phase === 'confirming') cancelRef.current?.focus();
    if (phase === 'idle' && previousPhase.current !== 'idle') startRef.current?.focus();
    previousPhase.current = phase;
  }, [phase]);

  // Checkboxes — "stop services" is always on (not toggleable)
  // CLI mode: stop + config + npm uninstall (npm always runs as part of CLI uninstall)
  // Desktop mode: stop + config + move app to Trash
  const [removeConfig, setRemoveConfig] = useState(false);
  const [removeApp, setRemoveApp] = useState(true); // Desktop only

  const handleUninstall = async () => {
    if (uninstallInFlightRef.current) return;
    uninstallInFlightRef.current = true;
    setPhase('running');
    setErrorMsg('');
    try {
      // Step 1: Server-side cleanup (stop services, daemon, config, npm)
      await apiFetch('/api/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeConfig }),
      });

      // Step 2: Desktop self-deletion (if selected)
      if (isDesktop && removeApp) {
        const bridge = getDesktopBridge();
        if (bridge?.uninstallApp) {
          const result = await bridge.uninstallApp();
          if (!result.ok) throw new Error(result.error || 'Failed to remove app');
          // The server acknowledges a detached cleanup, not verified completion.
          setPhase('started');
          return;
        }
      }

      setPhase('started');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      uninstallInFlightRef.current = false;
    }
  };

  return (
    <div onKeyDown={event => {
      if (phase === 'confirming' && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setPhase('idle');
      }
    }}>
    <SettingCard icon={<Trash2 size={15} />} title={u.title} description={isDesktop ? u.descDesktop : u.descCli}>
      {/* Make configuration cleanup's scope visible before opting into it. */}
      <div className="flex gap-2.5 p-3 rounded-md bg-muted/50 border border-border">
        <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">{u.kbSafe}</p>
      </div>

      {/* Checklist */}
      {phase === 'idle' || phase === 'confirming' ? (
        <div className="space-y-2">
          <UninstallOption checked disabled requiredLabel={u.requiredLabel} label={u.stopServices} desc={u.stopServicesDesc} onChange={() => {}} />
          <UninstallOption checked={removeConfig} onChange={setRemoveConfig} label={u.removeConfig} desc={u.removeConfigDesc} />
          {!isDesktop && (
            <UninstallOption checked disabled requiredLabel={u.requiredLabel} label={u.removeNpm} desc={u.removeNpmDesc} onChange={() => {}} />
          )}
          {isDesktop && (
            <UninstallOption checked={removeApp} onChange={setRemoveApp} label={u.removeApp} desc={u.removeAppDesc} />
          )}
        </div>
      ) : null}

      {/* Action area */}
      {phase === 'idle' && (
        <button
          ref={startRef}
          onClick={() => setPhase('confirming')}
          className="min-h-11 px-3.5 py-2 text-sm font-medium rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={12} className="inline mr-1.5 -mt-px" />
          {u.confirmButton}
        </button>
      )}

      {phase === 'confirming' && (
        <div role="group" aria-labelledby={confirmationId} className="p-3 rounded-md border border-error/30 bg-error/5 space-y-2.5">
          <p id={confirmationId} className="text-xs font-medium text-error">{u.confirmTitle}</p>
          <div className="flex gap-2">
            <button
              onClick={handleUninstall}
              disabled={uninstallInFlightRef.current}
              className="min-h-11 px-3.5 py-2 text-sm font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            >
              {u.confirmButton}
            </button>
            <button
              ref={cancelRef}
              onClick={() => setPhase('idle')}
              className="min-h-11 px-3.5 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            >
              {u.cancelButton}
            </button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div role="status" className="flex items-center gap-2 py-2">
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{u.running}</span>
        </div>
      )}

      {phase === 'started' && (
        <div role="status" className="flex items-center gap-2 py-2">
          <Info size={14} className="shrink-0 text-muted-foreground" />
          <span className="text-xs leading-relaxed text-foreground">
            {isDesktop && removeApp ? u.successDesktop : u.success}
          </span>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-2">
          <div role="alert" className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-error" />
            <span className="text-xs text-error font-medium">{u.error}</span>
          </div>
          {errorMsg && <p className="text-[11px] text-muted-foreground font-mono">{errorMsg}</p>}
          <button
            onClick={() => setPhase('idle')}
            className="min-h-11 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          >
            {u.reviewOptions}
          </button>
        </div>
      )}
    </SettingCard>
    </div>
  );
}
