import { useCallback, useEffect, useState } from 'react';
import { Bot, Link2, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Identity = {
  status: string;
  available: boolean;
  verified: boolean;
};

type ConnectionView = {
  id: string;
  provider: 'feishu';
  status: 'ready' | 'degraded' | 'unavailable';
  application: { appId: string; appName?: string; brand: 'feishu' | 'lark' };
  identities: { bot: Identity; user: Identity };
  issues?: Array<{ message: string; hint?: string }>;
};

export function ChannelConnectionBroker({ im, onChanged }: {
  im: Record<string, any>;
  onChanged(): void;
}) {
  const [binding, setBinding] = useState<ConnectionView | null>(null);
  const [candidate, setCandidate] = useState<ConnectionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/connections?discover=true&provider=feishu', { cache: 'no-store' });
      const payload = await response.json() as {
        bindings?: ConnectionView[];
        candidates?: ConnectionView[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || im.existingConnectionFailed);
      setBinding(payload.bindings?.find((entry) => entry.provider === 'feishu') ?? null);
      setCandidate(payload.candidates?.find((entry) => entry.provider === 'feishu') ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : im.existingConnectionFailed);
    } finally {
      setLoading(false);
    }
  }, [im.existingConnectionFailed]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (body: Record<string, string>) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || im.existingConnectionFailed);
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : im.existingConnectionFailed);
    } finally {
      setWorking(false);
    }
  };

  if (loading && !binding && !candidate) return null;
  const shown = binding ?? candidate;
  if (!shown && !error) return null;
  const botReady = shown?.identities.bot.available && shown.identities.bot.verified;
  const userMissing = shown && !shown.identities.user.available;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm" aria-label={im.existingConnectionTitle}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Link2 size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{binding ? im.existingConnectionUsing : im.existingConnectionTitle}</h3>
            {botReady ? (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-success bg-success/10">
                <Bot size={11} aria-hidden="true" /> {im.existingConnectionBotReady}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{im.existingConnectionHint}</p>
          {shown ? (
            <p className="mt-2 truncate text-sm text-foreground">
              {shown.application.appName ?? shown.application.appId}
              <span className="ml-2 font-mono text-xs text-muted-foreground">{shown.application.appId}</span>
            </p>
          ) : null}
          {userMissing ? <p className="mt-1 text-xs text-muted-foreground">{im.existingConnectionUserOptional}</p> : null}
          {shown?.issues?.find((issue) => !/user identity/i.test(issue.message)) ? (
            <p role="alert" className="mt-2 text-xs text-error">{shown.issues.find((issue) => !/user identity/i.test(issue.message))?.message}</p>
          ) : null}
          {error ? <p role="alert" className="mt-2 text-xs text-error">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {!binding && candidate ? (
              <Button
                type="button"
                variant="amber"
                size="sm"
                disabled={working || candidate.status === 'unavailable' || !botReady}
                onClick={() => void mutate({ action: 'bind', candidateId: candidate.id })}
              >
                {working ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                {working ? im.existingConnectionWorking : im.existingConnectionUse}
              </Button>
            ) : null}
            {binding ? (
              <>
                <Button type="button" variant="outline" size="sm" disabled={working} onClick={() => void mutate({ action: 'refresh', bindingId: binding.id })}>
                  <RefreshCw size={13} className={working ? 'animate-spin' : undefined} /> {im.existingConnectionRefresh}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={working} onClick={() => void mutate({ action: 'unbind', bindingId: binding.id })}>
                  <Unlink size={13} /> {im.existingConnectionRemove}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
