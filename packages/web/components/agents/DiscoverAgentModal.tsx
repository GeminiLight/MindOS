'use client';

import { useState } from 'react';
import { X, Loader2, Globe, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { RemoteAgent } from '@/lib/a2a/types';

interface DiscoverAgentModalProps {
  open: boolean;
  onClose: () => void;
  onDiscover: (url: string) => Promise<RemoteAgent | null>;
  discovering: boolean;
  error: string | null;
}

export default function DiscoverAgentModal({
  open,
  onClose,
  onDiscover,
  discovering,
  error,
}: DiscoverAgentModalProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<RemoteAgent | null>(null);

  if (!open) return null;

  const handleDiscover = async () => {
    if (!url.trim() || discovering) return;
    setResult(null);
    const agent = await onDiscover(url.trim());
    if (agent) setResult(agent);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleDiscover();
    if (e.key === 'Escape') onClose();
  };

  const handleClose = () => {
    setUrl('');
    setResult(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop" onClick={handleClose}>
      <div
        className="bg-popover border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-5"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={p.a2aDiscover}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Globe size={15} className="text-muted-foreground" />
            {p.a2aDiscover}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-2xs text-muted-foreground mb-3">{p.a2aDiscoverHint}</p>

        <div className="flex gap-2 mb-4">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={p.a2aDiscoverPlaceholder}
            disabled={discovering}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            autoFocus
          />
          <button
            type="button"
            onClick={handleDiscover}
            disabled={discovering || !url.trim()}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center gap-1.5 shrink-0"
          >
            {discovering && <Loader2 size={12} className="animate-spin" />}
            {discovering ? p.a2aDiscovering : p.a2aDiscover}
          </button>
        </div>

        {error && !result && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 mb-3">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-error mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-error">{p.a2aDiscoverFailed}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">{p.a2aDiscoverFailedHint}</p>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-success mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-success mb-1.5">{p.a2aDiscoverSuccess}</p>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground truncate" title={result.card.name}>
                    {result.card.name}
                    <span className="text-2xs text-muted-foreground ml-1.5">v{result.card.version}</span>
                  </p>
                  <p className="text-2xs text-muted-foreground truncate" title={result.card.description}>
                    {result.card.description}
                  </p>
                  {result.card.skills.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-2xs text-muted-foreground mb-1">{p.a2aSkills}:</p>
                      <div className="flex flex-wrap gap-1">
                        {result.card.skills.map(s => (
                          <span
                            key={s.id}
                            className="text-2xs px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50"
                            title={s.description}
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-2xs text-muted-foreground mt-1 truncate" title={result.endpoint}>
                    {p.a2aEndpoint}: {result.endpoint}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
