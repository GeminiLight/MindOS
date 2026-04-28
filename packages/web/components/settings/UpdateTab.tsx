'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink, Circle, Monitor } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';

import {
  getDesktopBridge, DesktopCoreCard, DesktopShellCard,
  StageIcon, formatSize,
  type UpdateInfo, type UpdateState, type StageInfo, type UpdateStatus,
  CHANGELOG_URL, POLL_INTERVAL, POLL_TIMEOUT, UPDATE_STATE_KEY, STAGE_LABELS,
} from './DesktopUpdateCards';

/** Router: Desktop uses electron-updater IPC; browser/CLI uses npm API */
export function UpdateTab() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [isLocal, setIsLocal] = useState(true);
  useEffect(() => {
    const bridge = getDesktopBridge();
    setIsDesktop(!!bridge);
    if (bridge?.getAppInfo) {
      bridge.getAppInfo().then((info) => {
        if (info && 'mode' in info) setIsLocal((info as { mode?: string }).mode !== 'remote');
      }).catch(() => {});
    }
  }, []);
  if (isDesktop) {
    return (
      <div className="space-y-6">
        {isLocal && <DesktopCoreCard />}
        <DesktopShellCard />
      </div>
    );
  }
  return <BrowserUpdateTab />;
}

/** Browser / CLI update: uses npm registry check + POST /api/update */
function BrowserUpdateTab() {
  const { t, locale } = useLocale();
  const u = t.settings.update;
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<UpdateState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [serverDown, setServerDown] = useState(false);
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
      if (!data.hasUpdate) {
        localStorage.removeItem('mindos_update_latest');
        localStorage.removeItem('mindos_update_dismissed');
        window.dispatchEvent(new Event('mindos:update-dismissed'));
      } else {
        const dismissed = localStorage.getItem('mindos_update_dismissed');
        localStorage.setItem('mindos_update_latest', data.latest);
        window.dispatchEvent(new Event(
          data.latest === dismissed ? 'mindos:update-dismissed' : 'mindos:update-available',
        ));
      }
      setState('idle');
    } catch {
      setState('error');
      setErrorMsg(u?.error ?? 'Failed to check for updates.');
    }
  }, [u]);

  const cleanup = useCallback(() => {
    clearInterval(pollRef.current);
    clearTimeout(timeoutRef.current);
  }, []);

  /** Mark update complete: clear badge, set state, schedule reload. */
  const completeUpdate = useCallback((data: UpdateInfo) => {
    cleanup();
    setInfo(data);
    setState('updated');
    localStorage.removeItem('mindos_update_latest');
    localStorage.removeItem('mindos_update_dismissed');
    localStorage.removeItem(UPDATE_STATE_KEY);
    window.dispatchEvent(new Event('mindos:update-dismissed'));
    setTimeout(() => window.location.reload(), 2000);
  }, [cleanup]);

  /** Start polling for update progress */
  const startPolling = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const status = await apiFetch<UpdateStatus>('/api/update-status', { timeout: 5000 });
        setServerDown(false);

        if (status.stages?.length > 0) {
          setStages(status.stages);
        }

        if (status.stage === 'failed') {
          cleanup();
          localStorage.removeItem(UPDATE_STATE_KEY);
          setUpdateError(status.error || 'Update failed');
          setState('error');
          return;
        }

        if (status.stage === 'done') {
          try {
            const data = await apiFetch<UpdateInfo>('/api/update-check');
            if (data.current !== originalVersion.current) {
              completeUpdate(data);
              return;
            }
          } catch { /* new server may not be fully ready */ }
        }
      } catch {
        // Server restarting — try update-check as fallback
        setServerDown(true);
        try {
          const data = await apiFetch<UpdateInfo>('/api/update-check', { timeout: 5000 });
          if (data.current && data.current !== originalVersion.current) {
            setStages(prev => prev.map(s => ({ ...s, status: 'done' as const })));
            completeUpdate(data);
          }
        } catch {
          // Both endpoints down — server still restarting
        }
      }
    }, POLL_INTERVAL);

    timeoutRef.current = setTimeout(() => {
      cleanup();
      localStorage.removeItem(UPDATE_STATE_KEY);
      setState('timeout');
    }, POLL_TIMEOUT);
  }, [cleanup, completeUpdate]);

  // On mount: check if an update was in progress (survives page reload / white screen)
  useEffect(() => {
    const savedState = localStorage.getItem(UPDATE_STATE_KEY);
    if (savedState) {
      try {
        const { originalVer } = JSON.parse(savedState);
        originalVersion.current = originalVer;
        setState('updating');
        setServerDown(true);
        setStages([
          { id: 'downloading', status: 'done' },
          { id: 'skills',      status: 'done' },
          { id: 'rebuilding',  status: 'done' },
          { id: 'restarting',  status: 'running' },
        ]);
        startPolling();
      } catch {
        localStorage.removeItem(UPDATE_STATE_KEY);
        checkUpdate();
      }
    } else {
      checkUpdate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleUpdate = useCallback(async () => {
    setState('updating');
    setErrorMsg('');
    setUpdateError(null);
    setServerDown(false);
    setStages([
      { id: 'downloading', status: 'pending' },
      { id: 'skills',      status: 'pending' },
      { id: 'rebuilding',  status: 'pending' },
      { id: 'restarting',  status: 'pending' },
    ]);

    // Persist update state to localStorage — survives process restart / page reload
    localStorage.setItem(UPDATE_STATE_KEY, JSON.stringify({
      originalVer: originalVersion.current || info?.current,
      startedAt: Date.now(),
    }));
    // Notify UpdateOverlay (same-tab, storage event doesn't fire for same-tab writes)
    window.dispatchEvent(new Event('mindos:update-started'));

    try {
      await apiFetch('/api/update', { method: 'POST' });
    } catch (err) {
      if (err instanceof ApiError) {
        localStorage.removeItem(UPDATE_STATE_KEY);
        setUpdateError(err.message || 'Update failed');
        setState('error');
        return;
      }
      // Expected — server may die during update
    }

    startPolling();
  }, [startPolling, info]);

  const handleRetry = useCallback(() => {
    setUpdateError(null);
    handleUpdate();
  }, [handleUpdate]);

  const lang = locale === 'zh' ? 'zh' : 'en';
  const doneCount = stages.filter(s => s.status === 'done').length;
  const progress = stages.length > 0 ? Math.round((doneCount / stages.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Version Card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">MindOS</span>
          {info && (
            <span className="text-xs font-mono text-muted-foreground">v{info.current}</span>
          )}
        </div>

        {state === 'checking' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />
            {u?.checking ?? 'Checking for updates...'}
          </div>
        )}

        {state === 'idle' && info && !info.hasUpdate && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 size={13} />
            {u?.upToDate ?? "You're up to date"}
          </div>
        )}

        {state === 'idle' && info?.hasUpdate && (
          <div className="flex items-center gap-2 text-xs text-[var(--amber-text)]">
            <Download size={13} />
            {u?.available ? u.available(info.current, info.latest) : `Update available: v${info.current} → v${info.latest}`}
          </div>
        )}

        {state === 'updating' && (
          <div className="space-y-3">
            {/* Stage list */}
            <div className="space-y-1.5">
              {stages.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <StageIcon status={s.status} />
                  <span className={s.status === 'pending' ? 'text-muted-foreground/50' : s.status === 'running' ? 'text-foreground' : 'text-muted-foreground'}>
                    {STAGE_LABELS[s.id]?.[lang] ?? s.id}
                  </span>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--amber)] transition-all duration-500 ease-out"
                style={{ width: `${Math.max(progress, 5)}%` }}
              />
            </div>

            <p className="text-2xs text-muted-foreground">
              {serverDown
                ? (u?.serverRestarting ?? 'Server is restarting, please wait...')
                : (u?.updatingHint ?? 'This may take 1–3 minutes. Do not close this page.')}
            </p>
          </div>
        )}

        {state === 'updated' && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 size={13} />
            {u?.updated ?? 'Updated successfully! Reloading...'}
          </div>
        )}

        {state === 'timeout' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-[var(--amber-text)]">
              <AlertCircle size={13} />
              {u?.timeout ?? 'Update may still be in progress.'}
            </div>
            <p className="text-2xs text-muted-foreground">
              {u?.timeoutHint ?? 'The server may need more time to rebuild. Try refreshing.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw size={12} />
              {u?.refreshButton ?? 'Refresh Page'}
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle size={13} />
              {updateError || errorMsg}
            </div>
            {updateError && (
              <button
                onClick={handleRetry}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <RefreshCw size={12} />
                {u?.retryButton ?? 'Retry Update'}
              </button>
            )}
          </div>
        )}
        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={checkUpdate}
            disabled={state === 'checking' || state === 'updating'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={14} className={state === 'checking' ? 'animate-spin' : ''} />
            {u?.checkButton ?? 'Check for Updates'}
          </button>

          {info?.hasUpdate && state !== 'updating' && state !== 'updated' && (
            <button
              onClick={handleUpdate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors"
            >
              <Download size={14} />
              {u?.updateButton ? u.updateButton(info.latest) : `Update to v${info.latest}`}
            </button>
          )}
        </div>

        {/* Info */}
        <div className="border-t border-border/50 pt-3 space-y-2">
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink size={12} />
            {u?.releaseNotes ?? 'View release notes'}
          </a>
          <p className="text-2xs text-muted-foreground/60">
            {u?.hint ?? 'Updates are installed via npm. Equivalent to running'} <code className="font-mono bg-muted px-1 py-0.5 rounded">mindos update</code> {u?.inTerminal ?? 'in your terminal.'}
          </p>
        </div>
      </div>
    </div>
  );
}
