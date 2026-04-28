'use client';

import { useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { Field, Input } from '@/components/settings/Primitives';
import type { SetupMessages } from './types';

export interface StepSecurityProps {
  authToken: string;
  onCopy: () => void;
  onGenerate: (seed?: string) => void;
  webPassword: string;
  onPasswordChange: (v: string) => void;
  s: SetupMessages;
}

export default function StepSecurity({
  authToken, onCopy, onGenerate, webPassword, onPasswordChange, s,
}: StepSecurityProps) {
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  return (
    <div className="space-y-5">
      <Field label={s.authToken} hint={s.authTokenHint}>
        <div className="flex gap-2">
          <Input value={authToken} readOnly className="font-mono text-xs" />
          <button onClick={onCopy}
            className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
            style={{ color: 'var(--foreground)' }}>
            <Copy size={14} />
            {s.copyToken}
          </button>
          <button onClick={() => onGenerate()}
            aria-label={s.generateToken}
            className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
            style={{ color: 'var(--foreground)' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </Field>
      <div className="space-y-1.5">
        <button onClick={() => setShowUsage(!showUsage)} className="text-xs underline"
          aria-expanded={showUsage}
          style={{ color: 'var(--muted-foreground)' }}>
          {s.authTokenUsageWhat}
        </button>
        {showUsage && (
          <p className="text-xs leading-relaxed px-3 py-2 rounded-lg"
            style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
            {s.authTokenUsage}
          </p>
        )}
      </div>
      <div>
        <button onClick={() => setShowSeed(!showSeed)} className="text-xs underline"
          aria-expanded={showSeed}
          style={{ color: 'var(--muted-foreground)' }}>
          {s.authTokenSeed}
        </button>
        {showSeed && (
          <div className="mt-2 flex gap-2">
            <Input value={seed} onChange={e => setSeed(e.target.value)} placeholder={s.authTokenSeedHint} />
            <button onClick={() => { if (seed.trim()) onGenerate(seed); }}
              className="px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
              style={{ color: 'var(--foreground)' }}>
              {s.generateToken}
            </button>
          </div>
        )}
      </div>
      <Field label={s.webPassword} hint={s.webPasswordHint}>
        <Input type="password" value={webPassword} onChange={e => onPasswordChange(e.target.value)} placeholder="(optional)" />
      </Field>
    </div>
  );
}
