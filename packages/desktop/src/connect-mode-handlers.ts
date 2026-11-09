/**
 * Mode-card IPC: what local mode would do on this machine, and how to get it
 * into a runnable state.
 *
 * Split out of connect-window.ts, which had grown past the 1000-line limit
 * once the boot shell started sharing these handlers. The surface plumbing
 * stays there; this is the environment-probing half.
 *
 * One rule holds this together: every answer here comes from
 * `resolveLocalMindOsProjectRoot` — the resolver that actually boots local
 * mode. An earlier copy of these checks drifted out of agreement with it and
 * blocked machines where boot would have succeeded (PR #406).
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { getNodePath, getMindosInstallPath, getEnrichedEnv, getNpmPath } from './node-detect';
import { analyzeMindOsLayout, hasBuildableWebSources, resolveWebAppDir } from './mindos-runtime-layout';
import { resolveLocalMindOsProjectRoot } from './mindos-runtime-resolve';
import { readMindOsConfigFileUncached } from './desktop-config';
import { getDefaultBundledMindOsDirectory } from './mindos-runtime-path';
import { runCommand, runCommandSequence, describeFailure } from './run-command';
import { getUiLang } from './i18n/lang';
import { mtIn } from './i18n/main-strings';

const BUILD_TIMEOUT_MS = 600_000;
const INSTALL_TIMEOUT_MS = 300_000;

export const MODE_SELECT_CHANNELS = [
  'connect:check-node', 'connect:check-mindos-status', 'connect:build-mindos',
  'connect:get-mindos-path', 'connect:install-mindos', 'connect:select-mode',
  'connect:show-node-dialog', 'connect:open-nodejs',
] as const;

/** Registered through the owner-pinned safeHandle in connect-window.ts. */
export type SafeHandle = (channel: string, handler: (...args: any[]) => any) => void;

/**
 * Mode-card handlers: environment probing, install / build, and the choice
 * itself.
 *
 * Extracted from showModeSelectWindow so the boot shell — the same UI hosted
 * in the main window — registers exactly these, rather than growing a second
 * copy of the environment checks. (PR #406 already had to delete one such
 * copy that had drifted out of agreement with the real boot path.)
 */
export function registerModeSelectHandlers(
  safeHandle: SafeHandle,
  resolvedRef: { value: boolean },
  onModeSelected: (mode: 'local' | 'remote') => void,
  dismiss: () => void,
  dialogParent: BrowserWindow,
): void {
    safeHandle('connect:check-node', async () => {
      // Packaged app bundles Node.js; if bundled node is missing,
      // checkMindosStatus will report bundled-incomplete (the real problem).
      if (app.isPackaged) return true;
      return !!(await getNodePath());
    });

    /**
     * Report what local mode would do, using the same resolver that actually
     * boots it.
     *
     * This used to re-implement runtime detection: it ignored
     * MINDOS_RUNTIME_ROOT / config.mindosRuntimeRoot entirely, so a machine
     * where boot succeeds could still be blocked here. Its npm-global
     * fallback also classified any installed package without a `.next` as
     * "installed but not built", including thin shim packages that can never
     * be built. One resolver, one answer.
     */
    safeHandle('connect:check-mindos-status', async () => {
      const nodePath = await getNodePath();
      const config = readMindOsConfigFileUncached();

      let resolved: Awaited<ReturnType<typeof resolveLocalMindOsProjectRoot>>;
      try {
        resolved = await resolveLocalMindOsProjectRoot(config, nodePath ?? '');
      } catch (err) {
        console.error('[MindOS] Runtime resolution failed:', err);
        return { status: 'bundled-incomplete', path: null, detail: (err as Error)?.message };
      }

      if (resolved.ok && resolved.projectRoot) {
        return { status: 'ready', path: resolved.projectRoot };
      }

      // A source checkout can be built in place; a published package cannot.
      if (!app.isPackaged) {
        const dir = getDefaultBundledMindOsDirectory();
        if (dir && hasBuildableWebSources(dir)) {
          return { status: 'installed-not-built', path: dir };
        }
      }

      if (resolved.ok && resolved.needsInstallFallback) {
        const candidate = resolved.userCandidatePath;
        if (candidate && hasBuildableWebSources(candidate)) {
          return { status: 'installed-not-built', path: candidate };
        }
        return { status: 'not-installed', path: null };
      }

      // Resolution failed outright — surface the resolver's own reason rather
      // than a generic "runtime incomplete".
      const detail = resolved.ok ? undefined : (getUiLang() === 'zh' ? resolved.messageZh : resolved.messageEn);
      if (app.isPackaged) {
        return { status: 'bundled-incomplete', path: getDefaultBundledMindOsDirectory() ?? null, detail };
      }
      return { status: 'not-installed', path: null, detail };
    });

    safeHandle('connect:build-mindos', async (_: unknown, modulePath: string) => {
      try {
        const webAppDir = resolveWebAppDir(modulePath);
        const standaloneServer = path.join(webAppDir, '.next', 'standalone', 'server.js');
        const nextDir = path.join(webAppDir, '.next');
        if (existsSync(standaloneServer) || existsSync(nextDir)) {
          return { success: true, output: 'Already built' };
        }

        const nodePath = await getNodePath();
        const enrichedEnv = getEnrichedEnv(nodePath);
        const npmBin = nodePath ? getNpmPath(path.dirname(nodePath)) : 'npm';

        // spawn + bounded tail. promisify(exec) used a 1 MB maxBuffer, which a
        // real `npm install && next build` blows past — the child was killed
        // and a successful build was reported as a failure.
        const result = await runCommandSequence(
          [
            { command: npmBin, args: ['install'] },
            { command: npmBin, args: ['run', 'build'] },
          ],
          { cwd: modulePath, env: enrichedEnv, timeoutMs: BUILD_TIMEOUT_MS },
        );

        if (!result.ok) {
          return { success: false, code: 'errBuildFailed', detail: describeFailure(result), stderr: result.stderr };
        }
        if (!existsSync(nextDir) && !existsSync(standaloneServer)) {
          return {
            success: false,
            code: 'errBuildFailed',
            detail: 'Build completed but packages/web/.next was not produced',
            stderr: result.stderr,
          };
        }
        return { success: true, output: result.stdout || 'Build completed' };
      } catch (err: any) {
        return { success: false, code: 'errBuildFailed', detail: err?.message };
      }
    });

    safeHandle('connect:get-mindos-path', async () => {
      // Check bundled runtime first
      try {
        const bundledDir = getDefaultBundledMindOsDirectory();
        if (bundledDir && existsSync(bundledDir)) {
          const analysis = analyzeMindOsLayout(bundledDir);
          if (analysis.runnable) {
            return { path: bundledDir, source: 'bundled' as const };
          }
        }
      } catch { /* fall through */ }

      // In packaged mode, bundled is the only path
      if (app.isPackaged) return null;

      // Fallback: npm global install (dev mode only)
      const nodePath = await getNodePath();
      const mindosPath = await getMindosInstallPath(nodePath);
      if (mindosPath) {
        const nextDir = path.join(resolveWebAppDir(mindosPath), '.next');
        if (existsSync(nextDir)) {
          return { path: mindosPath, source: 'user' as const };
        }
      }
      return null;
    });

    safeHandle('connect:select-mode', (_: unknown, mode: 'local' | 'remote') => {
      resolvedRef.value = true;
      onModeSelected(mode);
      dismiss();
      return true;
    });

    safeHandle('connect:show-node-dialog', async () => {
      const lang = getUiLang();
      const result = await dialog.showMessageBox(dialogParent, {
        type: 'warning',
        title: i18n[lang].nodeRequiredTitle,
        message: i18n[lang].nodeRequiredMessage,
        detail: i18n[lang].nodeRequiredOptions,
        buttons: [
          i18n[lang].downloadNode,
          i18n[lang].switchRemoteBtn,
          mtIn(lang, 'cancel'),
        ],
        defaultId: 0,
        cancelId: 2,
      });
      if (result.response === 0) return 'install';
      if (result.response === 1) return 'remote';
      return 'cancel';
    });

    safeHandle('connect:open-nodejs', () => {
      shell.openExternal('https://nodejs.org/');
    });

    // Auto-install MindOS CLI
    safeHandle('connect:install-mindos', async () => {
      try {
        const nodePath = await getNodePath();
        const enrichedEnv = getEnrichedEnv(nodePath);
        const npmBin = nodePath ? getNpmPath(path.dirname(nodePath)) : 'npm';

        const result = await runCommand(
          npmBin,
          ['install', '-g', '@geminilight/mindos@latest'],
          { env: enrichedEnv, timeoutMs: INSTALL_TIMEOUT_MS },
        );
        if (!result.ok) {
          return { success: false, code: 'errInstallFailed', detail: describeFailure(result), stderr: result.stderr };
        }

        // Verify installation
        const mindosPath = await getMindosInstallPath(nodePath);
        if (mindosPath) return { success: true };
        return { success: false, code: 'errInstallUnverified', stderr: result.stderr };
      } catch (err: any) {
        return { success: false, code: 'errInstallFailed', detail: err?.message };
      }
    });
}

// Simple i18n helper for Electron dialog
const i18n = {
  zh: {
    nodeRequiredTitle: '需要 Node.js',
    nodeRequiredMessage: '本地模式需要 Node.js 22.19 或更新版本。',
    nodeRequiredOptions: '可以从 nodejs.org 下载安装，装好后回到这里重新选择本地模式；也可以改用远程模式。',
    downloadNode: '下载 Node.js',
    switchRemoteBtn: '改用远程模式',
  },
  en: {
    nodeRequiredTitle: 'Node.js required',
    nodeRequiredMessage: 'Local mode needs Node.js 22.19 or later.',
    nodeRequiredOptions: 'Download it from nodejs.org, then come back and choose Local mode again. Or use Remote mode instead.',
    downloadNode: 'Download Node.js',
    switchRemoteBtn: 'Use Remote Mode',
  },
} as const;
