import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// main.ts boots Electron on import, so its lifecycle wiring is asserted as a
// source contract (same approach as main-startup-contract.test.ts).
const source = readFileSync(path.join(__dirname, 'main.ts'), 'utf-8').replace(/\r\n/g, '\n');

function sliceBetween(startMarker: string, endMarker: string, from = 0): string {
  const start = source.indexOf(startMarker, from);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `end marker not found after ${startMarker}: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('desktop main lifecycle contract', () => {
  describe('did-fail-load', () => {
    const handler = sliceBetween("mainWindow.webContents.on('did-fail-load'", "mainWindow.webContents.on('did-finish-load'");

    it('receives the isMainFrame argument', () => {
      expect(handler).toMatch(/on\('did-fail-load',\s*\([^)]*isMainFrame[^)]*\)\s*=>/);
    });

    it('ignores sub-frame failures and ERR_ABORTED (-3) before touching the splash or dialogs', () => {
      const guard = handler.indexOf('if (!isMainFrame || code === -3) return;');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(handler.indexOf('closeSplash()'));
      expect(guard).toBeLessThan(handler.indexOf('dialog.showMessageBox'));
    });
  });

  describe('MCP client config rewrite', () => {
    const fn = sliceBetween('function updateMcpClientConfigs(', '\n}\n');

    it('delegates to the atomic, JSON-validated file rewriter', () => {
      expect(source).toContain("import { rewriteMcpClientConfigFile } from './mcp-config-rewrite';");
      expect(fn).toContain('rewriteMcpClientConfigFile(abs, oldPort, newPort)');
    });

    it('never overwrites a third-party config with a bare writeFileSync', () => {
      expect(fn).not.toContain('writeFileSync(');
      expect(fn).not.toContain('rewriteMcpClientConfig(raw');
    });

    it('logs and skips files whose rewritten text is not valid JSON', () => {
      expect(fn).toContain("=== 'invalid'");
      expect(fn).toMatch(/console\.warn\([^)]*not valid JSON/);
    });
  });

  describe('before-quit', () => {
    const block = sliceBetween("app.on('before-quit'", '\n});\n');

    it('marks the exit clean only when every managed child confirmed exit', () => {
      expect(block).toContain('let childrenStopped = true;');
      // stop() resolves false when a child never confirmed exit; the 8s race rejects on hang
      expect(block).toContain('if (stopped === false) childrenStopped = false;');
      expect(block).toMatch(/catch\s*\{[^}]*childrenStopped = false;/);
      const guard = block.indexOf('if (childrenStopped)');
      const record = block.indexOf("set('lastCleanExit'");
      expect(guard).toBeGreaterThan(-1);
      expect(record).toBeGreaterThan(guard);
      // No unconditional lastCleanExit write remains
      expect(block.split("set('lastCleanExit'").length - 1).toBe(1);
    });

    it('terminates an in-flight npm install / next build child', () => {
      expect(block).toContain('forceTerminateProcessTree(activeBuildChild)');
      // Must run before the (possibly slow) processManager.stop() race
      expect(block.indexOf('forceTerminateProcessTree(activeBuildChild)')).toBeLessThan(block.indexOf('processManager.stop()'));
    });
  });

  describe('build child tracking', () => {
    it('keeps a module-level handle to the active spawnWithEnv child', () => {
      expect(source).toContain('let activeBuildChild: ChildProcess | null = null;');
      const fn = sliceBetween('function spawnWithEnv(', '\n}\n');
      expect(fn).toContain('activeBuildChild = proc;');
      // Cleared on every terminal path so a finished build is never re-killed
      expect(fn.split('activeBuildChild = null;').length - 1).toBeGreaterThanOrEqual(2);
    });
  });

  describe('core update download IPC', () => {
    const handler = sliceBetween("handleLocalOnly('download-core-update'", "handleLocalOnly('cancel-core-download'");

    it('resolves urls and sha256 from the last check() result instead of trusting the renderer', () => {
      expect(source).toContain("import { CoreUpdater, resolveCoreDownloadRequest } from './core-updater';");
      expect(handler).toContain('resolveCoreDownloadRequest(args, coreUpdater.getLastCheck())');
      expect(handler).toContain('coreUpdater.download(download.urls, download.version, download.size, download.sha256)');
      expect(source).not.toContain('parseCoreDownloadArgs');
    });

    it('accepts a variadic argument list so the legacy (urls, version, size, sha256) call shape keeps working', () => {
      expect(handler).toMatch(/async \(_e, \.\.\.args: unknown\[\]\)/);
    });
  });

  describe('switch-remote splash action', () => {
    const branch = sliceBetween("case 'switch-remote': {", 'break;');

    it('stops and releases any half-started local ProcessManager before booting remote mode', () => {
      const stop = branch.indexOf('.stop()');
      const nullOut = branch.indexOf('processManager = null;');
      const boot = branch.indexOf('await bootApp();');
      expect(stop).toBeGreaterThan(-1);
      expect(nullOut).toBeGreaterThan(-1);
      expect(boot).toBeGreaterThan(stop);
      expect(boot).toBeGreaterThan(nullOut);
      expect(branch).toContain("currentMode = 'remote';");
    });
  });
});
