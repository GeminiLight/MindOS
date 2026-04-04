'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2, GitBranch, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { SectionLabel, PrimaryButton, Input } from './Primitives';
import { apiFetch } from '@/lib/api';
import type { SyncStatus, SyncTabProps } from './types';
import type { Messages } from '@/lib/i18n';

export function timeAgo(iso: string | null | undefined, syncT?: Record<string, unknown>): string {
  if (!iso) return (syncT?.timeNever as string) ?? 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return (syncT?.timeJustNow as string) ?? 'just now';
  const m = Math.floor(diff / 60000);
  if (diff < 3600000) return (syncT?.timeMinAgo as ((n: number) => string))?.(m) ?? `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (diff < 86400000) return (syncT?.timeHourAgo as ((n: number) => string))?.(h) ?? `${h}h ago`;
  const d = Math.floor(diff / 86400000);
  return (syncT?.timeDayAgo as ((n: number) => string))?.(d) ?? `${d}d ago`;
}

/** Classify a raw sync error and return a user-friendly message with action hint. */
function formatSyncError(raw: string, syncT?: Record<string, unknown>): string {
  const hint = getSyncErrorHint(raw, undefined, syncT);
  return hint ? `${raw}\n${hint}` : raw;
}

/** Return an actionable hint for common sync errors. */
function getSyncErrorHint(error: string, remote?: string | null, syncT?: Record<string, unknown>): string {
  const lower = error.toLowerCase();

  // SSH authentication failures
  if (lower.includes('permission denied') || lower.includes('publickey')) {
    return syncT?.hintSshAuth as string ?? 'SSH key may not be configured. Run: ssh-keygen -t ed25519 && ssh -T git@github.com';
  }
  // SSH host key / connection
  if (lower.includes('host key') || lower.includes('known_hosts') || lower.includes('fingerprint')) {
    return syncT?.hintSshHost as string ?? 'Run: ssh-keyscan github.com >> ~/.ssh/known_hosts';
  }
  // HTTPS auth failures
  if (lower.includes('authentication failed') || lower.includes('invalid credentials') || lower.includes('401') || lower.includes('403')) {
    return syncT?.hintHttpsAuth as string ?? 'Access token may be expired or missing. Check Settings → Developer settings → Personal access tokens.';
  }
  // Network / timeout
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('could not resolve')) {
    return syncT?.hintNetwork as string ?? 'Check your network connection and try again.';
  }
  // Remote not found
  if (lower.includes('not found') || lower.includes('does not exist') || lower.includes('repository not found')) {
    return syncT?.hintNotFound as string ?? 'Repository not found. Check the URL and ensure the repo exists.';
  }
  // Push rejected (non-fast-forward)
  if (lower.includes('non-fast-forward') || lower.includes('rejected') || lower.includes('fetch first')) {
    return syncT?.hintPushRejected as string ?? 'Remote has changes. Click "Sync Now" to pull and retry.';
  }
  // Merge conflicts
  if (lower.includes('conflict') || lower.includes('merge')) {
    return syncT?.hintConflict as string ?? 'Merge conflict detected. Check the Conflicts section below.';
  }

  return '';
}

/* ── Empty state — GUI sync init form ─────────────────────────── */

function isValidGitUrl(url: string): 'https' | 'ssh' | false {
  if (/^https:\/\/.+/.test(url)) return 'https';
  if (/^git@[\w.-]+:.+/.test(url)) return 'ssh';
  return false;
}

function SyncEmptyState({ t, onInitComplete }: { t: Messages; onInitComplete: () => void }) {
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
        timeout: 120_000, // git init + clone can take 60s+
      });
      onInitComplete();
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : 'Connection failed';
      // Make timeout errors actionable for users
      if (msg.includes('timed out')) {
        msg = syncT?.timeoutError ?? 'Connection timed out. The remote repository may be large or the network is slow. Please try again.';
      }
      const hint = getSyncErrorHint(msg, remoteUrl, syncT);
      setError(hint ? `${msg}\n${hint}` : msg);
    } finally {
      setConnecting(false);
    }
  };

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

      {/* Git Remote URL */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground block">
          {syncT?.remoteUrl ?? 'Git Remote URL'}
        </label>
        <Input
          type="text"
          value={remoteUrl}
          onChange={e => { setRemoteUrl(e.target.value); setError(''); }}
          placeholder="https://github.com/user/my-mind.git"
          className={`font-mono ${remoteUrl.trim() && !isValid ? 'border-destructive' : ''}`}
        />
        {remoteUrl.trim() && !isValid && (
          <p className="text-xs text-destructive">
            {syncT?.invalidUrl ?? 'Invalid Git URL — use HTTPS (https://...) or SSH (git@...)'}
          </p>
        )}
        {urlType === 'ssh' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle size={11} className="shrink-0" />
            {syncT?.sshHint ?? 'SSH URLs require SSH key configured on this machine. HTTPS with token recommended.'}
          </p>
        )}
      </div>

      {/* Access Token (HTTPS only) */}
      {showTokenField && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground block">
            {syncT?.accessToken ?? 'Access Token'}{' '}
            <span className="text-muted-foreground font-normal">{syncT?.optional ?? '(optional, for private repos)'}</span>
          </label>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="pr-9 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {syncT?.tokenHint ?? 'GitHub: Settings → Developer settings → Personal access tokens → repo scope'}
          </p>
        </div>
      )}

      {/* Branch */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground block">
          {syncT?.branchLabel ?? 'Branch'}
        </label>
        <Input
          type="text"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          className="max-w-[200px] font-mono"
        />
      </div>

      {/* Connect button */}
      <PrimaryButton
        onClick={handleConnect}
        disabled={!isValid || connecting}
        className="flex items-center gap-2"
      >
        {connecting && <Loader2 size={14} className="animate-spin" />}
        {connecting
          ? (syncT?.connecting ?? 'Connecting...')
          : (syncT?.connectButton ?? 'Connect & Start Sync')}
      </PrimaryButton>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-destructive/10 text-destructive" role="alert" aria-live="polite">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <div className="space-y-1">
            {error.split('\n').map((line, i) => (
              <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : ''}`}>{line}</span>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2">
        {[
          syncT?.featureAutoCommit ?? 'Auto-commit on save',
          syncT?.featureAutoPull ?? 'Auto-pull from remote',
          syncT?.featureConflict ?? 'Conflict detection',
          syncT?.featureMultiDevice ?? 'Works across devices',
        ].map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <CheckCircle2 size={11} className="text-success/60 shrink-0" />
            <span>{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main SyncTab ──────────────────────────────────────────────── */

export function SyncTab({ t }: SyncTabProps) {
  const syncT = t.settings?.sync;
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
        timeout: 120_000, // sync can take 60s+ for large repos
      });
      setMessage({ type: 'success', text: syncT?.syncComplete ?? 'Sync complete' });
      await fetchStatus();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Sync failed';
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
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
      setMessage({ type: 'success', text: status.enabled ? (syncT?.autoSyncDisabled ?? 'Auto-sync disabled') : (syncT?.autoSyncEnabled ?? 'Auto-sync enabled') });
    } catch {
      setMessage({ type: 'error', text: syncT?.toggleFailed ?? 'Failed to toggle sync' });
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
    <div className="space-y-6">
      <SectionLabel>{syncT?.sectionTitle ?? 'Sync'}</SectionLabel>

      {/* Status overview */}
      <div className="space-y-2.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{syncT?.labelProvider ?? 'Provider'}</span>
          <span className="font-mono text-sm">{status.provider}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{syncT?.labelRemote ?? 'Remote'}</span>
          <span className="font-mono text-sm truncate" title={status.remote}>{status.remote}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{syncT?.labelBranch ?? 'Branch'}</span>
          <span className="font-mono text-sm">{status.branch}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{syncT?.labelLastSync ?? 'Last sync'}</span>
          <span className="text-sm">{timeAgo(status.lastSync, syncT)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{syncT?.labelUnpushed ?? 'Unpushed'}</span>
          <span className="text-sm">{(syncT?.unpushedCommits as ((n: number) => string))?.(status.unpushed) ?? `${status.unpushed} commits`}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{syncT?.labelAutoSync ?? 'Auto-sync'}</span>
          <span className="text-sm">
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
          title={syncing ? t.hints.syncInProgress : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncT?.syncNow ?? 'Sync Now'}
        </button>
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling}
          title={toggling ? t.hints.toggleInProgress : undefined}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            status.enabled
              ? 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
              : 'border-success/30 text-success hover:bg-success/10'
          }`}
        >
          {status.enabled ? (syncT?.disableAutoSync ?? 'Disable Auto-sync') : (syncT?.enableAutoSync ?? 'Enable Auto-sync')}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className="flex items-start gap-1.5 text-xs" role="status" aria-live="polite">
          {message.type === 'success' ? (
            <><CheckCircle2 size={13} className="text-success shrink-0 mt-0.5" /><span className="text-success">{message.text}</span></>
          ) : (
            <>
              <AlertCircle size={13} className="text-destructive shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {message.text.split('\n').map((line, i) => (
                  <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : 'text-destructive'}`}>{line}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Conflicts (Task H — enhanced with links) */}
      {conflicts.length > 0 && (
        <div className="pt-2 border-t border-border">
          <SectionLabel>{(syncT?.conflictsTitle as ((n: number) => string))?.(conflicts.length) ?? `Conflicts (${conflicts.length})`}</SectionLabel>
          <div className="space-y-1.5">
            {conflicts.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs group">
                <AlertCircle size={12} className="text-error shrink-0" />
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
                <span className="text-muted-foreground shrink-0 ml-auto">{timeAgo(c.time, syncT)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {syncT?.conflictHint ?? 'Click a file to view your version. Hover and click'} <ExternalLink size={10} className="inline" /> {syncT?.conflictHintSuffix ?? 'to see the remote version.'}
          </p>
        </div>
      )}

      {/* Error */}
      {status.lastError && (
        <div className="pt-2 border-t border-border">
          <div className="flex items-start gap-2 text-xs p-2.5 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="block">{status.lastError}</span>
              <span className="block text-destructive/70">{getSyncErrorHint(status.lastError, status.remote, syncT)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
