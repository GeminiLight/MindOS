'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Copy, Check, RefreshCw, Trash2, Sparkles } from 'lucide-react';
import type { SettingsData } from './types';
import { Field, Input, EnvBadge, SectionLabel } from './Primitives';
import { apiFetch } from '@/lib/api';

interface KnowledgeTabProps {
  data: SettingsData;
  setData: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  t: any;
}

export function KnowledgeTab({ data, setData, t }: KnowledgeTabProps) {
  const env = data.envOverrides ?? {};
  const k = t.settings.knowledge;

  // Guide state toggle
  const [guideActive, setGuideActive] = useState<boolean | null>(null);
  const [guideDismissed, setGuideDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(d => {
        const gs = d.guideState;
        if (gs) {
          setGuideActive(gs.active);
          setGuideDismissed(!!gs.dismissed);
        }
      })
      .catch(() => {});
  }, []);

  const handleGuideToggle = useCallback(() => {
    const newDismissed = !guideDismissed;
    setGuideDismissed(newDismissed);
    // If re-enabling, also ensure active is true
    const patch: Record<string, boolean> = { dismissed: newDismissed };
    if (!newDismissed) patch.active = true;
    fetch('/api/setup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guideState: patch }),
    })
      .then(() => window.dispatchEvent(new Event('guide-state-updated')))
      .catch(() => setGuideDismissed(!newDismissed)); // rollback on failure
  }, [guideDismissed]);

  const origin = useSyncExternalStore(
    () => () => {},
    () => `${window.location.protocol}//${window.location.hostname}`,
    () => 'http://localhost',
  );

  const [showPassword, setShowPassword] = useState(false);
  const isPasswordMasked = data.webPassword === '***set***';

  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  // revealed holds the plaintext token after regenerate, until user navigates away
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const hasToken = !!(data.authToken);
  const displayToken = revealedToken ?? data.authToken ?? '';

  async function handleResetToken() {
    if (!confirm(k.authTokenResetConfirm)) return;
    setResetting(true);
    try {
      const res = await apiFetch<{ ok: boolean; token: string }>('/api/settings/reset-token', { method: 'POST' });
      setRevealedToken(res.token);
      setData(d => d ? { ...d, authToken: res.token } : d);
    } finally {
      setResetting(false);
    }
  }

  async function handleClearToken() {
    setData(d => d ? { ...d, authToken: '' } : d);
    setRevealedToken(null);
  }

  function handleCopy() {
    const text = revealedToken ?? data.authToken ?? '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-5">
      <SectionLabel>Knowledge Base</SectionLabel>

      <Field
        label={<>{k.sopRoot} <EnvBadge overridden={env.MIND_ROOT} /></>}
        hint={env.MIND_ROOT ? k.envNote : k.sopRootHint}
      >
        <Input
          value={data.mindRoot}
          onChange={e => setData(d => d ? { ...d, mindRoot: e.target.value } : d)}
          placeholder="/path/to/your/notes"
        />
      </Field>

      <div className="border-t border-border pt-5">
        <SectionLabel>Security</SectionLabel>
      </div>

      <Field label={k.webPassword} hint={k.webPasswordHint}>
        <div className="flex gap-2">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={isPasswordMasked ? '••••••••' : (data.webPassword ?? '')}
            onChange={e => setData(d => d ? { ...d, webPassword: e.target.value } : d)}
            onFocus={() => { if (isPasswordMasked) setData(d => d ? { ...d, webPassword: '' } : d); }}
            placeholder="Leave empty to disable"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="px-3 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <Field
        label={k.authToken}
        hint={hasToken ? k.authTokenHint : k.authTokenNone}
      >
        <div className="space-y-2">
          {/* Token display */}
          <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg min-h-[38px]">
            <code className="flex-1 text-xs font-mono text-foreground break-all select-all">
              {displayToken || <span className="text-muted-foreground italic">— not set —</span>}
            </code>
            {displayToken && (
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title={k.authTokenCopy}
              >
                {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              </button>
            )}
          </div>
          {/* MCP port info */}
          {data.mcpPort && (
            <p className="text-xs text-muted-foreground">
              {k.authTokenMcpPort}: <code className="font-mono">{data.mcpPort}</code>
              {displayToken && (
                <> &nbsp;·&nbsp; MCP URL: <code className="font-mono select-all">
                  {`${origin}:${data.mcpPort}/mcp`}
                </code></>
              )}
            </p>
          )}
          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleResetToken}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={12} className={resetting ? 'animate-spin' : ''} />
              {k.authTokenReset}
            </button>
            {hasToken && (
              <button
                type="button"
                onClick={handleClearToken}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
              >
                <Trash2 size={12} />
                {k.authTokenClear}
              </button>
            )}
          </div>
          {revealedToken && (
            <p className="text-xs text-amber-500">
              New token generated. Copy it now — it won&apos;t be shown in full again.
            </p>
          )}
        </div>
      </Field>

      {/* Getting Started Guide toggle */}
      {guideActive !== null && (
        <div className="border-t border-border pt-5">
          <SectionLabel>{t.guide?.title ?? 'Getting Started'}</SectionLabel>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Sparkles size={14} style={{ color: 'var(--amber)' }} />
              <div>
                <div className="text-sm text-foreground">{t.guide?.showGuide ?? 'Show getting started guide'}</div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!guideDismissed}
              onClick={handleGuideToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                !guideDismissed ? 'bg-amber-500' : 'bg-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  !guideDismissed ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
