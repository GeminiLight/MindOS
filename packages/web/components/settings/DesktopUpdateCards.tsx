'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Download, RefreshCw, CheckCircle2, AlertCircle, Loader2,
  ExternalLink, Circle, Monitor, ArrowUp,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { getDesktopBridge } from '@/lib/desktop-bridge';
import { useCoreUpdateStore } from '@/lib/stores/core-update-store';
import { SettingCard } from './Primitives';

// Re-exported for existing importers (UpdateTab, badge sync helpers).
export { getDesktopBridge };

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
export const POLL_TIMEOUT = 15 * 60 * 1000; // 15 minutes; legacy fallback build can take 10min+ on slow machines
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

const PRIMARY_BTN =
  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const GHOST_BTN =
  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * MindOS Core = the product version. It is the headline of the Update panel.
 * The store checks + downloads silently in the background; this card is a
 * status display + an explicit "Apply now" escape hatch, not the driver.
 */
export function ProductVersionCard() {
  const { t } = useLocale();
  const u = t.settings.update;
  const { phase, current, latest, size, progress, minDesktopVersion, error, init, checkNow, applyNow } =
    useCoreUpdateStore();

  useEffect(() => { init(); }, [init]);

  return (
    <SettingCard
      icon={<Monitor size={15} />}
      title="MindOS"
      actions={current ? <span className="text-xs font-mono text-muted-foreground">v{current}</span> : null}
      bodyClassName="space-y-3"
    >

      {phase === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          {u?.checking ?? 'Checking for updates...'}
        </div>
      )}

      {phase === 'idle' && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={13} />
          {u?.upToDate ?? "You're up to date"}
        </div>
      )}

      {phase === 'downloading' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-[var(--amber-text)]">
              <Download size={13} />
              {u?.coreFetching ? u.coreFetching(latest) : `Fetching v${latest}`}
            </span>
            <span className="font-mono text-muted-foreground">
              {progress}% / {formatSize(size)}
            </span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-[var(--amber)] transition-all duration-300"
              style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 size={13} />
            {u?.coreReadyAuto ? u.coreReadyAuto(latest) : `v${latest} ready - applies on next restart`}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => void applyNow()} className={PRIMARY_BTN}>
              <RefreshCw size={14} />
              {u?.coreApplyNow ?? 'Apply now'}
            </button>
            <span className="text-[11px] text-muted-foreground/60">{u?.coreApplyHint ?? 'Takes a few seconds'}</span>
          </div>
        </>
      )}

      {phase === 'applying' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin text-[var(--amber)]" />
          {u?.coreApplying ?? 'Applying update...'}
        </div>
      )}

      {phase === 'desktopTooOld' && (
        <div className="rounded-lg border border-dashed border-[var(--amber)]/40 bg-[var(--amber)]/5 px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-2 text-xs text-[var(--amber-text)]">
            <AlertCircle size={13} />
            {u?.coreDesktopTooOld ? u.coreDesktopTooOld(latest) : `v${latest} requires a newer Desktop.`}
          </div>
          <p className="text-[11px] text-muted-foreground pl-[21px]">
            {u?.coreDesktopTooOldHint ?? 'Please update MindOS Desktop first.'} (Desktop ≥ v{minDesktopVersion})
          </p>
        </div>
      )}

      {phase === 'error' && (
        <>
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle size={13} />
            {error || (u?.coreError ?? 'Core update failed.')}
          </div>
          <div className="pt-1">
            <button onClick={() => void checkNow()} className={GHOST_BTN}>
              <RefreshCw size={14} />
              {u?.coreRetry ?? 'Retry'}
            </button>
          </div>
        </>
      )}

      {(phase === 'idle') && (
        <div className="pt-1">
          <button onClick={() => void checkNow()} className={GHOST_BTN}>
            <RefreshCw size={14} />
            {u?.checkButton ?? 'Check for Updates'}
          </button>
        </div>
      )}
    </SettingCard>
  );
}

/**
 * MindOS Desktop shell = the rare, heavy update (electron-updater, needs an
 * app restart). One hook drives both the escalated banner and the compact
 * secondary row so they never diverge.
 */
export type ShellPhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

export interface ShellUpdate {
  appVersion: string;
  available: boolean;
  version: string | null;
  phase: ShellPhase;
  progress: number;
  errorMsg: string;
  canInstall: boolean;
  unsupportedReason: string;
  manualUrl: string;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

export function useShellUpdate(): ShellUpdate {
  const { t } = useLocale();
  const u = t.settings.update;
  const bridge = getDesktopBridge();
  const [phase, setPhase] = useState<ShellPhase>('idle');
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [canInstall, setCanInstall] = useState(true);
  const [unsupportedReason, setUnsupportedReason] = useState('');
  const [manualUrl, setManualUrl] = useState(CHANGELOG_URL);

  const check = useCallback(async () => {
    if (!bridge) return;
    setPhase('checking');
    setErrorMsg('');
    try {
      const r = await bridge.checkUpdate();
      if (r.error) {
        setAvailable(false);
        setVersion(null);
        setPhase('error');
        setErrorMsg(r.error);
        return;
      }
      setAvailable(r.available);
      setVersion(r.version ?? null);
      setCanInstall(r.canInstall !== false);
      setUnsupportedReason(r.unsupportedReason ?? '');
      setManualUrl(r.manualUrl ?? CHANGELOG_URL);
      setPhase('idle');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : (u?.error ?? 'Failed to check for updates.'));
    }
  }, [bridge, u]);

  const install = useCallback(async () => {
    if (!bridge) return;
    if (!canInstall) {
      setPhase('error');
      setErrorMsg(unsupportedReason || (u?.shellManualDesc ?? 'Download the latest Desktop installer from the release page.'));
      return;
    }
    setPhase((prev) => (prev === 'ready' ? 'installing' : 'downloading'));
    setProgress(0);
    try {
      const result = await bridge.installUpdate();
      if (result && result.ok === false) {
        if (result.manualUrl) setManualUrl(result.manualUrl);
        throw new Error(result.error || (u?.error ?? 'Update failed. Please try again.'));
      }
      if (result?.phase === 'installing') setPhase('installing');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : (u?.error ?? 'Update failed. Please try again.'));
    }
  }, [bridge, canInstall, unsupportedReason, u]);

  useEffect(() => {
    if (!bridge) return;
    // Reset on mount; clears stale 'downloading' left over from a restart.
    setPhase('idle');
    bridge.getAppInfo?.().then((info) => {
      if (info?.version) setAppVersion(info.version);
    }).catch(() => {});
    void check();

    const cleanups: Array<() => void> = [];
    if (bridge.onUpdateAvailable) {
      cleanups.push(bridge.onUpdateAvailable((info) => {
        setAvailable(true);
        if (info?.version) setVersion(info.version);
        setCanInstall(info?.canInstall !== false);
        setUnsupportedReason(info?.unsupportedReason ?? '');
        setManualUrl(info?.manualUrl ?? CHANGELOG_URL);
        setErrorMsg('');
        setPhase((prev) => (prev === 'checking' || prev === 'error' ? 'idle' : prev));
      }));
    }
    if (bridge.onUpdateProgress) {
      cleanups.push(bridge.onUpdateProgress((p) => setProgress(Math.round(p.percent))));
    }
    if (bridge.onUpdateReady) {
      cleanups.push(bridge.onUpdateReady(() => setPhase('ready')));
    }
    if (bridge.onUpdateInstalling) {
      cleanups.push(bridge.onUpdateInstalling(() => setPhase('installing')));
    }
    if (bridge.onUpdateError) {
      cleanups.push(bridge.onUpdateError((info) => {
        setPhase('error');
        setErrorMsg(info?.message || (u?.error ?? 'Update failed. Please try again.'));
      }));
    }
    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    appVersion,
    available,
    version,
    phase,
    progress,
    errorMsg,
    canInstall,
    unsupportedReason,
    manualUrl,
    check,
    install,
  };
}

/** Escalated banner: the only "loud" element, shown only when the shell has an update. */
export function ShellUpdateBanner({ shell }: { shell: ShellUpdate }) {
  const { t } = useLocale();
  const u = t.settings.update;
  const isReady = shell.phase === 'ready';
  const isDownloading = shell.phase === 'downloading';
  const isInstalling = shell.phase === 'installing';
  const isError = shell.phase === 'error';
  const requiresManualInstall = !shell.canInstall;
  const errorBeforeKnownUpdate = isError && !shell.available && !shell.version;
  const title = isError
    ? (u?.shellErrorTitle ?? 'Desktop update failed')
    : (u?.shellBannerTitle ? u.shellBannerTitle(shell.version ?? '') : `New app version v${shell.version} available`);
  const description = isError
    ? (shell.errorMsg || (u?.error ?? 'Update failed. Please try again.'))
    : requiresManualInstall
      ? (shell.unsupportedReason || (u?.shellManualDesc ?? 'Download the latest Desktop installer from the release page.'))
      : isInstalling
        ? (u?.desktopInstalling ?? 'Restarting to apply update...')
        : isReady
          ? (u?.desktopReady ?? 'Update downloaded. Restart to apply.')
          : (u?.shellBannerDesc ?? 'Requires downloading and restarting the app.');
  const actionLabel = isError
    ? (u?.retryButton ?? 'Retry Update')
    : isReady
      ? (u?.desktopRestart ?? 'Restart Now')
      : (u?.shellBannerAction ?? 'Download & Restart');

  return (
    <div className="rounded-xl border border-[var(--amber)]/30 bg-gradient-to-b from-[var(--amber)]/10 to-[var(--amber)]/[0.06] p-3.5 flex items-center gap-3">
      <span className="w-[30px] h-[30px] rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] flex items-center justify-center shrink-0">
        {isError ? <AlertCircle size={16} /> : isInstalling ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-foreground leading-snug">
          {title}
        </p>
        <p className="text-xs text-[var(--amber-text)] mt-0.5">
          {description}
        </p>
        {isDownloading && (
          <div className="h-1 rounded-full bg-muted overflow-hidden mt-2">
            <div className="h-full rounded-full bg-[var(--amber)] transition-all duration-300"
              style={{ width: `${Math.max(shell.progress, 3)}%` }} />
          </div>
        )}
      </div>
      {requiresManualInstall ? (
        <a href={shell.manualUrl || CHANGELOG_URL} target="_blank" rel="noopener noreferrer" className={`${PRIMARY_BTN} shrink-0`}>
          <ExternalLink size={14} />
          {u?.shellManualAction ?? 'Open downloads'}
        </a>
      ) : (!isDownloading && !isInstalling) && (
        <button onClick={() => void (errorBeforeKnownUpdate ? shell.check() : shell.install())} className={`${PRIMARY_BTN} shrink-0`}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Compact secondary row: the demoted shell version line. */
export function ShellVersionRow({ shell }: { shell: ShellUpdate }) {
  const { t } = useLocale();
  const u = t.settings.update;
  const hasUpdate = shell.available || shell.phase === 'ready';

  return (
    <div className="flex items-center gap-2.5 text-xs text-muted-foreground px-0.5">
      <Monitor size={14} className="text-muted-foreground/70 shrink-0" />
      <span>{u?.shellRowLabel ?? 'Desktop shell'}</span>
      {hasUpdate && shell.version ? (
        <span className="font-mono">v{shell.appVersion} -&gt; v{shell.version}</span>
      ) : (
        <>
          <span className="font-mono">v{shell.appVersion}</span>
          <span className="text-muted-foreground/40">/</span>
          {shell.phase === 'checking'
            ? <span>{u?.checking ?? 'Checking...'}</span>
            : <span>{u?.shellLatest ?? 'Latest'}</span>}
        </>
      )}
      <span className="flex-1" />
      <button
        onClick={() => void shell.check()}
        disabled={shell.phase === 'checking' || shell.phase === 'downloading' || shell.phase === 'ready' || shell.phase === 'installing'}
        className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 py-0.5"
      >
        <RefreshCw size={12} className={shell.phase === 'checking' ? 'animate-spin' : ''} />
        {u?.shellCheck ?? 'Check'}
      </button>
      <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
        <ExternalLink size={12} />
        {u?.releaseNotes ?? 'Release notes'}
      </a>
    </div>
  );
}
