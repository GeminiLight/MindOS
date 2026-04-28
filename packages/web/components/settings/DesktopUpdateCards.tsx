'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink, Circle, Monitor } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

interface MindosDesktopBridge {
  checkUpdate: () => Promise<{ available: boolean; version?: string }>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable?: (cb: (info: { version?: string }) => void) => () => void;
  onUpdateProgress?: (cb: (progress: { percent: number }) => void) => () => void;
  onUpdateReady?: (cb: () => void) => () => void;
  onUpdateError?: (cb: (info: { message?: string }) => void) => () => void;
  getAppInfo?: () => Promise<{ version?: string; mode?: string }>;
  // Core Hot Update
  checkCoreUpdate?: () => Promise<{
    available: boolean; currentVersion: string; latestVersion: string;
    urls: string[]; size: number; sha256: string;
    minDesktopVersion: string; desktopTooOld: boolean;
  }>;
  downloadCoreUpdate?: (urls: string[], version: string, size: number, sha256: string) => Promise<void>;
  cancelCoreDownload?: () => Promise<void>;
  applyCoreUpdate?: () => Promise<{ ok: boolean; version?: string }>;
  getCoreUpdatePending?: () => Promise<{ version: string | null }>;
  onCoreUpdateProgress?: (cb: (progress: { percent: number; transferred: number; total: number }) => void) => () => void;
  onCoreUpdateAvailable?: (cb: (info: { current: string; latest: string; ready?: boolean }) => void) => () => void;
}

export function getDesktopBridge(): MindosDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { mindos?: MindosDesktopBridge };
  return w.mindos?.checkUpdate ? (w.mindos as MindosDesktopBridge) : null;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

export interface StageInfo {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface UpdateStatus {
  stage: string;
  stages: StageInfo[];
  error: string | null;
  version: { from: string | null; to: string | null } | null;
  startedAt: string | null;
}

export type UpdateState = 'idle' | 'checking' | 'updating' | 'updated' | 'error' | 'timeout';

export const CHANGELOG_URL = 'https://github.com/GeminiLight/MindOS/releases';
export const POLL_INTERVAL = 3_000;
export const POLL_TIMEOUT = 15 * 60 * 1000; // 15 minutes — legacy fallback build can take 10min+ on slow machines
export const UPDATE_STATE_KEY = 'mindos_update_in_progress';

export const STAGE_LABELS: Record<string, { en: string; zh: string }> = {
  downloading: { en: 'Downloading update', zh: '下载更新' },
  skills:      { en: 'Updating skills', zh: '更新 Skills' },
  rebuilding:  { en: 'Rebuilding app', zh: '重新构建应用' },
  restarting:  { en: 'Restarting server', zh: '重启服务' },
};

export function StageIcon({ status }: { status: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={14} className="text-success shrink-0" />;
    case 'running':
      return <Loader2 size={14} className="animate-spin shrink-0 text-[var(--amber)]" />;
    case 'failed':
      return <AlertCircle size={14} className="text-destructive shrink-0" />;
    default:
      return <Circle size={14} className="text-muted-foreground/40 shrink-0" />;
  }
}

/** Format bytes to human-readable */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Desktop Core update card — downloads runtime packages, restarts services only */
export function DesktopCoreCard() {
  const { t } = useLocale();
  const u = t.settings.update;
  const bridge = getDesktopBridge()!;

  type CoreState = 'idle' | 'checking' | 'available' | 'downloading' | 'cancelling' | 'ready' | 'applying' | 'error' | 'desktopTooOld';
  const [state, setState] = useState<CoreState>('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState('');
  const [updateInfo, setUpdateInfo] = useState<{
    urls: string[]; size: number; sha256: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [minDesktopVersion, setMinDesktopVersion] = useState('');

  useEffect(() => {
    // Always fetch current version first
    const init = async () => {
      // Get current Core version via a check call (also probes for updates)
      try {
        const info = await bridge.checkCoreUpdate?.();
        if (info) {
          setCurrentVersion(info.currentVersion);
          // CRITICAL FIX: If no update available, explicitly set state to 'idle'
          // This ensures the UI refreshes to show the new (current) version
          if (!info.available) {
            setState('idle');
            return;
          }
        }
      } catch { /* ignore */ }

      // Check for pending download (from previous session)
      try {
        const r = await bridge.getCoreUpdatePending?.();
        if (r?.version) {
          setLatestVersion(r.version);
          setState('ready');
          return;
        }
      } catch { /* ignore */ }

      // Otherwise do a full remote check
      handleCheck();
    };
    init();

    const cleanups: Array<() => void> = [];
    if (bridge.onCoreUpdateProgress) {
      cleanups.push(bridge.onCoreUpdateProgress((p) => setProgress(Math.round(p.percent))));
    }
    if (bridge.onCoreUpdateAvailable) {
      cleanups.push(bridge.onCoreUpdateAvailable((info) => {
        setCurrentVersion(info.current);
        setLatestVersion(info.latest);
        setState(info.ready ? 'ready' : 'available');
      }));
    }
    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheck = async () => {
    if (!bridge.checkCoreUpdate) return;
    setState('checking');
    setErrorMsg('');
    try {
      const info = await bridge.checkCoreUpdate();
      setCurrentVersion(info.currentVersion);
      if (info.desktopTooOld) {
        setLatestVersion(info.latestVersion);
        setMinDesktopVersion(info.minDesktopVersion);
        setState('desktopTooOld');
      } else if (info.available) {
        setLatestVersion(info.latestVersion);
        setUpdateInfo({ urls: info.urls, size: info.size, sha256: info.sha256 });
        setState('available');
      } else {
        setState('idle');
      }
    } catch {
      setState('idle'); // Silent — can't reach CDN, not an error
    }
  };

  const handleDownload = async () => {
    if (!bridge.downloadCoreUpdate || !updateInfo) return;
    setState('downloading');
    setProgress(0);
    try {
      await bridge.downloadCoreUpdate(updateInfo.urls, latestVersion, updateInfo.size, updateInfo.sha256);
      setState('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted')) {
        // User cancelled — go back to available
        setState('available');
      } else {
        setState('error');
        setErrorMsg(msg || 'Download failed');
      }
    }
  };

  const handleCancel = () => {
    bridge.cancelCoreDownload?.();
    // Don't immediately go to 'available' — the download IPC will reject with 'aborted',
    // and the catch in handleDownload will set state to 'error'. We set 'cancelling' to
    // block re-entry, and handleDownload's catch will detect the abort and go to 'available'.
    setState('cancelling');
  };

  const handleApply = async () => {
    if (!bridge.applyCoreUpdate) return;
    setState('applying');
    try {
      const result = await bridge.applyCoreUpdate();
      // CRITICAL FIX: Update currentVersion to the version returned by the main process
      // This ensures the UI immediately shows the new version after the update is applied
      if (result?.version) {
        setCurrentVersion(result.version);
      }
      setState('idle');
      // Page will be reloaded by main process
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Apply failed');
    }
  };

  // Don't show if no Core update bridge available
  if (!bridge.checkCoreUpdate) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{u?.coreTitle ?? 'MindOS Core'}</span>
        {currentVersion && <span className="text-xs font-mono text-muted-foreground">v{currentVersion}</span>}
      </div>

      {state === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          {u?.checking ?? 'Checking for updates...'}
        </div>
      )}

      {state === 'idle' && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={13} />
          {u?.coreUpToDate ?? 'Core is up to date'}
        </div>
      )}

      {state === 'available' && (
        <div className="flex items-center gap-2 text-xs text-[var(--amber-text)]">
          <Download size={13} />
          v{latestVersion} {u?.coreAvailable ? u.coreAvailable(formatSize(updateInfo?.size ?? 0)) : `available (${formatSize(updateInfo?.size ?? 0)})`}
        </div>
      )}

      {(state === 'downloading' || state === 'cancelling') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-foreground">
              <Loader2 size={13} className="animate-spin text-[var(--amber)]" />
              {state === 'cancelling'
                ? (u?.coreCancel ?? 'Cancelling...')
                : <>{ u?.coreDownloading ?? 'Downloading...'} v{latestVersion}</>}
            </div>
            {state === 'downloading' && (
              <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground transition-colors">
                {u?.coreCancel ?? 'Cancel'}
              </button>
            )}
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-[var(--amber)] transition-all duration-300"
              style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      )}

      {state === 'ready' && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={13} />
          v{latestVersion} {u?.coreReady ?? 'ready — restart services to apply'}
        </div>
      )}

      {state === 'applying' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin text-[var(--amber)]" />
          {u?.coreApplying ?? 'Applying update...'}
        </div>
      )}

      {state === 'desktopTooOld' && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-[var(--amber-text)]">
            <AlertCircle size={13} />
            {u?.coreDesktopTooOld ? u.coreDesktopTooOld(latestVersion) : `v${latestVersion} requires a newer Desktop.`}
          </div>
          <p className="text-2xs text-muted-foreground">
            {u?.coreDesktopTooOldHint ?? 'Please update MindOS Desktop first.'} (Desktop ≥ v{minDesktopVersion})
          </p>
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle size={13} />
          {errorMsg || (u?.coreError ?? 'Core update failed.')}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {(state === 'idle' || state === 'error') && (
          <button onClick={handleCheck} disabled={state !== 'idle' && state !== 'error'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <RefreshCw size={14} />
            {u?.checkButton ?? 'Check for Updates'}
          </button>
        )}

        {state === 'available' && (
          <button onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors">
            <Download size={14} />
            {u?.updateButton ? u.updateButton(latestVersion) : `Update to v${latestVersion}`}
          </button>
        )}

        {state === 'ready' && (
          <button onClick={handleApply}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors">
            <RefreshCw size={14} />
            {u?.coreRestartServices ?? 'Restart Services'}
          </button>
        )}

        {state === 'error' && (
          <button onClick={updateInfo ? handleDownload : handleCheck}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <RefreshCw size={14} />
            {u?.coreRetry ?? 'Retry'}
          </button>
        )}
      </div>

      <p className="text-2xs text-muted-foreground/60">
        {u?.coreHint ?? 'Core updates only restart services — no app restart needed.'}
      </p>
    </div>
  );
}

/** Desktop shell update card — uses electron-updater (requires app restart) */
export function DesktopShellCard() {
  const { t } = useLocale();
  const u = t.settings.update;
  const bridge = getDesktopBridge()!;
  const [state, setState] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'error'>('idle');
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // CRITICAL: Reset state on mount to clear stale state after app restart
    // (without this, 'state' can be 'downloading' from before the restart)
    setState('idle');
    
    bridge.getAppInfo?.().then((info) => {
      if (info?.version) setAppVersion(info.version);
    }).catch((err) => { console.warn("[UpdateTab] getAppInfo failed:", err); });
    handleCheck();
    const cleanups: Array<() => void> = [];
    if (bridge.onUpdateAvailable) {
      cleanups.push(bridge.onUpdateAvailable((info) => {
        setAvailable(true);
        if (info?.version) setVersion(info.version);
        // Move to idle so the "Update to vX.Y.Z" button appears
        setState((prev) => prev === 'checking' ? 'idle' : prev);
      }));
    }
    if (bridge.onUpdateProgress) {
      cleanups.push(bridge.onUpdateProgress((p) => setProgress(Math.round(p.percent))));
    }
    if (bridge.onUpdateReady) {
      cleanups.push(bridge.onUpdateReady(() => setState('ready')));
    }
    if (bridge.onUpdateError) {
      cleanups.push(bridge.onUpdateError((info) => {
        setState('error');
        setErrorMsg(info?.message || 'Update failed. Please try again.');
      }));
    }
    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheck = async () => {
    setState('checking');
    setErrorMsg('');
    try {
      const r = await bridge.checkUpdate();
      setAvailable(r.available);
      if (r.version) setVersion(r.version);
      setState('idle');
    } catch {
      setState('error');
      setErrorMsg(u?.error ?? 'Failed to check for updates.');
    }
  };

  const handleInstall = async () => {
    setState('downloading');
    setProgress(0);
    try {
      await bridge.installUpdate();
    } catch {
      setState('error');
      setErrorMsg('Update failed. Please try again.');
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{u?.shellTitle ?? 'MindOS Desktop'}</span>
        </div>
        {appVersion && <span className="text-xs font-mono text-muted-foreground">v{appVersion}</span>}
      </div>

      {state === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          {u?.checking ?? 'Checking for updates...'}
        </div>
      )}

      {state === 'idle' && !available && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={13} />
          {u?.upToDate ?? "You're up to date"}
        </div>
      )}

      {state === 'idle' && available && (
        <div className="flex items-center gap-2 text-xs text-[var(--amber-text)]">
          <Download size={13} />
          {version ? `Update available: v${version}` : 'Update available'}
        </div>
      )}

      {state === 'downloading' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-foreground">
            <Loader2 size={13} className="animate-spin text-[var(--amber)]" />
            {u?.desktopDownloading ?? 'Downloading update...'}
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-[var(--amber)] transition-all duration-300"
              style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      )}

      {state === 'ready' && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={13} />
          {u?.desktopReady ?? 'Update downloaded. Restart to apply.'}
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle size={13} />
          {errorMsg}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleCheck} disabled={state === 'checking' || state === 'downloading'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <RefreshCw size={14} className={state === 'checking' ? 'animate-spin' : ''} />
          {u?.checkButton ?? 'Check for Updates'}
        </button>

        {state === 'idle' && available && (
          <button onClick={handleInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors">
            <Download size={14} />
            {version ? `Update to v${version}` : 'Update'}
          </button>
        )}

        {state === 'ready' && (
          <button onClick={async () => {
              try { await bridge.installUpdate(); }
              catch { setState('error'); setErrorMsg(u?.error ?? 'Failed to install update.'); }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors">
            <RefreshCw size={14} />
            {u?.desktopRestart ?? 'Restart Now'}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="border-t border-border/50 pt-3 space-y-2">
        <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ExternalLink size={12} />
          {u?.releaseNotes ?? 'View release notes'}
        </a>
        <p className="text-2xs text-muted-foreground/60">
          {u?.desktopHint ?? 'Updates are delivered through the Desktop app auto-updater.'}
        </p>
      </div>
    </div>
  );
}
