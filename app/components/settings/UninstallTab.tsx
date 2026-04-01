'use client';

import { useState } from 'react';
import { Trash2, AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';
import { SettingCard } from './Primitives';

type Phase = 'idle' | 'confirming' | 'running' | 'success' | 'error';

interface DesktopBridge {
  uninstallApp?: () => Promise<{ ok: boolean; error?: string }>;
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { mindos?: DesktopBridge };
  return w.mindos?.uninstallApp ? (w.mindos as DesktopBridge) : null;
}

export function UninstallTab() {
  const { t } = useLocale();
  const u = t.settings.uninstall;
  const isDesktop = !!getDesktopBridge();

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Checkboxes — "stop services" is always on (not toggleable)
  // CLI mode: stop + config + npm uninstall (npm always runs as part of CLI uninstall)
  // Desktop mode: stop + config + move app to Trash
  const [removeConfig, setRemoveConfig] = useState(true);
  const [removeApp, setRemoveApp] = useState(true); // Desktop only

  const handleUninstall = async () => {
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
          // Desktop will quit after this — show success briefly
          setPhase('success');
          return;
        }
      }

      setPhase('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const Checkbox = ({ checked, onChange, label, desc, disabled }: {
    checked: boolean; onChange: (v: boolean) => void; label: string; desc: string; disabled?: boolean;
  }) => (
    <label className={`flex items-start gap-2.5 p-2.5 rounded bg-muted/30 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/50'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 form-check"
      />
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </label>
  );

  return (
    <SettingCard icon={<Trash2 size={15} />} title={u.title} description={isDesktop ? u.descDesktop : u.descCli}>
      {/* Knowledge base safety note */}
      <div className="flex gap-2.5 p-3 rounded-md bg-muted/50 border border-border">
        <ShieldCheck size={14} className="text-success shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">{u.kbSafe}</p>
      </div>

      {/* Checklist */}
      {phase === 'idle' || phase === 'confirming' ? (
        <div className="space-y-2">
          <Checkbox checked disabled label={u.stopServices} desc={u.stopServicesDesc} onChange={() => {}} />
          <Checkbox checked={removeConfig} onChange={setRemoveConfig} label={u.removeConfig} desc={u.removeConfigDesc} />
          {!isDesktop && (
            <Checkbox checked disabled label={u.removeNpm} desc={u.removeNpmDesc} onChange={() => {}} />
          )}
          {isDesktop && (
            <Checkbox checked={removeApp} onChange={setRemoveApp} label={u.removeApp} desc={u.removeAppDesc} />
          )}
        </div>
      ) : null}

      {/* Action area */}
      {phase === 'idle' && (
        <button
          onClick={() => setPhase('confirming')}
          className="px-3.5 py-2 text-sm font-medium rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={12} className="inline mr-1.5 -mt-px" />
          {u.confirmButton}
        </button>
      )}

      {phase === 'confirming' && (
        <div className="p-3 rounded-md border border-error/30 bg-error/5 space-y-2.5">
          <p className="text-xs font-medium text-error">{u.confirmTitle}</p>
          <div className="flex gap-2">
            <button
              onClick={handleUninstall}
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-error text-white hover:bg-error/90 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
            >
              {u.confirmButton}
            </button>
            <button
              onClick={() => setPhase('idle')}
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
            >
              {u.cancelButton}
            </button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="flex items-center gap-2 py-2">
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{u.running}</span>
        </div>
      )}

      {phase === 'success' && (
        <div className="flex items-center gap-2 py-2">
          <CheckCircle2 size={14} className="text-success" />
          <span className="text-xs text-success font-medium">
            {isDesktop && removeApp ? u.successDesktop : u.success}
          </span>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-error" />
            <span className="text-xs text-error font-medium">{u.error}</span>
          </div>
          {errorMsg && <p className="text-[11px] text-muted-foreground font-mono">{errorMsg}</p>}
          <button
            onClick={() => setPhase('idle')}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
          >
            {u.cancelButton}
          </button>
        </div>
      )}
    </SettingCard>
  );
}
