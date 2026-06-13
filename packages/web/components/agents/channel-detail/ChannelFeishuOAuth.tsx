import { useState } from 'react';
import { ExternalLink, Loader2, ScanLine } from 'lucide-react';
import { SectionCard, StatusDot, ActionResult } from './shared';

type FeishuOAuthStatus = {
  state: 'disconnected' | 'pending' | 'connected';
  expiresAt?: string;
  user?: {
    name?: string;
    en_name?: string;
    open_id?: string;
    union_id?: string;
    user_id?: string;
    email?: string;
  };
};

export function ChannelFeishuOAuth({ status, im, onSaved }: {
  status?: FeishuOAuthStatus;
  im: Record<string, any>;
  onSaved: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const connected = status?.state === 'connected';
  const pending = status?.state === 'pending';
  const displayUser = status?.user?.name
    ?? status?.user?.en_name
    ?? status?.user?.email
    ?? status?.user?.open_id
    ?? status?.user?.union_id
    ?? status?.user?.user_id;

  const handleAuthorize = async () => {
    setOpening(true);
    setResult(null);
    try {
      const res = await fetch('/api/im/feishu/oauth');
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setResult({ ok: false, msg: data.error || im.feishuOAuthSetupRequired });
        return;
      }
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
      setResult({ ok: true, msg: im.feishuOAuthOpened });
      onSaved();
    } catch (error) {
      setResult({ ok: false, msg: error instanceof Error ? error.message : (im.networkError ?? 'Network error') });
    } finally {
      setOpening(false);
    }
  };

  return (
    <SectionCard title={im.feishuOAuthTitle} icon={<StatusDot ok={connected} />}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground leading-relaxed">{im.feishuOAuthHint}</p>
            <p className="mt-2 text-sm text-foreground">
              {connected && displayUser ? `${im.feishuOAuthConnected} ${displayUser}` : pending ? im.conversationWaiting : im.feishuOAuthDisconnected}
            </p>
          </div>
          <ScanLine size={18} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleAuthorize}
            disabled={opening}
            className="h-10 px-5 text-sm font-medium rounded-md inline-flex items-center gap-2 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {opening ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
            {opening ? im.feishuOAuthOpening : im.feishuOAuthAuthorize}
          </button>
        </div>

        <ActionResult result={result} />
      </div>
    </SectionCard>
  );
}
