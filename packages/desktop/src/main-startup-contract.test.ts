import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(__dirname, 'main.ts'), 'utf-8');

describe('desktop main startup contract', () => {
  it('acquires the single-instance lock before any heal/boot logic runs', () => {
    expect(source).toContain('app.requestSingleInstanceLock()');
    expect(source).toContain("app.on('second-instance'");
    // whenReady must bail for the losing instance before healPreviousInstallation
    // (heal kills processes on the configured ports — i.e. the FIRST instance's servers)
    const whenReady = source.indexOf('app.whenReady()');
    const lockGuard = source.indexOf('if (!hasSingleInstanceLock) return;');
    const heal = source.indexOf('await healPreviousInstallation();');
    expect(whenReady).toBeGreaterThan(-1);
    expect(lockGuard).toBeGreaterThan(whenReady);
    expect(heal).toBeGreaterThan(lockGuard);
  });

  it('routes every navigation-denied URL through the external-open guard', () => {
    expect(source).toContain("import { isSafeExternalUrl } from './open-external-guard';");
    expect(source).toContain('function openExternalGuarded(');
    // The only dynamic-URL openExternal lives inside the guarded helper;
    // any other call site must be a hard-coded https constant.
    expect(source.split('shell.openExternal(url)').length - 1).toBe(1);
    const dynamicish = source
      .split('shell.openExternal(')
      .slice(1)
      .filter((rest) => !rest.startsWith('url)') && !rest.startsWith("'https://"));
    expect(dynamicish).toEqual([]);
  });

  it('spawns .cmd targets via quoted cmd.exe argv instead of shell:true', () => {
    expect(source).not.toContain('shell: needsShell');
    expect(source).not.toContain('shell: true');
    expect(source).toContain('resolveExecTarget(bin, args)');
  });

  it('saves window state synchronously at quit (debounced timer never fires before app.exit)', () => {
    expect(source).toContain('saveWindowStateNow(mainWindow)');
  });

  it('uses the per-platform uninstall plan instead of bare trashItem', () => {
    expect(source).toContain("import { planUninstall } from './uninstall-plan';");
    expect(source).toContain('planUninstall({');
  });

  it('defers CLI shim install until after the splash window is created (never blocks first paint)', () => {
    const whenReady = source.indexOf('app.whenReady()');
    expect(whenReady).toBeGreaterThan(-1);
    const startupSlice = source.slice(whenReady);

    // The shim install (PowerShell PATH step on Windows) is scheduled via the
    // deferral helper, after splash creation — not invoked inline before it.
    const ensureIdx = startupSlice.indexOf(
      "ensureMindosCliShim({ appendPath: process.env.MINDOS_DISABLE_CLI_SHIM_PATH_APPEND !== '1' })",
    );
    expect(ensureIdx).toBeGreaterThan(-1);
    expect(startupSlice).toContain('scheduleCliShimInstall(splashWindow');

    let splashIdx = startupSlice.indexOf('splashWindow = createSplash()');
    expect(splashIdx).toBeGreaterThan(-1);
    while (splashIdx !== -1) {
      expect(ensureIdx).toBeGreaterThan(splashIdx);
      splashIdx = startupSlice.indexOf('splashWindow = createSplash()', splashIdx + 1);
    }
  });

  it('diagnoses web crash dialogs through the desktop crash diagnostics module', () => {
    expect(source).toContain("from './desktop-crash-diagnostics';");
    expect(source).toContain('buildWebCrashDiagnostic');
    expect(source).toContain('type WebCrashDiagnostic');
    expect(source).toContain('const diagnostic = buildWebCrashDiagnostic({');
    expect(source).toContain('diagnostic.shouldRefreshPrivateNode');
    expect(source).toContain('markNodeRuntimeRepairRequired(diagnostic.cause, nodePath)');
    expect(source).toContain('NODE_RUNTIME_REPAIR_MARKER');
    expect(source).toContain('showWebCrashRecoveryDialog(diagnostic, nodePath)');
    expect(source).toContain("action === 'repair-private-node'");
    expect(source).toContain('repairPrivateNodeRuntimeAndRestart(diagnostic, nodePath)');
    expect(source).toContain('await downloadNode();');
    expect(source).toContain('await openCrashLog();');
  });
});
