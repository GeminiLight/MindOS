'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2, GitBranch, ExternalLink, Eye, EyeOff } from 'lucide-react';
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

/* ── Empty state — GUI sync init form ─────────────────────────── */

function isValidGitUrl(url: string): 'https' | 'ssh' | false {
  if (/^https:\/\/.+/.test(url)) return 'https';
  if (/^git@[\w.-]+:.+/.test(url)) return 'ssh';
  return false;
}

function SyncEmptyState({ t, onInitComplete }: { t: any; onInitComplete: () => void }) {
  const syncT = t.settings?.sync;

  const [remoteUrl, setRemoteUrl] = useState('');
  const [token, setToken] = useState('');
  const [branch, setBranch] = useState('main');
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const urlType = remoteUrl.trim() ? isValidGitUrl(remoteUrl.trim()) : null;
  const isValid = urlType === 'https' || urlType === 'ssh';
  const showTokenField = urlType === 'https';

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          remote: remoteUrl.trim(),
          token: token.trim() || undefined,
          branch: branch.trim() || 'main',
        }),
      });
      onInitComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-5">
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

      {/* Git Remote URL */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground block">
          {syncT?.remoteUrl ?? 'Git Remote URL'}
        </label>
        <input
          type="text"
          value={remoteUrl}
          onChange={e => { setRemoteUrl(e.target.value); setError(''); }}
          placeholder="https://github.com/user/my-mind.git"
          className="w-full px-3 py-2 text-sm rounded-lg border bg-transparent font-mono text-xs transition-colors focus:outline-none focus:ring-1"
          style={{
            borderColor: remoteUrl.trim() && !isValid ? 'var(--destructive, red)' : 'var(--border)',
            color: 'var(--foreground)',
          }}
        />
        {remoteUrl.trim() && !isValid && (
          <p className="text-[11px]" style={{ color: 'var(--destructive, red)' }}>
            {syncT?.invalidUrl ?? 'Invalid Git URL — use HTTPS (https://...) or SSH (git@...)'}
          </p>
        )}
        {urlType === 'ssh' && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertCircle size={11} className="shrink-0" />
            {syncT?.sshHint ?? 'SSH URLs require SSH key configured on this machine. HTTPS with token recommended.'}
          </p>
        )}
      </div>

      {/* Access Token (HTTPS only) */}
      {showTokenField && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground block">
            {syncT?.accessToken ?? 'Access Token'}{' '}
            <span className="text-muted-foreground font-normal">{syncT?.optional ?? '(optional, for private repos)'}</span>
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="w-full px-3 py-2 pr-9 text-sm rounded-lg border bg-transparent font-mono text-xs transition-colors focus:outline-none focus:ring-1"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {syncT?.tokenHint ?? 'GitHub: Settings → Developer settings → Personal access tokens → repo scope'}
          </p>
        </div>
      )}

      {/* Branch */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground block">
          {syncT?.branchLabel ?? 'Branch'}
        </label>
        <input
          type="text"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          className="w-full max-w-[200px] px-3 py-2 text-sm rounded-lg border bg-transparent font-mono text-xs transition-colors focus:outline-none focus:ring-1"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
      </div>

      {/* Connect button */}
      <button
        type="button"
        onClick={handleConnect}
        disabled={!isValid || connecting}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--amber)', color: '#131210' }}
      >
        {connecting && <Loader2 size={14} className="animate-spin" />}
        {connecting
          ? (syncT?.connecting ?? 'Connecting...')
          : (syncT?.connectButton ?? 'Connect & Start Sync')}
      </button>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-xs p-3 rounded-lg" role="alert" aria-live="polite" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--destructive, red)' }}>
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Features */}
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground pt-2">
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
    return <SyncEmptyState t={t} onInitComplete={fetchStatus} />;
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
        <div className="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
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
