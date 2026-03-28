'use client';

import { useState } from 'react';
import { Trash2, AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';

type Phase = 'idle' | 'confirming' | 'running' | 'success' | 'error';

export function UninstallTab() {
  const { t } = useLocale();
  const u = t.settings.uninstall;
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleUninstall = async () => {
    setPhase('running');
    setErrorMsg('');
    try {
      await apiFetch('/api/uninstall', { method: 'POST' });
      setPhase('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Trash2 size={14} className="text-muted-foreground" />
          {u.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{u.desc}</p>
      </div>

      {/* Warning banner */}
      <div className="flex gap-2.5 p-3 rounded-md bg-error/5 border border-error/20">
        <AlertTriangle size={14} className="text-error shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/80 leading-relaxed">{u.warning}</p>
      </div>

      {/* Knowledge base safety note */}
      <div className="flex gap-2.5 p-3 rounded-md bg-muted/50 border border-border">
        <ShieldCheck size={14} className="text-success shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">{u.kbSafe}</p>
      </div>

      {/* What will be removed */}
      <div className="space-y-2">
        <div className="flex items-start gap-2.5 p-2.5 rounded bg-muted/30">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-foreground">{u.stopServices}</p>
            <p className="text-[11px] text-muted-foreground">{u.stopServicesDesc}</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-2.5 rounded bg-muted/30">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-foreground">{u.removeConfig}</p>
            <p className="text-[11px] text-muted-foreground">{u.removeConfigDesc}</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-2.5 rounded bg-muted/30">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-foreground">{u.removeNpm}</p>
            <p className="text-[11px] text-muted-foreground">{u.removeNpmDesc}</p>
          </div>
        </div>
      </div>

      {/* Action area */}
      {phase === 'idle' && (
        <button
          onClick={() => setPhase('confirming')}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Trash2 size={12} className="inline mr-1.5 -mt-px" />
          {u.confirmButton}
        </button>
      )}

      {phase === 'confirming' && (
        <div className="p-3 rounded-md border border-error/30 bg-error/5 space-y-2.5">
          <p className="text-xs font-medium text-error">{u.confirmTitle}</p>
          <p className="text-xs text-foreground/70">{u.confirmMessage}</p>
          <div className="flex gap-2">
            <button
              onClick={handleUninstall}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-error text-white hover:bg-error/90 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
            >
              {u.confirmButton}
            </button>
            <button
              onClick={() => setPhase('idle')}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
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
          <span className="text-xs text-success font-medium">{u.success}</span>
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
    </div>
  );
}
