import { useState } from 'react';
import Link from 'next/link';
import { Loader2, ExternalLink } from 'lucide-react';
import { SectionCard, StatusDot, ActionResult } from './shared';
import { Select } from '@/components/settings/Primitives';

export function ChannelConversation({ status, im, platform, onSaved }: {
  status: { state: string; transport?: string; webhookUrl?: string; publicBaseUrl?: string; lastError?: string } | undefined;
  im: Record<string, any>;
  platform: { guideUrl?: string };
  onSaved: () => void;
}) {
  const currentTransport = status?.transport ?? 'webhook';
  const isLongConnection = currentTransport === 'long_connection';

  const [enabled, setEnabled] = useState(status?.state !== 'disabled');
  const [transport, setTransport] = useState<'webhook' | 'long_connection'>(currentTransport as any);
  const [encryptKey, setEncryptKey] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState(status?.publicBaseUrl ?? '');
  const [allowMentions, setAllowMentions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const isLC = transport === 'long_connection';
  const stateReady = status?.state === 'ready';

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/im/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'feishu',
          conversation: {
            enabled,
            transport,
            encrypt_key: encryptKey.trim() || undefined,
            verification_token: verificationToken.trim() || undefined,
            public_base_url: isLC ? undefined : (publicBaseUrl || undefined),
            allow_group_mentions: allowMentions,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ ok: true, msg: im.conversationSaved });
        setEncryptKey('');
        setVerificationToken('');
        onSaved();
      } else {
        setResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : (im.networkError ?? 'Network error') });
    }
    setSaving(false);
  };

  return (
    <SectionCard title={im.conversationTitle} icon={<StatusDot ok={stateReady} />}>
      <div className="space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">{im.conversationEnable}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{im.conversationHint}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              aria-label={im.conversationEnable}
            />
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-[var(--amber)]' : 'bg-muted'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
            </span>
          </label>
        </div>

        {enabled && (
          <>
            {/* Transport selector */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Transport</label>
                <Select
                  value={transport}
                  onChange={e => setTransport(e.target.value as 'webhook' | 'long_connection')}
                >
                  <option value="long_connection">Long Connection (recommended)</option>
                  <option value="webhook">Webhook</option>
                </Select>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {isLC
                    ? im.transportLongHint
                    : im.transportWebhookHint}
                </p>
              </div>

              {/* Status */}
              <div className="flex items-end">
                <div className="rounded-md bg-muted/40 px-4 py-3 w-full">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{im.conversationStatus}</p>
                  <div className="flex items-center gap-2">
                    <StatusDot ok={stateReady} />
                    <span className="text-sm text-foreground">
                      {stateReady ? im.conversationReady : status?.state === 'pending' ? im.conversationWaiting : im.conversationDisabled}
                    </span>
                  </div>
                  {status?.lastError && <p className="text-xs text-error mt-1">{status.lastError}</p>}
                </div>
              </div>
            </div>

            {/* Webhook-only fields */}
            {!isLC && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">{im.conversationPublicBaseUrl}</label>
                  <input
                    type="url"
                    placeholder="https://mindos.example.com"
                    value={publicBaseUrl}
                    onChange={e => setPublicBaseUrl(e.target.value)}
                    className="h-10 w-full px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">{im.conversationVerificationToken}</label>
                  <input
                    type="password"
                    placeholder={im.conversationSecretPlaceholder}
                    value={verificationToken}
                    onChange={e => setVerificationToken(e.target.value)}
                    className="h-10 w-full px-3 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                {status?.webhookUrl && (
                  <div className="sm:col-span-2 rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Webhook URL</p>
                    <p className="text-xs font-mono text-foreground break-all">{status.webhookUrl}</p>
                  </div>
                )}
              </div>
            )}

            {/* Group mention toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowMentions}
                onChange={e => setAllowMentions(e.target.checked)}
                className="h-4 w-4 rounded border-border text-[var(--amber)] focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-sm text-foreground">{im.conversationGroupMentions}</span>
            </label>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="h-10 px-5 text-sm font-medium rounded-md inline-flex items-center gap-2 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {im.conversationSave}
              </button>
              {platform.guideUrl && (
                <Link
                  href={platform.guideUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {im.conversationOpenPlatform}
                  <ExternalLink size={12} />
                </Link>
              )}
            </div>

            <ActionResult result={result} />
          </>
        )}
      </div>
    </SectionCard>
  );
}
