'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Field, Input } from '@/components/settings/Primitives';
import type { SetupState, PortStatus, SetupMessages } from './types';

// ─── PortField ────────────────────────────────────────────────────────────────
function PortField({
  label, hint, value, onChange, status, onCheckPort, s,
}: {
  label: string; hint: string; value: number;
  onChange: (v: number) => void;
  status: PortStatus;
  onCheckPort: (port: number) => void;
  s: SetupMessages;
}) {
  // Debounce auto-check on input change (500ms)
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
    // Cancel pending debounce — onBlur fires the check immediately
    clearTimeout(timerRef.current);
    onCheckPort(value);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        <Input
          type="number" min={1024} max={65535} value={value}
          onChange={handleChange}
          onBlur={handleBlur}
        />
        {status.checking && (
          <p className="text-xs flex items-center gap-1" role="status" style={{ color: 'var(--muted-foreground)' }}>
            <Loader2 size={11} className="animate-spin" /> {s.portChecking}
          </p>
        )}
        {!status.checking && status.available === false && (
          <div className="flex items-center gap-2" role="alert">
            <p className="text-xs flex items-center gap-1" style={{ color: 'var(--amber)' }}>
              <AlertTriangle size={11} /> {s.portInUse(value)}
            </p>
            {status.suggestion !== null && (
              <button type="button"
                onClick={() => {
                  onChange(status.suggestion!);
                  setTimeout(() => onCheckPort(status.suggestion!), 0);
                }}
                className="text-xs px-2 py-0.5 rounded border transition-colors"
                style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                {s.portSuggest(status.suggestion)}
              </button>
            )}
          </div>
        )}
        {!status.checking && status.available === true && (
          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--success)' }}>
            <CheckCircle2 size={11} /> {status.isSelf ? s.portSelf : s.portAvailable}
          </p>
        )}
      </div>
    </Field>
  );
}

// ─── Step 3: Ports ────────────────────────────────────────────────────────────
export interface StepPortsProps {
  state: SetupState;
  update: <K extends keyof SetupState>(key: K, val: SetupState[K]) => void;
  webPortStatus: PortStatus;
  mcpPortStatus: PortStatus;
  setWebPortStatus: (s: PortStatus) => void;
  setMcpPortStatus: (s: PortStatus) => void;
  checkPort: (port: number, which: 'web' | 'mcp') => void;
  portConflict: boolean;
  s: SetupMessages;
}

export default function StepPorts({
  state, update, webPortStatus, mcpPortStatus, setWebPortStatus, setMcpPortStatus, checkPort, portConflict, s,
}: StepPortsProps) {
  return (
    <div className="space-y-5">
      <PortField
        label={s.webPort} hint={s.portHint} value={state.webPort}
        onChange={v => { update('webPort', v); setWebPortStatus({ checking: false, available: null, isSelf: false, suggestion: null }); }}
        status={webPortStatus}
        onCheckPort={port => checkPort(port, 'web')}
        s={s}
      />
      <PortField
        label={s.mcpPort} hint={s.portHint} value={state.mcpPort}
        onChange={v => { update('mcpPort', v); setMcpPortStatus({ checking: false, available: null, isSelf: false, suggestion: null }); }}
        status={mcpPortStatus}
        onCheckPort={port => checkPort(port, 'mcp')}
        s={s}
      />
      {portConflict && (
        <p className="text-xs flex items-center gap-1.5" role="alert" style={{ color: 'var(--amber)' }}>
          <AlertTriangle size={12} /> {s.portConflict}
        </p>
      )}
      {!portConflict && (webPortStatus.available === null || mcpPortStatus.available === null) && !webPortStatus.checking && !mcpPortStatus.checking && (
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{s.portVerifyHint}</p>
      )}
      <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
        <Info size={12} /> {s.portRestartWarning}
      </p>
    </div>
  );
}
