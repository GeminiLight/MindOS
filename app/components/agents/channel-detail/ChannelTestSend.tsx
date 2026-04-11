import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { ActionResult } from './shared';

export function ChannelTestSend({ platformId, im, recipientExample, onSent }: {
  platformId: string;
  im: Record<string, any>;
  recipientExample?: string;
  onSent: () => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('Hello from MindOS');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSend = async () => {
    if (!recipient.trim() || !message.trim()) return;
    setStatus('sending');
    setResult(null);
    try {
      const res = await fetch('/api/im/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId, recipient_id: recipient, message }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('success');
        setResult({ ok: true, msg: data.messageId ? `Sent (ID: ${data.messageId})` : im.sentOk });
        onSent();
      } else {
        setStatus('error');
        setResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setStatus('error');
      setResult({ ok: false, msg: err instanceof Error ? err.message : (im.networkError ?? 'Network error') });
    }
  };

  return (
    <details className="rounded-lg border border-border bg-card shadow-sm overflow-hidden group">
      <summary className="flex items-center gap-2.5 px-5 py-3.5 cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground transition-colors list-none [&::-webkit-details-marker]:hidden">
        <Send size={14} className="text-[var(--amber)]" />
        <span>{im.sendSample}</span>
        <span className="ml-auto text-xs text-muted-foreground/60 group-open:hidden">{im.expandToSee ?? 'Click to expand'}</span>
      </summary>
      <div className="border-t border-border px-5 py-4 space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">{im.sampleHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">{im.recipientPlaceholder}</label>
            <input
              type="text"
              placeholder={recipientExample || im.recipientPlaceholder}
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              className="h-10 w-full px-3 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={im.recipientPlaceholder}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">{im.messagePlaceholder}</label>
            <input
              type="text"
              placeholder={im.messagePlaceholder}
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="h-10 w-full px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={im.messagePlaceholder}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSend}
            disabled={status === 'sending' || !recipient.trim()}
            className="h-10 px-5 text-sm font-medium rounded-md inline-flex items-center gap-2 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {status === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {im.sendSample}
          </button>
        </div>
        <ActionResult result={result} />
      </div>
    </details>
  );
}
