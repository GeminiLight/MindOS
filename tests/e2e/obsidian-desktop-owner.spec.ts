import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';

const executablePath = process.env.MINDOS_ELECTRON_EXECUTABLE;
test.skip(!executablePath, 'Set MINDOS_ELECTRON_EXECUTABLE to the installed Desktop Electron binary.');
let directory: string;
let server: Server;
let baseUrl: string;
let application: ElectronApplication;

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'mindos-obsidian-native-owner-'));
  server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>MindOS owner fixture</title><p>Temporary owner window</p>'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await build({
    stdin: { contents: `
      import {app, BrowserWindow, dialog} from 'electron';
      import {bindObsidianWindowOwner} from ${JSON.stringify(resolve(import.meta.dirname, '../../packages/desktop/src/obsidian-window-owner.ts'))};
      app.setPath('userData', process.env.MINDOS_OWNER_FIXTURE_DIR);
      app.whenReady().then(async () => {
        const owner = new BrowserWindow({show:false, titleBarStyle:process.platform === 'darwin' ? 'hidden' : 'default',
          webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}});
        await owner.loadURL(process.env.MINDOS_OWNER_BASE_URL);
        let current = true;
        const binding = bindObsidianWindowOwner({window:owner, baseUrl:process.env.MINDOS_OWNER_BASE_URL, isCurrent:()=>current});
        globalThis.ownerFixture = {owner, binding, changeMode:()=>{current=false;}};
        const showNative = dialog.showMessageBox.bind(dialog);
        // Observe the real native result; do not substitute a fake dialog decision.
        dialog.showMessageBox = (...args) => {
          const result = showNative(...args);
          result.then(value => { globalThis.ownerFixture.nativeResult = value; }, error => {
            globalThis.ownerFixture.nativeError = String(error);
          });
          return result;
        };
      });
    `, resolveDir: resolve(import.meta.dirname, '../../packages/desktop'), sourcefile: 'native-owner-fixture.ts' },
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'main.cjs'),
  });
});

test.beforeEach(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  application = await _electron.launch({ executablePath, args: [join(directory, 'main.cjs')],
    env: { ...env, MINDOS_OWNER_FIXTURE_DIR: directory, MINDOS_OWNER_BASE_URL: baseUrl }, timeout: 20_000 });
  await expect.poll(() => application.evaluate(() => !!(globalThis as any).ownerFixture)).toBe(true);
});
test.afterEach(async () => { await application?.close(); });
test.afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('real Electron subframe navigation does not revoke but main-frame reload does', async () => {
  await application.evaluate(async () => {
    await (globalThis as any).ownerFixture.owner.webContents.executeJavaScript("document.body.appendChild(document.createElement('iframe')).src='about:blank'");
  });
  expect(await application.evaluate(() => (globalThis as any).ownerFixture.binding.isCurrent())).toBe(true);
  await application.evaluate(() => (globalThis as any).ownerFixture.owner.reload());
  await expect.poll(() => application.evaluate(() => (globalThis as any).ownerFixture.binding.signal.aborted)).toBe(true);
});

test('real Electron window destruction revokes immediately', async () => {
  expect(await application.evaluate(() => {
    const fixture = (globalThis as any).ownerFixture; fixture.owner.destroy();
    return fixture.binding.signal.aborted;
  })).toBe(true);
});

test('real renderer crash revokes the owner without killing the trusted main process', async () => {
  await application.evaluate(() => (globalThis as any).ownerFixture.owner.webContents.forcefullyCrashRenderer());
  await expect.poll(() => application.evaluate(() => (globalThis as any).ownerFixture.binding.signal.aborted)).toBe(true);
});

test('native dialog cancellation closes a pending approval when the owner mode changes', async () => {
  const outcome = await application.evaluate(async () => {
    const fixture = (globalThis as any).ownerFixture;
    fixture.owner.show();
    const pending = fixture.binding.approve({
      pluginId: 'fixture-only', pluginName: 'Fixture only — no plugin execution', pluginVersion: '1.0.0',
      filePath: 'Temporary.md', vaultId: 'b'.repeat(64), fingerprint: 'a'.repeat(64), revision: 'c'.repeat(64),
      capabilities: ['document:read', 'document:write'],
    }).then(() => 'unexpected approval', () => 'revoked');
    setTimeout(() => fixture.changeMode(), 150);
    return pending;
  });
  expect(outcome).toBe('revoked');
  // Revoking our Promise.race alone is insufficient: the native sheet must close too.
  await expect.poll(() => application.evaluate(() => (globalThis as any).ownerFixture.nativeResult?.response)).toBe(0);
});
