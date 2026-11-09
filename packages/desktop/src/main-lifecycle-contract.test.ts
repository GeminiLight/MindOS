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
    const handler = sliceBetween("win.webContents.on('did-fail-load'", "win.webContents.on('did-finish-load'");

    it('receives the isMainFrame argument', () => {
      expect(handler).toMatch(/on\('did-fail-load',\s*\([^)]*isMainFrame[^)]*\)\s*=>/);
    });

    it('ignores sub-frame failures and ERR_ABORTED (-3) before raising anything', () => {
      const guard = handler.indexOf('if (!isMainFrame || code === -3) return;');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(handler.indexOf('dialog.show'));
    });

    it('treats a boot shell that will not load as a broken install, not a page error', () => {
      // There is no product window to fall back to at that point, so the
      // recoverable "reload the page" dialog would be a dead end.
      const bootBranch = handler.indexOf('if (isBootShellActive())');
      expect(bootBranch).toBeGreaterThan(-1);
      expect(bootBranch).toBeLessThan(handler.indexOf('dialog.showMessageBox'));
      expect(handler.slice(bootBranch)).toContain('app.quit()');
    });
  });

  describe('MCP client config rewrite', () => {
    // Extracted from main.ts into mcp-client-config.ts; the contract still holds.
    const mcpSource = readFileSync(path.join(__dirname, 'mcp-client-config.ts'), 'utf-8').replace(/\r\n/g, '\n');
    const start = mcpSource.indexOf('export function updateMcpClientConfigs(');
    const fn = mcpSource.slice(start, mcpSource.indexOf('\n}\n', start));

    it('is reachable from main.ts', () => {
      expect(start).toBeGreaterThan(-1);
      expect(source).toContain("import { updateMcpClientConfigs } from './mcp-client-config';");
    });

    it('delegates to the atomic, JSON-validated file rewriter', () => {
      expect(mcpSource).toContain("import { rewriteMcpClientConfigFile } from './mcp-config-rewrite';");
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
      expect(block).toContain('forceTerminateProcessTree(shellState.activeBuildChild)');
      // Must run before the (possibly slow) processManager.stop() race
      expect(block.indexOf('forceTerminateProcessTree(shellState.activeBuildChild)')).toBeLessThan(block.indexOf('processManager.stop()'));
    });
  });

  describe('build child tracking', () => {
    it('keeps a module-level handle to the active spawnWithEnv child', () => {
      // The handle moved into the shared ShellState object (shell-state.ts)
      // so startLocalMode could stop being a closure over main.ts bindings.
      expect(readFileSync(path.join(__dirname, 'shell-state.ts'), 'utf-8'))
        .toContain('activeBuildChild: ChildProcess | null;');
      // spawnWithEnv moved with startLocalMode into local-mode.ts.
      const localMode = readFileSync(path.join(__dirname, 'local-mode.ts'), 'utf-8');
      const spawnStart = localMode.indexOf('function spawnWithEnv(');
      const fn = localMode.slice(spawnStart, localMode.indexOf('\n}\n', spawnStart));
      expect(fn).toContain('shellState.activeBuildChild = proc;');
      // Cleared on every terminal path so a finished build is never re-killed
      expect(fn.split('shellState.activeBuildChild = null;').length - 1).toBeGreaterThanOrEqual(2);
    });
  });

  describe('core update download IPC', () => {
    // The renderer-facing IPC surface moved to ipc-handlers.ts.
    const ipcSource = readFileSync(path.join(__dirname, 'ipc-handlers.ts'), 'utf-8').replace(/\r\n/g, '\n');
    const handlerStart = ipcSource.indexOf("handleLocalOnly('download-core-update'");
    const handler = ipcSource.slice(handlerStart, ipcSource.indexOf("handleLocalOnly('cancel-core-download'"));

    it('resolves urls and sha256 from the last check() result instead of trusting the renderer', () => {
      expect(handlerStart).toBeGreaterThan(-1);
      expect(ipcSource).toContain("import { resolveCoreDownloadRequest } from './core-updater';");
      // The CoreUpdater instance itself now lives on the shared state object.
      expect(readFileSync(path.join(__dirname, 'shell-state.ts'), 'utf-8')).toContain('new CoreUpdater()');
      expect(handler).toContain('resolveCoreDownloadRequest(args, shellState.coreUpdater.getLastCheck())');
      expect(handler).toContain('shellState.coreUpdater.download(download.urls, download.version, download.size, download.sha256)');
      expect(ipcSource).not.toContain('parseCoreDownloadArgs');
    });

    it('accepts a variadic argument list so the legacy (urls, version, size, sha256) call shape keeps working', () => {
      expect(handler).toMatch(/async \(_e, \.\.\.args: unknown\[\]\)/);
    });
  });

  describe('switch-remote boot action', () => {
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
