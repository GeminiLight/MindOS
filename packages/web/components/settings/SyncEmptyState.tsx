'use client';

import { useEffect, useState, useRef } from 'react';
import {
  GitBranch, Loader2, Check,
  Eye, EyeOff, CheckCircle2, AlertCircle,
} from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { apiFetch } from '@/lib/api';
import { Input, Field, SettingCard, PrimaryButton } from './Primitives';
import { formatSyncError, getGitRemoteHost, getSyncErrorHint } from '@/lib/sync-ui';

function isValidGitUrl(url: string): 'https' | 'ssh' | false {
  if (/^https:\/\/.+/.test(url)) return 'https';
  if (/^git@[\w.-]+:.+/.test(url)) return 'ssh';
  if (/^ssh:\/\/git@[^/]+\/.+/.test(url)) return 'ssh';
  return false;
}

function redactGitUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url.replace(/^(https?:\/\/)[^/@]+@/i, '$1');
  }
}

function isValidGitBranchName(input: string): boolean {
  const value = input.trim() || 'main';
  if (!value || value === '@') return false;
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) return false;
  if (value.endsWith('.') || value.includes('..') || value.includes('//') || value.includes('@{')) return false;
  if (/[\s~^:?*\[\\\]]/.test(value)) return false;
  return value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

type SharedInitSnapshot = {
  pending: boolean;
  progressHidden: boolean;
  remote: string;
  branch: string;
  finishReason?: 'success' | 'error';
  error?: string;
};

const idleInitSnapshot: SharedInitSnapshot = { pending: false, progressHidden: false, remote: '', branch: 'main' };
let sharedInitSnapshot: SharedInitSnapshot = idleInitSnapshot;
const sharedInitListeners = new Set<() => void>();

function setSharedInitSnapshot(next: SharedInitSnapshot) {
  sharedInitSnapshot = next;
  for (const listener of sharedInitListeners) listener();
}

function subscribeSharedInit(listener: () => void) {
  sharedInitListeners.add(listener);
  return () => sharedInitListeners.delete(listener);
}

export default function SyncEmptyState({ t, onInitComplete }: { t: Messages; onInitComplete: () => void }) {
  const syncT = t.settings?.sync as Record<string, unknown> | undefined;
  const initialInitSnapshot = sharedInitSnapshot;
  const initialFailure = !initialInitSnapshot.pending && initialInitSnapshot.finishReason === 'error';

  const [remoteUrl, setRemoteUrl] = useState(initialInitSnapshot.pending || initialFailure ? initialInitSnapshot.remote : '');
  const [branch, setBranch] = useState(initialInitSnapshot.pending || initialFailure ? initialInitSnapshot.branch : 'main');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connectStep, setConnectStep] = useState<number>(initialInitSnapshot.pending && !initialInitSnapshot.progressHidden ? 0 : -1); // -1=idle, 0..3=steps, 4=done
  const [progressHidden, setProgressHidden] = useState(initialInitSnapshot.pending ? initialInitSnapshot.progressHidden : false);
  const [backgroundInitPending, setBackgroundInitPending] = useState(initialInitSnapshot.pending);
  const [error, setError] = useState(initialFailure ? (initialInitSnapshot.error ?? '') : '');
  const [connectingRemote, setConnectingRemote] = useState(initialInitSnapshot.pending ? initialInitSnapshot.remote : '');
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const connectRunRef = useRef(0);
  const mountedRef = useRef(true);
  const lastSharedPendingRef = useRef(initialInitSnapshot.pending);
  const localInitCompletingRef = useRef(false);

  const connecting = !progressHidden && connectStep >= 0 && connectStep < 4;
  const setupLocked = backgroundInitPending;

  const urlType = remoteUrl.trim() ? isValidGitUrl(remoteUrl.trim()) : null;
  const isValid = urlType === 'https' || urlType === 'ssh';
  const branchValue = branch.trim() || 'main';
  const branchValid = isValidGitBranchName(branchValue);
  const showTokenField = urlType === 'https';
  const remoteHost = getGitRemoteHost(remoteUrl);
  const disabledReason = !remoteUrl.trim()
    ? ((syncT?.connectNeedsUrl as string) ?? 'Paste a remote URL to continue')
    : !isValid
      ? ((syncT?.connectFixUrl as string) ?? 'Fix the Git URL to continue')
      : !branchValid
        ? ((syncT?.connectFixBranch as string) ?? 'Use a valid Git branch name')
        : '';

  const clearStepTimers = () => {
    for (const timer of stepTimersRef.current) clearTimeout(timer);
    stepTimersRef.current = [];
  };

  const handleHideProgress = () => {
    clearStepTimers();
    setProgressHidden(true);
    setSharedInitSnapshot({
      pending: true,
      progressHidden: true,
      remote: connectingRemote,
      branch: branchValue,
    });
    setConnectStep(-1);
    setError('');
  };

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeSharedInit(() => {
      const snapshot = sharedInitSnapshot;
      const wasPending = lastSharedPendingRef.current;
      lastSharedPendingRef.current = snapshot.pending;
      setBackgroundInitPending(snapshot.pending);
      setProgressHidden(snapshot.pending ? snapshot.progressHidden : false);
      if (!snapshot.pending) {
        setConnectStep(-1);
        setConnectingRemote('');
        if (wasPending && snapshot.finishReason === 'success' && !localInitCompletingRef.current) onInitComplete();
        if (snapshot.finishReason === 'error') {
          setRemoteUrl(current => current || snapshot.remote);
          setBranch(current => current || snapshot.branch);
          setError(snapshot.error ?? '');
        }
        return;
      }
      if (snapshot.pending) {
        setRemoteUrl(current => current || snapshot.remote);
        setBranch(current => current || snapshot.branch);
        setConnectingRemote(snapshot.remote);
        setConnectStep(current => snapshot.progressHidden ? -1 : (current >= 0 ? current : 0));
      }
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
      if (!sharedInitSnapshot.pending) abortRef.current?.abort();
      clearStepTimers();
    };
  }, []);

  const handleConnect = async () => {
    if (setupLocked || !isValid || !branchValid) return;
    const runId = connectRunRef.current + 1;
    connectRunRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    const submittedRemote = remoteUrl.trim();
    const submittedBranch = branchValue;

    clearStepTimers();
    setProgressHidden(false);
    setBackgroundInitPending(true);
    setConnectingRemote(redactGitUrl(submittedRemote));
    setSharedInitSnapshot({
      pending: true,
      progressHidden: false,
      remote: redactGitUrl(submittedRemote),
      branch: submittedBranch,
    });
    setConnectStep(0);
    setError('');

    // Progress steps on a timer (visual only — actual work is one API call)
    const advanceStep = (step: number, delayMs: number) =>
      setTimeout(() => setConnectStep(s => (connectRunRef.current === runId && s >= 0 && s < 4) ? step : s), delayMs);
    stepTimersRef.current = [
      advanceStep(1, 2000),
      advanceStep(2, 5000),
      advanceStep(3, 9000),
    ];

    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          remote: submittedRemote,
          token: token.trim() || undefined,
          branch: submittedBranch,
        }),
        timeout: 120_000,
        signal: controller.signal,
      });
      if (connectRunRef.current !== runId) return;
      localInitCompletingRef.current = true;
      setSharedInitSnapshot({ ...idleInitSnapshot, finishReason: 'success' });
      if (!mountedRef.current) return;
      setProgressHidden(false);
      setBackgroundInitPending(false);
      setConnectStep(4); // success
      setTimeout(() => {
        if (connectRunRef.current === runId) onInitComplete();
        localInitCompletingRef.current = false;
      }, 600);
    } catch (err: unknown) {
      if (connectRunRef.current !== runId || controller.signal.aborted) return;
      const formattedError = (() => {
        let msg = err instanceof Error ? err.message : 'Connection failed';
        if (msg.includes('timed out')) {
          msg = (syncT?.timeoutError as string) ?? 'Connection timed out. The remote repository may be large or the network is slow. Please try again.';
        }
        const formatted = formatSyncError(msg, syncT);
        const hint = getSyncErrorHint(msg, submittedRemote, syncT);
        return hint && !formatted.includes(hint) ? `${formatted}\n${hint}` : formatted;
      })();
      setSharedInitSnapshot({
        pending: false,
        progressHidden: false,
        remote: redactGitUrl(submittedRemote),
        branch: submittedBranch,
        finishReason: 'error',
        error: formattedError,
      });
      if (!mountedRef.current) return;
      setError(formattedError);
      setProgressHidden(false);
      setBackgroundInitPending(false);
      setConnectStep(-1);
    } finally {
      if (connectRunRef.current === runId) {
        clearStepTimers();
        abortRef.current = null;
        if (mountedRef.current) setConnectingRemote('');
      }
    }
  };

  const connectSteps = [
    (syncT?.stepConnecting as string) ?? 'Connecting to remote...',
    (syncT?.stepAuthenticating as string) ?? 'Authenticating...',
    (syncT?.stepSyncing as string) ?? 'Syncing data...',
    (syncT?.stepAlmostDone as string) ?? 'Almost done...',
  ];

  return (
    <div className="space-y-4">
      <SettingCard
        icon={<GitBranch size={15} />}
        title={(syncT?.emptyTitle as string) ?? 'Cross-device Sync'}
        description={(syncT?.emptyDesc as string) ?? 'Automatically sync your knowledge base across devices via Git.'}
      >
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            {(syncT?.setupIntroTitle as string) ?? 'Start with a private Git repository'}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              (syncT?.setupStepRepo as string) ?? 'Create an empty private repo',
              (syncT?.setupStepUrl as string) ?? 'Paste its SSH or HTTPS URL',
              (syncT?.setupStepToken as string) ?? 'HTTPS can use a token for private repos',
            ].map((item) => (
              <div key={item} className="flex items-start gap-1.5">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success/70" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Git Remote URL */}
        <Field
          htmlFor="sync-remote-url"
          label={(syncT?.remoteUrl as string) ?? 'Git Remote URL'}
          hint={urlType === 'ssh'
            ? ((syncT?.sshHintForHost as ((host: string) => string))?.(remoteHost ?? 'github.com')
              ?? `Requires SSH key on this machine. Verify with: ssh -T git@${remoteHost ?? 'github.com'}`)
            : undefined
          }
        >
          <Input
            id="sync-remote-url"
            type="text"
            value={remoteUrl}
            onChange={e => {
              setRemoteUrl(e.target.value);
              setError('');
              if (sharedInitSnapshot.finishReason === 'error') setSharedInitSnapshot(idleInitSnapshot);
            }}
            placeholder="git@github.com:user/repo.git"
            disabled={setupLocked}
            className={`font-mono ${remoteUrl.trim() && !isValid ? 'border-destructive' : ''}`}
          />
          {!remoteUrl.trim() && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
              <span><code className="text-foreground/60 bg-muted/60 px-1 py-0.5 rounded text-2xs">SSH</code> {(syncT?.sshBrief as string) ?? 'one-time key setup, no token needed'}</span>
              <span><code className="text-foreground/60 bg-muted/60 px-1 py-0.5 rounded text-2xs">HTTPS</code> {(syncT?.httpsBrief as string) ?? 'works anywhere; add a token for private repos'}</span>
            </div>
          )}
          {remoteUrl.trim() && !isValid && (
            <p className="text-xs text-destructive mt-1">
              {(syncT?.invalidUrl as string) ?? 'Invalid Git URL — use HTTPS (https://...) or SSH (git@... / ssh://git@...)'}
            </p>
          )}
        </Field>

        {/* Access Token (HTTPS only) */}
        {showTokenField && (
          <Field
            htmlFor="sync-access-token"
            label={<>{(syncT?.accessToken as string) ?? 'Access Token'} <span className="text-muted-foreground font-normal">{(syncT?.requiredForPrivateHttps as string) ?? '(optional; needed for private HTTPS repos)'}</span></>}
            hint={undefined}
          >
            <div className="relative">
              <Input
                id="sync-access-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => {
                  setToken(e.target.value);
                  setError('');
                  if (sharedInitSnapshot.finishReason === 'error') setSharedInitSnapshot(idleInitSnapshot);
                }}
                placeholder="ghp_xxxxxxxxxxxx"
                disabled={setupLocked}
                className="pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                disabled={setupLocked}
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showToken ? ((syncT?.hideToken as string) ?? 'Hide token') : ((syncT?.showToken as string) ?? 'Show token')}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {(syncT?.tokenHint as string) ?? 'Optional for public repositories or machines that already have Git credentials. Private GitHub/GitLab HTTPS repositories usually need one.'}{' '}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=MindOS+Sync"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                {(syncT?.tokenLink as string) ?? 'Create a token (repo scope)'}
              </a>
            </p>
          </Field>
        )}

        {/* Branch */}
        <Field htmlFor="sync-branch" label={(syncT?.branchLabel as string) ?? 'Branch'}>
          <Input
            id="sync-branch"
            type="text"
            value={branch}
            onChange={e => {
              setBranch(e.target.value);
              if (sharedInitSnapshot.finishReason === 'error') {
                setError('');
                setSharedInitSnapshot(idleInitSnapshot);
              }
            }}
            placeholder="main"
            disabled={setupLocked}
            className={`max-w-[200px] font-mono ${!branchValid ? 'border-destructive' : ''}`}
          />
          {!branchValid && (
            <p className="text-xs text-destructive mt-1">
              {(syncT?.invalidBranch as string) ?? 'Branch names cannot contain spaces, "..", or Git ref control characters.'}
            </p>
          )}
        </Field>

        {/* Connect button + progress */}
        {!connecting && !backgroundInitPending && connectStep !== 4 && (
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton
              onClick={handleConnect}
              disabled={!isValid || !branchValid}
              className="flex min-h-9 items-center gap-2"
            >
              {(syncT?.connectButton as string) ?? 'Connect & Start Sync'}
            </PrimaryButton>
            {disabledReason && (
              <span className="text-xs text-muted-foreground">{disabledReason}</span>
            )}
          </div>
        )}

        {backgroundInitPending && progressHidden && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--amber)]/30 bg-[var(--amber-subtle)] p-3 text-xs text-[var(--amber-text)]" role="status" aria-live="polite">
            <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {(syncT?.initStillRunningTitle as string) ?? 'Sync setup is still running'}
              </p>
              <p>
                {(syncT?.initStillRunningDesc as string)
                  ?? 'MindOS is still configuring the repository in the background. Wait for the result before starting setup again.'}
              </p>
              {connectingRemote && (
                <p className="break-all font-mono text-2xs text-foreground/75">
                  {((syncT?.connectingTo as ((remote: string) => string))?.(connectingRemote)) ?? `Connecting to ${connectingRemote}`}
                </p>
              )}
            </div>
          </div>
        )}

        {(connecting || connectStep === 4) && (
          <div className="space-y-2 py-1">
            {connectingRemote && (
              <p className="text-xs text-muted-foreground">
                {((syncT?.connectingTo as ((remote: string) => string))?.(connectingRemote)) ?? `Connecting to ${connectingRemote}`}
              </p>
            )}
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
            {connecting && (
              <button
                type="button"
                onClick={handleHideProgress}
                className="inline-flex min-h-8 items-center rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(syncT?.hideProgress as string) ?? 'Hide progress'}
              </button>
            )}
            {connectStep === 4 && (
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={13} className="text-success shrink-0" />
                <span className="text-success font-medium">{(syncT?.stepDone as string) ?? 'Sync configured successfully!'}</span>
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
          (syncT?.featureAutoCommit as string) ?? 'Auto-commit on save',
          (syncT?.featureAutoPull as string) ?? 'Auto-pull from remote',
          (syncT?.featureConflict as string) ?? 'Conflict detection',
          (syncT?.featureMultiDevice as string) ?? 'Works across devices',
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
