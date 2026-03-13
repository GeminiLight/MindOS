'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2, GitBranch, Copy, Check, ExternalLink } from 'lucide-react';
import { SectionLabel } from './Primitives';
import { apiFetch } from '@/lib/api';

export interface SyncStatus {
  enabled: boolean;
  provider?: string;
  remote?: string;
  branch?: string;
  lastSync?: string | null;
  lastPull?: string | null;
  unpushed?: string;
  conflicts?: Array<{ file: string; time: string }>;
  lastError?: string | null;
  autoCommitInterval?: number;
  autoPullInterval?: number;
}

interface SyncTabProps {
  t: any;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/* ── Copy-to-clipboard button ──────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
      title="Copy command"
    >
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

/* ── Empty state (Task D) ──────────────────────────────────────── */

function SyncEmptyState({ t }: { t: any }) {
  const syncT = t.settings?.sync;
  const cmd = 'mindos sync init';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <GitBranch size={18} className="text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {syncT?.emptyTitle ?? 'Cross-device Sync'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {syncT?.emptyDesc ?? 'Automatically sync your knowledge base across devices via Git.'}
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <SectionLabel>{syncT?.emptyStepsTitle ?? 'Setup'}</SectionLabel>
        <ol className="space-y-2.5 text-xs text-muted-foreground">
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-medium text-foreground mt-0.5">1</span>
            <span>{syncT?.emptyStep1 ?? 'Create a private Git repo (GitHub, GitLab, etc.) or use an existing one.'}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-medium text-foreground mt-0.5">2</span>
            <div className="flex-1">
              <span>{syncT?.emptyStep2 ?? 'Run this command in your terminal:'}</span>
              <div className="flex items-center gap-1.5 mt-1.5 px-3 py-2 bg-muted rounded-lg font-mono text-xs text-foreground">
                <code className="flex-1 select-all">{cmd}</code>
                <CopyButton text={cmd} />
              </div>
            </div>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-medium text-foreground mt-0.5">3</span>
            <span>{syncT?.emptyStep3 ?? 'Follow the prompts to connect your repo. Sync starts automatically.'}</span>
          </li>
        </ol>
      </div>

      {/* Features */}
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        {[
          syncT?.featureAutoCommit ?? 'Auto-commit on save',
          syncT?.featureAutoPull ?? 'Auto-pull from remote',
          syncT?.featureConflict ?? 'Conflict detection',
          syncT?.featureMultiDevice ?? 'Works across devices',
        ].map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <CheckCircle2 size={11} className="text-green-500/60 shrink-0" />
            <span>{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main SyncTab ──────────────────────────────────────────────── */

export function SyncTab({ t }: SyncTabProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SyncStatus>('/api/sync');
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'now' }),
      });
      setMessage({ type: 'success', text: 'Sync complete' });
      await fetchStatus();
    } catch {
      setMessage({ type: 'error', text: 'Sync failed' });
    } finally {
      setSyncing(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    setMessage(null);
    const action = status.enabled ? 'off' : 'on';
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchStatus();
      setMessage({ type: 'success', text: status.enabled ? 'Auto-sync disabled' : 'Auto-sync enabled' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to toggle sync' });
    } finally {
      setToggling(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status || !status.enabled) {
    return <SyncEmptyState t={t} />;
  }

  const conflicts = status.conflicts || [];

  return (
    <div className="space-y-5">
      <SectionLabel>Sync</SectionLabel>

      {/* Status overview */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">Provider</span>
          <span className="font-mono text-xs">{status.provider}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">Remote</span>
          <span className="font-mono text-xs truncate" title={status.remote}>{status.remote}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">Branch</span>
          <span className="font-mono text-xs">{status.branch}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">Last sync</span>
          <span className="text-xs">{timeAgo(status.lastSync)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">Unpushed</span>
          <span className="text-xs">{status.unpushed} commits</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">Auto-sync</span>
          <span className="text-xs">
            commit: {status.autoCommitInterval}s, pull: {Math.floor((status.autoPullInterval || 300) / 60)}min
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          Sync Now
        </button>
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            status.enabled
              ? 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
              : 'border-green-500/30 text-green-500 hover:bg-green-500/10'
          }`}
        >
          {status.enabled ? 'Disable Auto-sync' : 'Enable Auto-sync'}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className="flex items-center gap-1.5 text-xs">
          {message.type === 'success' ? (
            <><CheckCircle2 size={13} className="text-green-500" /><span className="text-green-500">{message.text}</span></>
          ) : (
            <><AlertCircle size={13} className="text-destructive" /><span className="text-destructive">{message.text}</span></>
          )}
        </div>
      )}

      {/* Conflicts (Task H — enhanced with links) */}
      {conflicts.length > 0 && (
        <div className="pt-2 border-t border-border">
          <SectionLabel>Conflicts ({conflicts.length})</SectionLabel>
          <div className="space-y-1.5">
            {conflicts.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs group">
                <AlertCircle size={12} className="text-red-500 shrink-0" />
                <a
                  href={`/view/${encodeURIComponent(c.file)}`}
                  className="font-mono truncate hover:text-foreground hover:underline transition-colors"
                  title={`Open ${c.file}`}
                >
                  {c.file}
                </a>
                <a
                  href={`/view/${encodeURIComponent(c.file + '.sync-conflict')}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
                  title="View remote version (.sync-conflict)"
                >
                  <ExternalLink size={11} />
                </a>
                <span className="text-muted-foreground shrink-0 ml-auto">{timeAgo(c.time)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Click a file to view your version. Hover and click <ExternalLink size={10} className="inline" /> to see the remote version.
          </p>
        </div>
      )}

      {/* Error */}
      {status.lastError && (
        <div className="pt-2 border-t border-border">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{status.lastError}</span>
          </div>
        </div>
      )}
    </div>
  );
}
