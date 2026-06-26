import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('Desktop release packaging contract', () => {
  it('keeps Linux deb package metadata free of scoped npm package names', () => {
    const config = readText('packages/desktop/electron-builder.yml');

    expect(config).toMatch(/^deb:\n  packageName: mindos-desktop\n  artifactName: mindos-desktop_\$\{version\}_\$\{arch\}\.\$\{ext\}$/m);
    expect(config).not.toContain('@mindos/desktop_${version}_${arch}.${ext}');
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

  it('stops MindOS-owned Windows processes before the NSIS running-app check blocks install', () => {
    const nsis = readText('packages/desktop/build/installer.nsh');

    expect(nsis).toContain('!macro customInit');
    expect(nsis).toContain('!macro customCheckAppRunning');
    expect(nsis).toContain('!macro mindosStopRuntimeChildren');
    expect(nsis).toContain('Var mindosRuntimeCleanupDone');
    expect(nsis).toContain('StrCmp $mindosRuntimeCleanupDone "1"');
    expect(nsis).toContain('-NoProfile -NonInteractive -ExecutionPolicy Bypass');
    expect(nsis).toContain('-Filter "Name = \'node.exe\'"');
    expect(nsis).toContain('$PLUGINSDIR\\mindos-runtime-cleanup.ps1');
    expect(nsis).toContain('Get-CimInstance Win32_Process');
    expect(nsis).toContain('"@geminilight\\mindos"');
    expect(nsis).toContain('"\\packages\\web\\.next\\standalone\\server.js"');
    expect(nsis).toContain('"\\dist\\protocols\\mcp-server\\index.cjs"');
    expect(nsis).toContain('/PID $$proc.ProcessId /T /F');
    expect(nsis).toContain('/IM "${APP_EXECUTABLE_FILENAME}" /T /F');
    expect(nsis).toContain('!insertmacro _CHECK_APP_RUNNING');
    expect(nsis).not.toMatch(/taskkill(?:\.exe)?\s+\/IM\s+"?node(?:\.exe)?"?/i);
    expect(nsis).not.toContain('/F /IM node.exe');
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

    expect(config).toContain('externalizeDepsPlugin');
    expect(config).toContain('nodeBuiltins');
    expect(config).toContain("include: ['electron']");
    expect(config).toContain('plugins: [externalizeDepsPlugin');
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

  it('smokes packaged Desktop runtime before release artifacts are uploaded', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const verifier = readText('scripts/verify-desktop-runtime.mjs');
    const smoke = readText('scripts/smoke-desktop-app.mjs');
    const smokeStep = workflow.slice(
      workflow.indexOf('- name: Smoke packaged app'),
      workflow.indexOf('- name: Verify Windows signatures'),
    );

    expect(workflow).toContain('node scripts/verify-desktop-runtime.mjs');
    expect(workflow).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 90000');
    expect(workflow).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 90000 --windows-runtime-only');
    expect(workflow.indexOf('Smoke packaged app')).toBeGreaterThan(workflow.indexOf('Package (${{ matrix.platform }})'));
    expect(workflow.indexOf('Upload artifacts')).toBeGreaterThan(workflow.indexOf('Smoke packaged app'));
    expect(verifier).toContain('isPrunedStandaloneDependency');
    expect(verifier).toContain("packageName.startsWith('@types/')");
    expect(verifier).toContain("'caniuse-lite'");
    // mac x64 smokes under Rosetta on the arm64 runner instead of being skipped
    expect(smoke).toContain("['arch', '-x86_64']");
    expect(smoke).toContain('canRunUnderRosetta');
    expect(workflow).toContain('electron-builder --${{ matrix.platform }} --${{ matrix.arch }} --publish never');
    expect(workflow).not.toContain('--publish always');
    expect(workflow).toContain('WINDOWS_CERTIFICATE_BASE64');
    expect(workflow).toContain('Get-AuthenticodeSignature');
    expect(workflow).toContain('Publishing unsigned Windows artifacts because WINDOWS_CERTIFICATE_BASE64/WINDOWS_CERTIFICATE_PASSWORD are not configured.');
    expect(workflow).toContain('Skipping Windows Authenticode verification because code-signing secrets are not configured; unsigned artifacts will be published.');
    expect(smokeStep).toContain('if [ "${{ matrix.platform }}" = "win" ] && [ "${{ matrix.arch }}" = "arm64" ]; then');
    expect(smokeStep).toContain('if [ "${{ matrix.platform }}" = "mac" ] && [ "${{ matrix.arch }}" = "x64" ]; then');
    expect(smokeStep).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 240000');
    expect(smokeStep.indexOf('matrix.platform }}" = "mac"')).toBeLessThan(smokeStep.indexOf('matrix.platform }}" = "win"'));
    expect(smokeStep).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 90000 --windows-runtime-only');
    expect(smokeStep).toContain('elif [ "${{ matrix.platform }}" = "win" ]; then');
    expect(smokeStep).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 90000 --windows-runtime-fallback');
    expect(workflow).not.toContain('Publishing Windows releases requires WINDOWS_CERTIFICATE_BASE64');
    expect(workflow).toContain('Publishing macOS releases requires sign_mac=true');
    expect(workflow).toContain('No notarization credentials configured for a publish build');
    expect(workflow).toContain('for file in packages/desktop/dist/*.dmg packages/desktop/dist/*.zip; do');
    expect(workflow).toContain('xcrun stapler validate "$file"');
    expect(workflow).toContain('gh release delete-asset "$DESIRED_TAG" "MindOS.Setup.${VERSION}.exe" --yes');
    expect(workflow).toContain('gh release delete-asset "$DESIRED_TAG" "MindOS.Setup.${VERSION}.exe.blockmap" --yes');
    expect(workflow).toContain('copy_alias "artifacts/MindOS-${VERSION}-arm64.dmg" "MindOS-arm64.dmg"');
    expect(workflow).toContain('copy_alias "artifacts/MindOS-${VERSION}.dmg" "MindOS.dmg"');
    expect(workflow).toContain('copy_alias "artifacts/MindOS-Setup-${VERSION}.exe" "MindOS-Setup.exe"');
    expect(workflow).toContain('copy_alias "artifacts/MindOS-Setup-${VERSION}-arm64.exe" "MindOS-Setup-arm64.exe"');
    expect(workflow).toContain('copy_alias "artifacts/MindOS-${VERSION}.AppImage" "MindOS.AppImage"');
    expect(workflow).toContain('copy_alias "artifacts/mindos-desktop_${VERSION}_amd64.deb" "mindos-desktop_amd64.deb"');
    expect(workflow).toContain('gh release view "$DESIRED_TAG" --json assets --jq \'.assets[].name\'');
    expect(workflow).toContain('grep -Fx "$required_asset" /tmp/mindos-desktop-assets.txt');
    expect(workflow).toContain('candidates=(');
    expect(workflow).toContain('artifacts/*.dmg');
    // Only updater feeds (latest*.yml) are published — a bare *.yml/*.yaml glob
    // also uploaded electron-builder's builder-debug/effective-config files
    expect(workflow).toContain('artifacts/latest*.yml');
    expect(workflow).not.toContain('artifacts/*.yaml');
    expect(workflow).toContain('[ -f "$asset" ] && assets+=("$asset")');
    expect(workflow).toContain('gh release upload "$DESIRED_TAG" "${assets[@]}" --clobber');
    expect(workflow).not.toContain('assets=(artifacts/*)');
    expect(workflow).toContain('s/_${VERSION}//g');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('packages/desktop/dist/smoke-logs/**');
    expect(workflow).not.toContain('git tag "$DESIRED_TAG" 2>/dev/null || true');
    expect(workflow).not.toContain('git push origin "$DESIRED_TAG" 2>/dev/null || true');

    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@sinclair/typebox/package.json');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@earendil-works/pi-ai/package.json');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/pi-web-access/index.ts');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/pi-subagents/src/extension/index.ts');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/pi-mcp-adapter/index.ts');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/pi-schedule-prompt/src/tool.ts');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@juicesharp/rpiv-ask-user-question/index.ts');
    expect(verifier).toContain('packages/web/.next/standalone/lib/agent/kb-extension.ts');
    expect(verifier).toContain('packages/web/.next/standalone/lib/agent/subagent-ledger-extension.ts');
    expect(verifier).toContain('packages/web/.next/standalone/lib/schedule-prompt/index.ts');
    expect(verifier).toContain('packages/web/.next/standalone/lib/im/index.ts');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/grammy/package.json');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@slack/web-api/package.json');
    expect(verifier).toContain("import { fileURLToPath } from 'node:url'");
    expect(verifier).toContain("fileURLToPath(new URL('..', import.meta.url))");
    expect(verifier).not.toContain("new URL('..', import.meta.url).pathname");
    expect(verifier).toContain('optional local embedding runtime should not be bundled by default');
    expect(verifier).toContain('@huggingface/transformers/package.json');
    expect(verifier).toContain('dist/protocols/mcp-server/index.cjs');
    expect(verifier).toContain('ERR_MODULE_NOT_FOUND');
    expect(verifier).toContain('Cannot find module');
    expect(verifier).toContain('path.join is not a function');

    expect(smoke).toContain('/api/health');
    expect(smoke).toContain('APPIMAGE_EXTRACT_AND_RUN');
    expect(smoke).toContain("process.platform === 'linux' ? ['--no-sandbox'] : []");
    expect(smoke).toContain("desktopMode: 'local'");
    expect(smoke).toContain('setupPending: false');
    expect(smoke).toContain("MINDOS_DESKTOP_HOME_DIR: home");
    expect(smoke).toContain("MINDOS_DISABLE_CLI_SHIM_PATH_APPEND: '1'");
    expect(smoke).toContain("MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER: '1'");
    expect(smoke).toContain("mindosRuntimePolicy: 'bundled-only'");
    expect(smoke).not.toContain("join(homedir(), '.mindos', 'config.json')");
    expect(smoke).not.toContain("join(userInfo().homedir, '.mindos', 'config.json')");
    expect(smoke).toContain('MINDOS_DESKTOP_CI_LOG: logPath');
    expect(smoke).toContain("ELECTRON_ENABLE_LOGGING: '1'");
    expect(smoke).toContain('dumpDiagnostics');
    expect(smoke).toContain('persistSmokeLogArtifact');
    expect(smoke).toContain("resolve('packages/desktop/dist/smoke-logs')");
    expect(smoke).toContain('spawnWindowsRuntime');
    expect(smoke).toContain('Windows runtime-only smoke from packaged resources');
    expect(smoke).toContain('maybeRunWindowsRuntimeFallback');
    expect(smoke).toContain('Windows runtime fallback');
    expect(smoke).toContain('--windows-runtime-fallback');
    expect(smoke).toContain("'resources', 'mindos-runtime'");
    expect(smoke).toContain("'node', 'node.exe'");
    expect(smoke).toContain("'packages', 'web'");
    expect(smoke).toContain('restoreSeededConfigs');
    expect(smoke).toContain("detached: process.platform !== 'win32'");
    expect(smoke).toContain("process.kill(-pid, 'SIGTERM')");
    expect(smoke).toContain('process.exit(process.exitCode ?? 0)');
    expect(smoke).toContain("resolve('packages/desktop/dist')");
    expect(smoke).toContain("resolve('dist')");
    expect(smoke).toContain("join(desktopDist, 'linux-unpacked', 'MindOS')");
    expect(smoke).toContain("join(desktopDist, 'linux-unpacked', 'mindos')");
    expect(smoke).toContain('/\\.AppImage$/');
    expect(smoke).toContain('root/login did not return the MindOS HTML shell');
    expect(smoke).toContain('MCP bundle not found');
    expect(smoke).toContain('Cannot find module');
    expect(smoke).toContain('Internal Error');
  });
});
