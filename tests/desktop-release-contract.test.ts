import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

describe('Desktop release packaging contract', () => {
  it('keeps Linux deb package metadata free of scoped npm package names', () => {
    const config = readText('packages/desktop/electron-builder.yml');

    expect(config).toMatch(/^deb:\n  packageName: mindos-desktop\n  artifactName: mindos-desktop_\$\{version\}_\$\{arch\}\.\$\{ext\}$/m);
    expect(config).not.toContain('@mindos/desktop_${version}_${arch}.${ext}');
  });

  it('pins the Linux executable name instead of letting electron-builder derive it from the scoped package name', () => {
    // electron-builder 26 defaults linux.executableName to the lower-cased
    // sanitized package name ("@mindosdesktop") and then rejects the "@".
    const config = readText('packages/desktop/electron-builder.yml');
    const linuxSection = config.slice(config.indexOf('\nlinux:'), config.indexOf('\ndeb:'));
    expect(linuxSection).toContain('executableName: MindOS');
  });

  it('uses scoped executable ownership instead of global name matching', () => {
    const script = readText('packages/desktop/build/installer.nsh');
    expect(script).toContain('-Action Probe -InstallDir "$INSTDIR"');
    expect(script).not.toContain('/IM');
    expect(script).not.toContain('!macro customInit');
  });

  it('builds macOS on the macos-15 image until electron-builder unlocks its keychain correctly on macOS 26', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    expect(workflow).not.toContain('os: macos-latest');
    expect(workflow.match(/os: macos-15\b/g)?.length).toBe(2);
  });

  it('runs the generated Windows cleanup script from the NSIS uninstaller', () => {
    const config = readText('packages/desktop/electron-builder.yml');
    const nsis = readText('packages/desktop/build/installer.nsh');

    expect(config).toContain('include: build/installer.nsh');
    expect(config).toContain('runAfterFinish: false');
    expect(nsis).toContain('!macro customUnInstall');
    expect(nsis).toContain('$PROFILE\\.mindos\\uninstall.bat');
    expect(nsis).toContain('ExecWait');
  });

  it('protects legacy cleanup before invoking the old installer', () => {
    const nsis = readText('packages/desktop/build/installer.nsh');
    expect(nsis).toContain('-Action Protect -ProfileDir');
    expect(nsis).toContain('${ifNot} ${isUpdated}');
    expect(nsis).toContain('--purge');
    expect(nsis.indexOf('-Action Probe')).toBeLessThan(nsis.indexOf('-Action Stop'));
    expect(nsis.indexOf('MessageBox MB_OKCANCEL')).toBeLessThan(nsis.indexOf('-Action Stop'));
  });

  it('builds Windows ARM64 installers with a distinct updater channel and artifact name', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const updater = readText('packages/desktop/src/updater.ts');
    const runtimePrep = readText('packages/desktop/scripts/prepare-mindos-runtime.mjs');
    const runtimeBundle = readText('packages/desktop/scripts/prepare-mindos-bundle.mjs');

    expect(workflow).toContain('platform: win\n            arch: arm64');
    expect(workflow).toContain('publish_channel: latest-arm64');
    expect(workflow).toContain('--config.publish.channel="${{ matrix.publish_channel }}"');
    expect(workflow).toContain('MindOS-Setup-${VERSION}-arm64.\\${ext}');
    expect(workflow).toContain('MindOS-Setup-${VERSION}.\\${ext}');
    expect(workflow).toContain('packages/desktop/dist/*.blockmap');
    expect(updater).toContain("autoUpdater.channel = 'latest-arm64'");
    expect(runtimePrep).toContain('targetNodePlatform');
    expect(runtimePrep).toContain('targetNodeArch');
    expect(runtimePrep).toContain('RUNTIME_DEPENDENCY_SEEDS');
    expect(runtimePrep).toContain('platform: `${targetNodePlatform}-${targetNodeArch}`');
    expect(runtimePrep).not.toContain("spawnSync('tar', ['xzf', tmpFile");
    expect(runtimePrep).toContain('extractTarGzSafe(tmpFile, nodeDest, 1)');
    expect(runtimePrep).toContain('function resolveTarSymlinkTarget(destDir, entryPath, linkName)');
    expect(runtimePrep).toContain('symlinkSync(safeLinkName, entryPath)');
    expect(runtimePrep).toContain('Expand-Archive -LiteralPath');
    expect(runtimePrep).toContain('const NODE_ZIP_EXTRACT_TIMEOUT_MS = 300000');
    expect(runtimePrep).toContain('formatSpawnFailure(zipResult)');
    expect(runtimePrep).toContain('signal=');
    expect(runtimePrep).toContain('Node.js tar entry outside extraction directory');
    expect(runtimePrep).toContain("const symlinkSkipRoots = [path.resolve(dest, 'node')]");
    expect(runtimePrep).toContain('official npm/npx launchers are');
    expect(runtimeBundle).toContain('pruneStandaloneBuildJunk(standaloneDir)');
    expect(runtimeBundle).toContain("'.next/cache'");
    expect(runtimeBundle).toContain("'.next/dev'");
    expect(runtimeBundle).toContain('prunePnpmVirtualStores(standaloneDir)');
    expect(runtimeBundle).toContain('pruneOptionalLocalEmbeddingRuntime(standaloneDir');
    expect(runtimeBundle).toContain('BUILTIN_AGENT_EXTENSION_RUNTIME_DEPENDENCY_SEEDS');
    expect(runtimeBundle).toContain('IM_RUNTIME_DEPENDENCY_SEEDS');
    expect(runtimeBundle).toContain('MINDOS_WEB_RUNTIME_EXTENSION_SOURCE_ENTRIES');
    expect(runtimeBundle).toContain('materializeMindosWebRuntimeExtensionSources(appDir, standaloneDir)');
    expect(runtimeBundle).toContain("'pi-web-access'");
    expect(runtimeBundle).toContain("'pi-subagents'");
    expect(runtimeBundle).toContain("'pi-mcp-adapter'");
    expect(runtimeBundle).toContain("'pi-schedule-prompt'");
    expect(runtimeBundle).toContain("'@juicesharp/rpiv-ask-user-question'");
    expect(runtimeBundle).toContain("'grammy'");
    expect(runtimeBundle).toContain("'@slack/web-api'");
  });

  it('builds macOS updater metadata on architecture-specific channels', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const updater = readText('packages/desktop/src/updater.ts');

    expect(workflow).toContain('platform: mac\n            arch: arm64');
    expect(workflow).toContain('platform: mac\n            arch: x64');
    expect(workflow).toContain('publish_channel: latest-arm64');
    expect(workflow).toContain('publish_channel: latest');
    expect(updater).toContain("process.platform === 'darwin' && process.arch === 'arm64'");
    expect(updater).toContain("autoUpdater.channel = 'latest-arm64'");
  });

  it('resolves default exports of externalized ESM-only dependencies in the CJS main and preload bundles', () => {
    // electron-store 10 is ESM-only. The main bundle is CJS and externalizes
    // every dependency, so `require('electron-store')` yields the module
    // namespace; without `interop: 'auto'` Rollup treats it as the default
    // export and the packaged app dies with "Store is not a constructor".
    const config = readText('packages/desktop/electron.vite.config.ts');
    const mainBlock = config.slice(config.indexOf('  main: {'), config.indexOf('  preload: {'));
    const preloadBlock = config.slice(config.indexOf('  preload: {'), config.indexOf('  renderer: {'));
    expect(mainBlock).toContain("interop: 'auto'");
    expect(preloadBlock).toContain("interop: 'auto'");
  });

  it('requires trusted local renderers for high-impact desktop IPC', () => {
    const main = readText('packages/desktop/src/main.ts');
    const updater = readText('packages/desktop/src/updater.ts');

    for (const channel of [
      'open-mindroot',
      'select-directory',
      'restart-services',
      'check-update',
      'install-update',
      'download-core-update',
      'cancel-core-download',
      'apply-core-update',
      'uninstall-app',
    ]) {
      const source = channel === 'check-update' || channel === 'install-update' ? updater : main;
      expect(source, channel).not.toContain(`ipcMain.handle('${channel}', async () =>`);
      expect(source, channel).not.toContain(`ipcMain.handle('${channel}', () =>`);
    }

    expect(main).toContain("handleLocalOnly('uninstall-app'");
    expect(main).toContain("handleLocalOnly('apply-core-update'");
    expect(main).toContain('installMainWindowNavigationGuard(mainWindow)');
    expect(updater).toContain('opts?.assertTrustedLocalRenderer?.(event,');
  });

  it('keeps Electron main and preload builds externalized for Node runtime modules', () => {
    const config = readText('packages/desktop/electron.vite.config.ts');

    // electron-vite 5 deprecated externalizeDepsPlugin in favour of build.externalizeDeps.
    expect(config).not.toContain('externalizeDepsPlugin');
    expect(config).toContain('nodeBuiltins');
    expect(config).toContain("include: ['electron']");
    expect(config).toContain("externalizeDeps: { include: ['electron'] }");
    expect(config).toContain('external: electronMainExternal');
  });

  it('does not grant macOS DYLD environment entitlement in signed builds', () => {
    const entitlements = readText('packages/desktop/src/entitlements.mac.plist');

    expect(entitlements).not.toContain('com.apple.security.cs.allow-dyld-environment-variables');
  });

  it('keeps Desktop-managed home, tray fallback, and restart ports cross-platform safe', () => {
    const main = readText('packages/desktop/src/main.ts');
    const home = readText('packages/desktop/src/desktop-home.ts');
    const shim = readText('packages/desktop/src/install-cli-shim.ts');
    const resolver = readText('packages/desktop/src/mindos-runtime-resolve.ts');
    const nodeBootstrap = readText('packages/desktop/src/node-bootstrap.ts');
    const nodeDetect = readText('packages/desktop/src/node-detect.ts');
    const sshTunnel = readText('packages/desktop/src/ssh-tunnel.ts');

    expect(home).toContain('process.env.MINDOS_DESKTOP_HOME_DIR');
    // DESKTOP_HOME moved to desktop-config during the main.ts split; main must
    // keep consuming the shared env-overridable home instead of os.homedir()
    expect(readText('packages/desktop/src/desktop-config.ts')).toContain('export const DESKTOP_HOME = getDesktopHome()');
    expect(main).toContain('DESKTOP_HOME,');
    expect(main).toContain('let trayAvailable = false');
    expect(main).toContain('let closingSplashForTransition = false');
    expect(main).toContain('if (!mainWindow && !transitionClose) app.quit();');
    expect(main).toContain('if (!isQuitting && !isUpdating && trayAvailable)');
    expect(main).toContain('if (!trayAvailable && !isQuitting && !isUpdating) app.quit();');
    expect(main).toContain("ensureMindosCliShim({ appendPath: process.env.MINDOS_DISABLE_CLI_SHIM_PATH_APPEND !== '1' })");
    expect(main).toContain('findLocalModePorts');
    expect(main).toContain('if (resolvedMcpPort !== resolvedWebPort)');
    expect(main).toContain('currentWebPort = processManager.webPort;');
    expect(main).toContain('currentMcpPort = processManager.mcpPort;');
    expect(main).toContain("execFileChild('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F']");
    expect(main).toContain('detached: process.platform !== \'win32\'');

    for (const source of [shim, resolver, nodeBootstrap, nodeDetect, sshTunnel]) {
      expect(source).toContain("from './desktop-home'");
    }
    expect(resolver).toContain('process.env.MINDOS_RUNTIME_POLICY');
    expect(nodeBootstrap).not.toContain("app.getPath('home')");
    expect(nodeDetect).not.toContain("app.getPath('home')");
    expect(sshTunnel).toContain('getSshTunnelPidFile');
  });

  it('validates native app readiness and final artifacts before publishing', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const smoke = readText('scripts/smoke-desktop-app.mjs');
    expect(workflow).toContain('node scripts/verify-desktop-runtime.mjs');
    expect(workflow).toContain('os: windows-11-arm');
    expect(workflow).toContain('node scripts/smoke-desktop-app.mjs --timeout 240000');
    expect(workflow).toContain('node scripts/smoke-desktop-app.mjs --timeout 90000');
    expect(workflow).not.toContain('--windows-runtime-fallback');
    expect(workflow).not.toContain('--skip-if-arch-mismatch');
    expect(smoke).toContain('Desktop renderer ready');
    expect(smoke).toContain('AbortSignal.timeout(3000)');
    expect(smoke).toContain("['arch', '-x86_64']");
    expect(smoke).toContain("spawnSync('taskkill'");
    expect(workflow).toContain('Publishing Windows releases requires');
    expect(workflow).toContain('Get-AuthenticodeSignature');
    expect(workflow).toContain('Publishing macOS releases requires sign_mac=true');
    expect(workflow.indexOf('desktop-release-assets.mjs refresh-mac')).toBeGreaterThan(workflow.indexOf('xcrun stapler validate'));
    expect(workflow.indexOf('desktop-release-assets.mjs verify artifacts')).toBeLessThan(workflow.indexOf('gh release upload'));
    expect(workflow.indexOf('desktop-release-assets.mjs verify-upload')).toBeLessThan(workflow.indexOf('--draft=false --latest'));
    expect(workflow).toContain('Release already public; use a new Desktop tag');
    expect(workflow).toContain('artifacts/latest*.yml');
    expect(workflow).not.toContain('artifacts/*.yml');
    expect(workflow).toContain('latest will not be promoted');
    expect(workflow).toContain('Mirror is not verified');
  });
});
