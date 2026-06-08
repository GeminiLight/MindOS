'use client';

import { useEffect, useState, useRef } from 'react';
import {
  GitBranch, Loader2, Check,
  Eye, EyeOff, CheckCircle2, AlertCircle,
} from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { apiFetch } from '@/lib/api';
import { Input, Field, SettingCard, PrimaryButton } from './Primitives';
import { getSyncErrorHint } from '@/lib/sync-ui';

function isValidGitUrl(url: string): 'https' | 'ssh' | false {
  if (/^https:\/\/.+/.test(url)) return 'https';
  if (/^git@[\w.-]+:.+/.test(url)) return 'ssh';
  return false;
}

export default function SyncEmptyState({ t, onInitComplete }: { t: Messages; onInitComplete: () => void }) {
  const syncT = t.settings?.sync as Record<string, unknown> | undefined;

  const [remoteUrl, setRemoteUrl] = useState('');
  const [token, setToken] = useState('');
  const [branch, setBranch] = useState('main');
  const [showToken, setShowToken] = useState(false);
  const [connectStep, setConnectStep] = useState<number>(-1); // -1=idle, 0..3=steps, 4=done
  const [error, setError] = useState('');
  const [connectingRemote, setConnectingRemote] = useState('');
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const connectRunRef = useRef(0);

  const connecting = connectStep >= 0 && connectStep < 4;

  const urlType = remoteUrl.trim() ? isValidGitUrl(remoteUrl.trim()) : null;
  const isValid = urlType === 'https' || urlType === 'ssh';
  const branchValue = branch.trim() || 'main';
  const branchValid = !/[\s~^:?*\[\\\]]/.test(branchValue)
    && !branchValue.includes('..')
    && !branchValue.startsWith('-')
    && !branchValue.endsWith('.')
    && branchValue !== '@';
  const showTokenField = urlType === 'https';
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

  const handleCancel = () => {
    connectRunRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearStepTimers();
    setConnectStep(-1);
    setConnectingRemote('');
    setError('');
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearStepTimers();
    };
  }, []);

  const handleConnect = async () => {
    const runId = connectRunRef.current + 1;
    connectRunRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    const submittedRemote = remoteUrl.trim();
    const submittedBranch = branchValue;

    clearStepTimers();
    setConnectingRemote(submittedRemote);
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
      setConnectStep(4); // success
      setTimeout(() => {
        if (connectRunRef.current === runId) onInitComplete();
      }, 600);
    } catch (err: unknown) {
      if (connectRunRef.current !== runId || controller.signal.aborted) return;
      let msg = err instanceof Error ? err.message : 'Connection failed';
      if (msg.includes('timed out')) {
        msg = (syncT?.timeoutError as string) ?? 'Connection timed out. The remote repository may be large or the network is slow. Please try again.';
      }
      const hint = getSyncErrorHint(msg, submittedRemote, syncT);
      setError(hint ? `${msg}\n${hint}` : msg);
      setConnectStep(-1);
    } finally {
      if (connectRunRef.current === runId) {
        clearStepTimers();
        abortRef.current = null;
        setConnectingRemote('');
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
              (syncT?.setupStepToken as string) ?? 'HTTPS needs a token for private repos',
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
          label={(syncT?.remoteUrl as string) ?? 'Git Remote URL'}
          hint={urlType === 'ssh'
            ? ((syncT?.sshHint as string) ?? 'Requires SSH key on this machine. Verify with: ssh -T git@github.com')
            : undefined
          }
        >
          <Input
            type="text"
            value={remoteUrl}
            onChange={e => { setRemoteUrl(e.target.value); setError(''); }}
            placeholder="git@github.com:user/repo.git"
            disabled={connecting}
            className={`font-mono ${remoteUrl.trim() && !isValid ? 'border-destructive' : ''}`}
          />
          {!remoteUrl.trim() && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
              <span><code className="text-foreground/60 bg-muted/60 px-1 py-0.5 rounded text-2xs">SSH</code> {(syncT?.sshBrief as string) ?? 'one-time key setup, no token needed'}</span>
              <span><code className="text-foreground/60 bg-muted/60 px-1 py-0.5 rounded text-2xs">HTTPS</code> {(syncT?.httpsBrief as string) ?? 'works anywhere, token recommended'}</span>
            </div>
          )}
          {remoteUrl.trim() && !isValid && (
            <p className="text-xs text-destructive mt-1">
              {(syncT?.invalidUrl as string) ?? 'Invalid Git URL — use HTTPS (https://...) or SSH (git@...)'}
            </p>
          )}
        </Field>

        {/* Access Token (HTTPS only) */}
        {showTokenField && (
          <Field
            label={<>{(syncT?.accessToken as string) ?? 'Access Token'} <span className="text-muted-foreground font-normal">{(syncT?.optional as string) ?? '(optional, for private repos)'}</span></>}
            hint={undefined}
          >
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                disabled={connecting}
                className="pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                disabled={connecting}
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showToken ? ((syncT?.hideToken as string) ?? 'Hide token') : ((syncT?.showToken as string) ?? 'Show token')}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {(syncT?.tokenHint as string) ?? 'GitHub:'}{' '}
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
        <Field label={(syncT?.branchLabel as string) ?? 'Branch'}>
          <Input
            type="text"
            value={branch}
            onChange={e => setBranch(e.target.value)}
            placeholder="main"
            disabled={connecting}
            className={`max-w-[200px] font-mono ${!branchValid ? 'border-destructive' : ''}`}
          />
          {!branchValid && (
            <p className="text-xs text-destructive mt-1">
              {(syncT?.invalidBranch as string) ?? 'Branch names cannot contain spaces, "..", or Git ref control characters.'}
            </p>
          )}
        </Field>

        {/* Connect button + progress */}
        {!connecting && connectStep !== 4 && (
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
                onClick={handleCancel}
                className="inline-flex min-h-8 items-center rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(syncT?.cancel as string) ?? 'Cancel'}
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
