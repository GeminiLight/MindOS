'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2, GitBranch, ExternalLink, Eye, EyeOff, Check, ChevronRight, FileX2 } from 'lucide-react';
import { SectionLabel, PrimaryButton, Input, Field, SettingCard } from './Primitives';
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

/* ── Conflict Row ──────────────────────────────────────────────── */

function ConflictRow({ file, time, syncT, onResolved }: {
  file: string; time: string; syncT?: Record<string, unknown>; onResolved: () => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null); // 'local' | 'remote' | null

  const handleResolve = async (strategy: 'keep-local' | 'keep-remote') => {
    setResolving(strategy === 'keep-local' ? 'local' : 'remote');
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-conflict', remote: file, branch: strategy }),
      });
      onResolved();
    } catch {
      setResolving(null);
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-xs">
      <AlertCircle size={12} className="text-error shrink-0" />
      <a
        href={`/view/${encodeURIComponent(file)}`}
        className="font-mono truncate hover:text-foreground hover:underline transition-colors flex-1 min-w-0"
        title={file}
      >
        {file}
      </a>
      <span className="text-muted-foreground shrink-0">{timeAgo(time, syncT)}</span>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => handleResolve('keep-local')}
          disabled={!!resolving}
          className="px-2 py-0.5 rounded border border-border text-2xs hover:bg-muted transition-colors disabled:opacity-40"
          title={syncT?.keepLocalHint ?? 'Keep this device\'s version'}
        >
          {resolving === 'local' ? <Loader2 size={10} className="animate-spin" /> : (syncT?.keepLocal ?? 'Keep local')}
        </button>
        <button
          type="button"
          onClick={() => handleResolve('keep-remote')}
          disabled={!!resolving}
          className="px-2 py-0.5 rounded border border-border text-2xs hover:bg-muted transition-colors disabled:opacity-40"
          title={syncT?.keepRemoteHint ?? 'Replace with remote version'}
        >
          {resolving === 'remote' ? <Loader2 size={10} className="animate-spin" /> : (syncT?.keepRemote ?? 'Keep remote')}
        </button>
      </div>
    </div>
  );
}

/* ── Gitignore Editor ──────────────────────────────────────────── */

function GitignoreEditor({ syncT }: { syncT?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const loaded = useRef(false);

  const dirty = content !== saved;

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    setLoading(true);
    apiFetch<{ content: string }>('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gitignore-get' }),
    }).then(data => {
      setContent(data.content);
      setSaved(data.content);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [open]);

  const handleSave = async () => {
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gitignore-save', content }),
      });
      setSaved(content);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch {}
  };

  return (
    <div className="pt-2 border-t border-border/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <ChevronRight size={14} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileX2 size={13} className="shrink-0" />
        <span>{syncT?.gitignoreTitle ?? 'Excluded files'}</span>
        <span className="text-2xs opacity-50">.gitignore</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                placeholder={syncT?.gitignorePlaceholder ?? '# Files to exclude from sync\n*.tmp\nsecret/'}
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                {dirty && (
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity"
                  >
                    {syncT?.gitignoreSave ?? 'Save'}
                  </button>
                )}
                {saveOk && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check size={12} /> {syncT?.gitignoreSaved ?? 'Saved'}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
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
  const [connectStep, setConnectStep] = useState<number>(-1); // -1=idle, 0..3=steps, 4=done
  const [error, setError] = useState('');
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connecting = connectStep >= 0 && connectStep < 4;

  const urlType = remoteUrl.trim() ? isValidGitUrl(remoteUrl.trim()) : null;
  const isValid = urlType === 'https' || urlType === 'ssh';
  const showTokenField = urlType === 'https';

  const handleConnect = async () => {
    setConnectStep(0);
    setError('');

    // Progress steps on a timer (visual only — actual work is one API call)
    const advanceStep = (step: number, delayMs: number) =>
      setTimeout(() => setConnectStep(s => s >= 0 && s < 4 ? step : s), delayMs);
    stepTimerRef.current = advanceStep(1, 2000);  // "Authenticating..." → "Syncing data..."
    const t2 = advanceStep(2, 5000);              // → "Almost done..."

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
        timeout: 120_000,
      });
      setConnectStep(4); // success
      setTimeout(() => onInitComplete(), 600);
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : 'Connection failed';
      if (msg.includes('timed out')) {
        msg = syncT?.timeoutError ?? 'Connection timed out. The remote repository may be large or the network is slow. Please try again.';
      }
      const hint = getSyncErrorHint(msg, remoteUrl, syncT);
      setError(hint ? `${msg}\n${hint}` : msg);
      setConnectStep(-1);
    } finally {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      clearTimeout(t2);
    }
  };

  const connectSteps = [
    syncT?.stepConnecting ?? 'Connecting to remote...',
    syncT?.stepAuthenticating ?? 'Authenticating...',
    syncT?.stepSyncing ?? 'Syncing data...',
    syncT?.stepAlmostDone ?? 'Almost done...',
  ];

  return (
    <div className="space-y-4">
      <SettingCard
        icon={<GitBranch size={15} />}
        title={syncT?.emptyTitle ?? 'Cross-device Sync'}
        description={syncT?.emptyDesc ?? 'Automatically sync your knowledge base across devices via Git.'}
      >
        {/* Git Remote URL */}
        <Field
          label={syncT?.remoteUrl ?? 'Git Remote URL'}
          hint={urlType === 'ssh'
            ? (syncT?.sshHint ?? 'Requires SSH key on this machine. Verify with: ssh -T git@github.com')
            : undefined
          }
        >
          <Input
            type="text"
            value={remoteUrl}
            onChange={e => { setRemoteUrl(e.target.value); setError(''); }}
            placeholder="git@github.com:user/repo.git"
            className={`font-mono ${remoteUrl.trim() && !isValid ? 'border-destructive' : ''}`}
          />
          {!remoteUrl.trim() && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
              <span><code className="text-foreground/60 bg-muted/60 px-1 py-0.5 rounded text-2xs">SSH</code> {syncT?.sshBrief ?? 'one-time key setup, no token needed'}</span>
              <span><code className="text-foreground/60 bg-muted/60 px-1 py-0.5 rounded text-2xs">HTTPS</code> {syncT?.httpsBrief ?? 'works anywhere, token recommended'}</span>
            </div>
          )}
          {remoteUrl.trim() && !isValid && (
            <p className="text-xs text-destructive mt-1">
              {syncT?.invalidUrl ?? 'Invalid Git URL — use HTTPS (https://...) or SSH (git@...)'}
            </p>
          )}
        </Field>

        {/* Access Token (HTTPS only) */}
        {showTokenField && (
          <Field
            label={<>{syncT?.accessToken ?? 'Access Token'} <span className="text-muted-foreground font-normal">{syncT?.optional ?? '(optional, for private repos)'}</span></>}
            hint={undefined}
          >
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
            <p className="text-xs text-muted-foreground mt-1">
              {syncT?.tokenHint ?? 'GitHub:'}{' '}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=MindOS+Sync"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                {syncT?.tokenLink ?? 'Create a token (repo scope)'}
              </a>
            </p>
          </Field>
        )}

        {/* Branch */}
        <Field label={syncT?.branchLabel ?? 'Branch'}>
          <Input
            type="text"
            value={branch}
            onChange={e => setBranch(e.target.value)}
            placeholder="main"
            className="max-w-[200px] font-mono"
          />
        </Field>

        {/* Connect button + progress */}
        {!connecting && connectStep !== 4 && (
          <PrimaryButton
            onClick={handleConnect}
            disabled={!isValid}
            className="flex items-center gap-2"
          >
            {syncT?.connectButton ?? 'Connect & Start Sync'}
          </PrimaryButton>
        )}

        {(connecting || connectStep === 4) && (
          <div className="space-y-2 py-1">
            {connectSteps.map((label, i) => {
              const isDone = connectStep > i || connectStep === 4;
              const isActive = connectStep === i && connectStep < 4;
              if (connectStep < i && connectStep < 4) return null; // not yet
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {isDone
                    ? <Check size={13} className="text-success shrink-0" />
                    : <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />
                  }
                  <span className={isDone ? 'text-success' : isActive ? 'text-foreground' : 'text-muted-foreground'}>
                    {label}
                  </span>
                </div>
              );
            })}
            {connectStep === 4 && (
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={13} className="text-success shrink-0" />
                <span className="text-success font-medium">{syncT?.stepDone ?? 'Sync configured successfully!'}</span>
              </div>
            )}
          </div>
        )}

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
      </SettingCard>

      {/* Features */}
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground px-5">
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

  const handleReset = async () => {
    setToggling(true);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      await fetchStatus();
    } catch {
      setMessage({ type: 'error', text: syncT?.resetFailed ?? 'Failed to reset sync configuration' });
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

  // Broken state: config says enabled but repo/remote is missing
  if (status.needsSetup) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10">
          <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-destructive">
              {syncT?.brokenTitle ?? 'Sync configuration is broken'}
            </h3>
            <p className="text-xs text-destructive/80">
              {status.lastError || (syncT?.brokenDesc ?? 'The git repository or remote is missing. Reset to re-configure.')}
            </p>
            <PrimaryButton
              onClick={handleReset}
              disabled={toggling}
              className="flex items-center gap-2 mt-2"
            >
              {toggling && <Loader2 size={14} className="animate-spin" />}
              {syncT?.resetButton ?? 'Reset & Re-configure'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  const conflicts = status.conflicts || [];

  return (
    <div className="space-y-4">
      <SettingCard
        icon={<GitBranch size={15} />}
        title={syncT?.sectionTitle ?? 'Sync'}
        description={status.remote}
        badge={
          <span className="text-2xs px-1.5 py-0.5 rounded bg-success/15 text-success font-medium">
            {syncT?.labelEnabled ?? 'Active'}
          </span>
        }
      >
        {/* Status rows */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{syncT?.labelBranch ?? 'Branch'}</span>
            <span className="font-mono text-xs">{status.branch}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{syncT?.labelLastSync ?? 'Last sync'}</span>
            <span className="text-xs">{timeAgo(status.lastSync, syncT)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{syncT?.labelUnpushed ?? 'Unpushed'}</span>
            <span className="text-xs">{(syncT?.unpushedCommits as ((n: number) => string))?.(status.unpushed) ?? `${status.unpushed} commits`}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{syncT?.labelAutoSync ?? 'Auto-sync'}</span>
            <span className="text-xs">
              commit {status.autoCommitInterval}s · pull {Math.floor((status.autoPullInterval || 300) / 60)}min
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncT?.syncNow ?? 'Sync Now'}
          </button>
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {syncT?.disableAutoSync ?? 'Disable Auto-sync'}
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

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="pt-2 border-t border-border/50 space-y-3">
            <p className="text-xs font-medium text-foreground">
              {(syncT?.conflictsTitle as ((n: number) => string))?.(conflicts.length) ?? `Conflicts (${conflicts.length})`}
            </p>
            <p className="text-2xs text-muted-foreground">
              {syncT?.conflictExplain ?? 'These files were changed on both this device and the remote. Choose which version to keep for each file.'}
            </p>
            <div className="space-y-2">
              {conflicts.map((c, i) => (
                <ConflictRow key={i} file={c.file} time={c.time} syncT={syncT} onResolved={fetchStatus} />
              ))}
            </div>
          </div>
        )}

        {/* Error — hide if conflicts section already explains the issue */}
        {status.lastError && conflicts.length === 0 && (
          <div className="flex items-start gap-2 text-xs p-2.5 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="block">{status.lastError}</span>
              {getSyncErrorHint(status.lastError, status.remote, syncT) && (
                <span className="block text-destructive/70">{getSyncErrorHint(status.lastError, status.remote, syncT)}</span>
              )}
            </div>
          </div>
        )}

        {/* Gitignore editor */}
        <GitignoreEditor syncT={syncT} />
      </SettingCard>
    </div>
  );
}
