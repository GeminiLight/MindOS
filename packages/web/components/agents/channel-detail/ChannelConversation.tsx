import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink, Loader2, MessageCircle, Play, Settings2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard, StatusDot, ActionResult } from './shared';

type FeishuLongConnectionStatus = {
  running: boolean;
  startedAt?: string;
  lastError?: string;
};

type FeishuConversationStatus = {
  state: string;
  transport?: string;
  webhookUrl?: string;
  publicBaseUrl?: string;
  lastError?: string;
};

export function ChannelConversation({ status, im, platform, onSaved }: {
  status: FeishuConversationStatus | undefined;
  im: Record<string, any>;
  platform: { guideUrl?: string };
  onSaved: () => void;
}) {
  const [allowMentions, setAllowMentions] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [encryptKey, setEncryptKey] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState(status?.publicBaseUrl ?? '');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [longAction, setLongAction] = useState<'start' | 'stop' | null>(null);
  const [longStatus, setLongStatus] = useState<FeishuLongConnectionStatus | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const longConnectionRunning = longStatus?.running ?? (status?.transport === 'long_connection' && status?.state === 'ready');
  const webhookReady = status?.transport === 'webhook' && status?.state === 'ready';
  const conversationReady = longConnectionRunning || webhookReady;
  const statusLabel = conversationReady
    ? im.conversationReady
    : status?.state === 'error'
      ? im.conversationError
      : im.conversationNotStarted;
  const primaryButtonLabel = longConnectionRunning ? im.conversationLongStop : im.conversationStart;
  const primaryBusy = longAction !== null;
  const statusError = localizeKnownStatusError(longStatus?.lastError ?? status?.lastError, im);

  const saveLongConnectionConfig = async () => {
    const res = await fetch('/api/im/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'feishu',
        conversation: {
          enabled: true,
          transport: 'long_connection',
          allow_group_mentions: allowMentions,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || im.failed || 'Failed');
    }
  };

  const handlePrimaryConversationAction = async () => {
    const action = longConnectionRunning ? 'stop' : 'start';
    setLongAction(action);
    setResult(null);
    try {
      if (action === 'start') {
        await saveLongConnectionConfig();
      }
      const res = await fetch('/api/im/feishu/long-connection', {
        method: action === 'start' ? 'POST' : 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setLongStatus({
          running: Boolean(data.running),
          startedAt: data.startedAt,
          lastError: data.error ?? data.lastError,
        });
        setResult({ ok: false, msg: data.error || im.failed || 'Failed' });
        return;
      }
      setLongStatus({
        running: Boolean(data.running),
        startedAt: data.startedAt,
        lastError: data.lastError,
      });
      setResult({
        ok: true,
        msg: data.running ? im.conversationStarted : im.conversationLongStopped,
      });
      onSaved();
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : (im.networkError ?? 'Network error') });
    } finally {
      setLongAction(null);
    }
  };

  const handleSaveWebhook = async () => {
    setSavingWebhook(true);
    setResult(null);
    try {
      const res = await fetch('/api/im/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'feishu',
          conversation: {
            enabled: true,
            transport: 'webhook',
            encrypt_key: encryptKey.trim() || undefined,
            verification_token: verificationToken.trim() || undefined,
            public_base_url: publicBaseUrl.trim() || undefined,
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
        setResult({ ok: false, msg: data.error || im.failed || 'Failed' });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : (im.networkError ?? 'Network error') });
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleCopyWebhookUrl = async () => {
    if (!status?.webhookUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(status.webhookUrl);
    setCopiedWebhook(true);
    window.setTimeout(() => setCopiedWebhook(false), 1200);
  };

  return (
    <SectionCard title={im.conversationTitle} icon={<StatusDot ok={conversationReady} />}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md bg-[var(--amber)]/10 px-2.5 py-1 text-xs font-medium text-[var(--amber)]">
              <MessageCircle size={13} aria-hidden="true" />
              {statusLabel}
            </div>
          </div>
          <Button
            type="button"
            onClick={handlePrimaryConversationAction}
            disabled={primaryBusy}
            variant="amber"
            size="xl"
            className="h-11 px-5"
          >
            {primaryBusy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            ) : longConnectionRunning ? (
              <Square size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {primaryButtonLabel}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {[im.conversationStepApp, im.conversationStepStart, im.conversationStepTest].map((label: string, index: number) => (
            <div key={label} className="flex items-start gap-2 rounded-md bg-muted/30 px-3 py-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--amber)]/15 text-[11px] font-semibold text-[var(--amber)]">
                {index + 1}
              </span>
              <span className="text-xs leading-relaxed text-foreground">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-md bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {im.conversationFeishuChecklist}
          </div>
          {platform.guideUrl && (
            <Link
              href={platform.guideUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {im.conversationOpenPlatform}
              <ExternalLink size={12} aria-hidden="true" />
            </Link>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={allowMentions}
            onChange={e => setAllowMentions(e.target.checked)}
            className="h-4 w-4 rounded border-border text-[var(--amber)] focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span className="text-sm text-foreground">{im.conversationGroupMentions}</span>
        </label>

        {statusError && <p className="text-xs leading-relaxed text-error">{statusError}</p>}
        <ActionResult result={result} />

        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen(open => !open)}
            aria-expanded={advancedOpen}
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Settings2 size={14} aria-hidden="true" />
            {im.conversationAdvancedToggle}
          </button>

          {advancedOpen && (
            <div className="mt-4 space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{im.conversationAdvancedHint}</p>
              <div className="grid gap-3 lg:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{im.conversationPublicBaseUrl}</label>
                  <input
                    type="url"
                    placeholder="https://mindos.example.com"
                    value={publicBaseUrl}
                    onChange={e => setPublicBaseUrl(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{im.conversationEncryptKey}</label>
                  <input
                    type="password"
                    placeholder={im.conversationSecretPlaceholder}
                    value={encryptKey}
                    onChange={e => setEncryptKey(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{im.conversationVerificationToken}</label>
                  <input
                    type="password"
                    placeholder={im.conversationSecretPlaceholder}
                    value={verificationToken}
                    onChange={e => setVerificationToken(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {status?.webhookUrl && (
                <div className="rounded-md bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{im.conversationWebhookUrl}</p>
                    <button
                      type="button"
                      onClick={handleCopyWebhookUrl}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {copiedWebhook ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      {copiedWebhook ? im.copied : im.conversationCopyUrl}
                    </button>
                  </div>
                  <p className="break-all font-mono text-xs text-foreground">{status.webhookUrl}</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleSaveWebhook}
                disabled={savingWebhook}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingWebhook && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {im.conversationSaveWebhook}
              </button>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function localizeKnownStatusError(error: string | undefined, im: Record<string, any>): string | undefined {
  if (!error) return undefined;
  if (/Start the Feishu long connection client/i.test(error)) return undefined;
  if (/App ID and App Secret/i.test(error)) return im.feishuOAuthSetupRequired;
  if (/Encrypt Key/i.test(error)) return im.conversationNeedsEncryptKey;
  if (/Public base URL/i.test(error)) return im.conversationNeedsPublicUrl;
  return error;
}
