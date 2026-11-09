import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(__dirname, 'main.ts'), 'utf-8');
/** Local-mode boot, crash recovery and the build spawn moved out of main.ts. */
const localMode = readFileSync(path.join(__dirname, 'local-mode.ts'), 'utf-8');
/** Renderer-facing IPC, the external-open guard and uninstall moved here. */
const ipcSource = readFileSync(path.join(__dirname, 'ipc-handlers.ts'), 'utf-8');

describe('desktop main startup contract', () => {
  it('acquires the single-instance lock before any heal/boot logic runs', () => {
    expect(source).toContain('app.requestSingleInstanceLock()');
    expect(source).toContain("app.on('second-instance'");
    // whenReady must bail for the losing instance before healPreviousInstallation
    // (heal kills processes on the configured ports — i.e. the FIRST instance's servers)
    const whenReady = source.indexOf('app.whenReady().then(');
    const lockGuard = source.indexOf('if (!hasSingleInstanceLock) return;');
    const heal = source.indexOf('await healPreviousInstallation(');
    expect(whenReady).toBeGreaterThan(-1);
    expect(lockGuard).toBeGreaterThan(whenReady);
    expect(heal).toBeGreaterThan(lockGuard);
  });

  it('routes every navigation-denied URL through the external-open guard', () => {
    expect(ipcSource).toContain("import { isSafeExternalUrl } from './open-external-guard';");
    expect(ipcSource).toContain('function openExternalGuarded(');
    // The only dynamic-URL openExternal lives inside the guarded helper;
    // any other call site must be a hard-coded https constant.
    expect(ipcSource.split('shell.openExternal(url)').length - 1).toBe(1);
    const dynamicish = ipcSource
      .split('shell.openExternal(')
      .slice(1)
      .filter((rest) => !rest.startsWith('url)') && !rest.startsWith("'https://"));
    expect(dynamicish).toEqual([]);
  });

  it('spawns .cmd targets via quoted cmd.exe argv instead of shell:true', () => {
    expect(source).not.toContain('shell: needsShell');
    expect(localMode).not.toContain('shell: true');
    expect(localMode).toContain('resolveExecTarget(bin, args)');
  });

  it('saves window state synchronously at quit (debounced timer never fires before app.exit)', () => {
    expect(source).toContain('saveWindowStateNow(shellState.mainWindow)');
  });

  it('uses the per-platform uninstall plan instead of bare trashItem', () => {
    expect(ipcSource).toContain("import { planUninstall } from './uninstall-plan';");
    expect(ipcSource).toContain('planUninstall({');
  });

  it('defers CLI shim install until after the boot shell is showing (never blocks first paint)', () => {
    const whenReady = source.indexOf('app.whenReady().then(');
    expect(whenReady).toBeGreaterThan(-1);
    const startupSlice = source.slice(whenReady);

    // The shim install (PowerShell PATH step on Windows) is scheduled via the
    // deferral helper, after the window has something to paint — not invoked
    // inline before it.
    const ensureIdx = startupSlice.indexOf(
      "ensureMindosCliShim({ appendPath: process.env.MINDOS_DISABLE_CLI_SHIM_PATH_APPEND !== '1' })",
    );
    expect(ensureIdx).toBeGreaterThan(-1);
    expect(startupSlice).toContain('scheduleCliShimInstall(win,');

    const shellIdx = startupSlice.indexOf('showBootShell(win,');
    expect(shellIdx).toBeGreaterThan(-1);
    expect(ensureIdx).toBeGreaterThan(shellIdx);
  });

  it('creates the main window before healing, so startup has exactly one window', () => {
    const whenReady = source.indexOf('app.whenReady().then(');
    const startupSlice = source.slice(whenReady);

    // Startup used to open a mode-select dialog and a splash before the real
    // window existed: three windows, three sizes, three centre positions.
    const createIdx = startupSlice.indexOf('const win = createMainWindow();');
    const healIdx = startupSlice.indexOf('await healPreviousInstallation(');
    const bootIdx = startupSlice.indexOf('await bootApp();');
    expect(createIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeLessThan(healIdx);
    expect(healIdx).toBeLessThan(bootIdx);

    // No separate startup windows remain.
    expect(startupSlice).not.toContain('ensureSplash(');
    expect(startupSlice).not.toContain('await showModeSelectWindow()');
  });

  it('diagnoses web crash dialogs through the desktop crash diagnostics module', () => {
    const healSource = readFileSync(path.join(__dirname, 'boot-heal.ts'), 'utf-8');
    expect(localMode).toContain("from './desktop-crash-diagnostics';");
    expect(localMode).toContain('buildWebCrashDiagnostic');
    expect(localMode).toContain('type WebCrashDiagnostic');
    expect(localMode).toContain('const diagnostic = buildWebCrashDiagnostic({');
    expect(localMode).toContain('diagnostic.shouldRefreshPrivateNode');
    expect(localMode).toContain('markNodeRuntimeRepairRequired(diagnostic.cause, nodePath)');
    // The repair marker now lives with the rest of the heal path.
    expect(healSource).toContain('NODE_RUNTIME_REPAIR_MARKER');
    expect(localMode).toContain('showWebCrashRecoveryDialog(diagnostic, nodePath)');
    expect(localMode).toContain("action === 'repair-private-node'");
    expect(localMode).toContain('repairPrivateNodeRuntimeAndRestart(diagnostic, nodePath)');
    expect(localMode).toContain('await downloadNode();');
    expect(localMode).toContain('await openCrashLog();');
  });

  it('does not let the Obsidian SecretStorage broker block local service startup', () => {
    const brokerIdx = localMode.indexOf('await ensureObsidianSecretStorageBroker();');
    const processManagerIdx = localMode.indexOf('createProcessManager(webPort, mcpPort);');

    // The broker lifecycle moved to obsidian-broker-lifecycle.ts.
    const broker = readFileSync(path.join(__dirname, 'obsidian-broker-lifecycle.ts'), 'utf-8');
    expect(broker).toContain('MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER');
    expect(broker).toContain('MINDOS_OBSIDIAN_SECRET_STORAGE_BROKER_TIMEOUT_MS');
    expect(broker).toContain('startObsidianSecretStorageBrokerWithTimeout(timeoutMs)');
    expect(broker).toContain('startup timed out after ${timeoutMs}ms');
    expect(brokerIdx).toBeGreaterThan(-1);
    expect(processManagerIdx).toBeGreaterThan(brokerIdx);
  });
});
