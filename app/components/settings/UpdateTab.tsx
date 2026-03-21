'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

type UpdateState = 'idle' | 'checking' | 'updating' | 'updated' | 'error' | 'timeout';

const CHANGELOG_URL = 'https://github.com/GeminiLight/MindOS/releases';
const POLL_INTERVAL = 5_000;
const POLL_TIMEOUT = 4 * 60 * 1000; // 4 minutes

export function UpdateTab() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<UpdateState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const originalVersion = useRef<string>('');

  const checkUpdate = useCallback(async () => {
    setState('checking');
    setErrorMsg('');
    try {
      const data = await apiFetch<UpdateInfo>('/api/update-check');
      setInfo(data);
      if (!originalVersion.current) originalVersion.current = data.current;
      setState('idle');
    } catch {
      setState('error');
      setErrorMsg('Failed to check for updates. Check your network connection.');
    }
  }, []);

  // Check on mount
  useEffect(() => { checkUpdate(); }, [checkUpdate]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      clearInterval(pollRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleUpdate = useCallback(async () => {
    setState('updating');
    setErrorMsg('');

    try {
      await apiFetch('/api/update', { method: 'POST' });
    } catch {
      // Expected — server may die during update. Continue polling.
    }

    // Poll for version change (server will restart with new version)
    const startTime = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch<UpdateInfo>('/api/update-check');
        if (data.current !== originalVersion.current) {
          // Version changed → update succeeded
          clearInterval(pollRef.current);
          clearTimeout(timeoutRef.current);
          setInfo(data);
          setState('updated');
          // Auto reload after brief celebration
          setTimeout(() => window.location.reload(), 2000);
          return;
        }
      } catch {
        // Server still restarting — keep polling
      }

      if (Date.now() - startTime > POLL_TIMEOUT) {
        clearInterval(pollRef.current);
        setState('timeout');
      }
    }, POLL_INTERVAL);

    timeoutRef.current = setTimeout(() => {
      clearInterval(pollRef.current);
      setState('timeout');
    }, POLL_TIMEOUT);
  }, []);

  return (
    <div className="space-y-5">
      {/* Version Card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">MindOS</span>
          {info && (
            <span className="text-xs font-mono text-muted-foreground">
              v{info.current}
            </span>
          )}
        </div>

        {/* Status */}
        {state === 'checking' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />
            Checking for updates...
          </div>
        )}

        {state === 'idle' && info && !info.hasUpdate && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} />
            You&apos;re up to date
          </div>
        )}

        {state === 'idle' && info?.hasUpdate && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--amber)' }}>
            <Download size={13} />
            Update available: v{info.current} → v{info.latest}
          </div>
        )}

        {state === 'updating' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--amber)' }}>
              <Loader2 size={13} className="animate-spin" />
              Updating MindOS... The server will restart shortly.
            </div>
            <p className="text-2xs text-muted-foreground">
              This may take 1–3 minutes. Do not close this page.
            </p>
          </div>
        )}

        {state === 'updated' && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} />
            Updated successfully! Reloading...
          </div>
        )}

        {state === 'timeout' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle size={13} />
              Update may still be in progress.
            </div>
            <p className="text-2xs text-muted-foreground">
              Check your terminal: <code className="font-mono bg-muted px-1 py-0.5 rounded">mindos logs</code>
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle size={13} />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={checkUpdate}
          disabled={state === 'checking' || state === 'updating'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={12} className={state === 'checking' ? 'animate-spin' : ''} />
          Check for Updates
        </button>

        {info?.hasUpdate && state !== 'updating' && state !== 'updated' && (
          <button
            onClick={handleUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium text-white transition-colors"
            style={{ background: 'var(--amber)' }}
          >
            <Download size={12} />
            Update to v{info.latest}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="border-t border-border pt-4 space-y-2">
        <a
          href={CHANGELOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink size={12} />
          View release notes
        </a>
        <p className="text-2xs text-muted-foreground/60">
          Updates are installed via npm. Equivalent to running <code className="font-mono bg-muted px-1 py-0.5 rounded">mindos update</code> in your terminal.
        </p>
      </div>
    </div>
  );
}
