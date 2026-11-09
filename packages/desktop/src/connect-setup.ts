/**
 * Local-setup panels: install the CLI, build the Web bundle, re-probe the
 * environment, and route between the three states.
 *
 * Split out of connect-renderer.ts, which went back over the 1000-line limit
 * when the boot shell landed. These three panels are one closed loop — each
 * one's success path re-runs the probe and hands off to whichever panel the
 * new state calls for — so they move together.
 *
 * The dead end this shape exists to prevent: the panels used to share one
 * container whose innerHTML was replaced, so once the build panel had been
 * shown there was no install button to go back to.
 */
import {
  $,
  commandFailureParts,
  fitWindowToContent,
  getIpc,
  setLabel,
  setStatus,
} from './connect-dom';
import type { I18nKeys } from './i18n/index';

export type SetupPanel = 'install' | 'build' | 'bundled' | null;

let activeSetupPanel: SetupPanel = null;
let buildModulePath: string | null = null;

/** The mode picker learns the buildable path from its own probe. */
export function setBuildModulePath(value: string | null): void {
  buildModulePath = value;
}

export function showSetupPanel(panel: SetupPanel): void {
  activeSetupPanel = panel;
  for (const name of ['install', 'build', 'bundled'] as const) {
    $(`setup-${name}`)?.classList.toggle('hidden', panel !== name);
  }
  // Offer remote mode whenever local setup is blocked.
  $('setup-remote-btn')?.classList.toggle('hidden', panel === null);
  if (panel) $(`setup-${panel}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  fitWindowToContent();
}

/** Replace a setup panel's heading with a transient state (checking / not found). */
export function setSetupHeading(panel: Exclude<SetupPanel, null>, key: I18nKeys): void {
  setLabel($(`setup-${panel}-title`), key);
}

// ── Build ──
export async function buildMindOS(): Promise<void> {
  const ipc = getIpc();
  const modulePath = buildModulePath;
  if (!ipc || !modulePath) return;

  const buildBtn = $('build-btn') as HTMLButtonElement | null;
  const retryBtn = $('build-retry-btn');
  if (!buildBtn) return;

  buildBtn.disabled = true;
  setLabel(buildBtn, 'building', { busy: true });
  setStatus('build-status', { cls: 'install-progress', parts: ['buildingDesc'] });

  try {
    const result = await ipc.buildMindos(modulePath);
    if (result?.success) {
      buildBtn.classList.add('hidden');
      setStatus('build-status', { cls: 'install-progress success', parts: ['buildSuccess'] });
      await recheckEnvironment();
    } else {
      buildBtn.disabled = false;
      setLabel(buildBtn, 'retryBuild');
      setStatus('build-status', {
        cls: 'install-progress error',
        parts: commandFailureParts(result, 'buildFailed', 'errBuildFailed'),
        detail: result?.stderr,
      });
      retryBtn?.classList.remove('hidden');
    }
  } catch (err) {
    buildBtn.disabled = false;
    setLabel(buildBtn, 'retryBuild');
    setStatus('build-status', {
      cls: 'install-progress error',
      parts: ['buildError', 'labelSeparator', { text: err instanceof Error ? err.message : String(err) }],
    });
  }
}

// ── Install MindOS CLI ──
export async function installMindOS(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const installBtn = $('install-btn') as HTMLButtonElement | null;
  const retryBtn = $('install-retry-btn');
  if (!installBtn) return;

  installBtn.disabled = true;
  setLabel(installBtn, 'installing', { busy: true });
  setStatus('install-status', { cls: 'install-progress', parts: ['installingDesc'] });

  try {
    const result = await ipc.installMindos();
    if (result?.success) {
      installBtn.classList.add('hidden');
      setStatus('install-status', { cls: 'install-progress success', parts: ['installSuccess'] });
      await recheckEnvironment();
    } else {
      installBtn.disabled = false;
      setLabel(installBtn, 'retryInstall');
      setStatus('install-status', {
        cls: 'install-progress error',
        parts: commandFailureParts(result, 'installFailed', 'errInstallFailed'),
        detail: result?.stderr,
      });
      retryBtn?.classList.remove('hidden');
    }
  } catch (err) {
    installBtn.disabled = false;
    setLabel(installBtn, 'retryInstall');
    setStatus('install-status', {
      cls: 'install-progress error',
      parts: ['installError', 'labelSeparator', { text: err instanceof Error ? err.message : String(err) }],
    });
  }
}

// ── Re-check environment ──
/**
 * Re-detect Node + MindOS and route to the matching panel. Previously this only
 * rewrote the current panel's heading, so a "not installed" result left the
 * build panel on screen with no install button — an unrecoverable dead end.
 */
export async function recheckEnvironment(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const panel = activeSetupPanel ?? 'install';
  setSetupHeading(panel, 'checking');

  try {
    const nodeAvailable = await ipc.checkNode();
    if (!nodeAvailable) {
      setSetupHeading(panel, 'missingNode');
      return;
    }

    const mindosStatus = await ipc.checkMindosStatus();

    if (mindosStatus?.status === 'ready') {
      setSetupHeading(panel, 'envReady');
      await ipc.selectMode('local');
    } else if (mindosStatus?.status === 'installed-not-built') {
      buildModulePath = mindosStatus.path ?? buildModulePath;
      setSetupHeading('build', 'cliInstalled');
      showSetupPanel('build');
    } else if (mindosStatus?.status === 'bundled-incomplete') {
      showSetupPanel('bundled');
    } else {
      setSetupHeading('install', 'missingCliStill');
      showSetupPanel('install');
    }
  } catch (err) {
    console.error('[MindOS] recheckEnvironment error:', err);
    setSetupHeading(panel, 'missingCliStill');
  }
}
