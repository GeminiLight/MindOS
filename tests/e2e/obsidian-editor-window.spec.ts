import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { startObsidianFileFixture } from './fixtures/obsidian-file-server';
import { buildObsidianDesktopRuntime } from '../../scripts/build-obsidian-desktop-runtime.mjs';

const executablePath = process.env.MINDOS_ELECTRON_EXECUTABLE;
const originalDir = process.env.MINDOS_OBSIDIAN_ADVANCED_TABLES_DIR;
// Optional real electron-builder artifact. Electron (not the test runner) reads
// through ASAR; never extract/rebundle it and accidentally test development bytes.
const packagedAsar = process.env.MINDOS_OBSIDIAN_PACKAGED_ASAR;
const runtimeDirectory = () => packagedAsar ? join(resolve(packagedAsar), 'dist-electron/obsidian') : directory;
test.skip(!executablePath || !originalDir, 'Requires the installed Electron binary and verified Advanced Tables release assets.');
let directory: string;
let server: Awaited<ReturnType<typeof startObsidianFileFixture>>;
let application: ElectronApplication | undefined;
let afterSave: (() => Promise<void>) | undefined;
const desktopRoot = resolve(import.meta.dirname, '../../packages/desktop');
const doc = '| Name | Qty |\n| --- | --- |\n| Apple | 2 |\n| Pear | 10 |';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'mindos-obsidian-window-'));
  if (!packagedAsar) await buildObsidianDesktopRuntime(directory);
  await build({ stdin: { contents: `
    import {app} from 'electron';
    import {readFileSync} from 'node:fs';
    import {createObsidianEditorWindow} from ${JSON.stringify(resolve(desktopRoot, 'src/obsidian-editor-window.ts'))};
    import {prepareObsidianPluginSession} from ${JSON.stringify(resolve(desktopRoot, 'src/obsidian-plugin-session.ts'))};
    app.setPath('userData', process.env.MINDOS_WINDOW_FIXTURE_DIR);
    app.on('window-all-closed', () => {});
    globalThis.pluginErrors = []; globalThis.preloadErrors = [];
    app.on('browser-window-created', (_event, window) => {
      window.webContents.on('preload-error', (_event, preloadPath, error) => globalThis.preloadErrors.push({preloadPath,message:error.message}));
      window.webContents.on('ipc-message', (_event, channel, message) => {
        if (channel === 'obsidian-editor' && message?.kind === 'error') globalThis.pluginErrors.push(message.content);
      });
    });
    app.whenReady().then(async () => {
      globalThis.openEditor = async () => {
      try {
        const session = await prepareObsidianPluginSession({baseUrl:process.env.MINDOS_WINDOW_BASE_URL,
          token:process.env.MINDOS_WINDOW_TOKEN, pluginId:process.env.MINDOS_WINDOW_PLUGIN_ID, filePath:'Tables.md',
          signal:new AbortController().signal, isCurrent:()=>true, approve:async()=>process.env.MINDOS_WINDOW_READ_VAULT === '1' ? 'read-vault' : true});
        globalThis.editorSession = session;
        globalThis.editorWindow = await createObsidianEditorWindow({session,
          runtimeSource:readFileSync(process.env.MINDOS_WINDOW_RUNTIME,'utf8'), preloadPath:process.env.MINDOS_WINDOW_PRELOAD,
          timeoutMs:Number(process.env.MINDOS_WINDOW_TIMEOUT)});
      } catch (error) { globalThis.editorFailure = error.message; }
      };
      await globalThis.openEditor();
    });
  `, resolveDir: desktopRoot, sourcefile: 'editor-window-fixture.ts' }, bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], outfile: join(directory, 'main.cjs') });
});
test.beforeEach(async () => {
  afterSave = undefined;
  server = await startObsidianFileFixture({ afterSave: async () => { await afterSave?.(); } });
  writeFileSync(join(server.root, 'Tables.md'), doc);
  const packageDir = join(server.root, '.mindos/plugins/table-editor-obsidian');
  mkdirSync(packageDir, { recursive: true });
  for (const name of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(join(packageDir, name), readFileSync(join(originalDir!, name)));
});
test.afterEach(async () => {
  if (application) {
    // Fixture teardown is forced; normal user-close protection is tested separately.
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
    await application.close();
  }
  application = undefined; await server?.close();
});
test.afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function launch(timeoutMs = 10000, pluginId = 'table-editor-obsidian', readVault = false) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  application = await _electron.launch({ executablePath, args: [join(directory, 'main.cjs')], env: {
    ...env, MINDOS_WINDOW_FIXTURE_DIR: directory, MINDOS_WINDOW_BASE_URL: server.baseUrl, MINDOS_WINDOW_TOKEN: server.token,
    MINDOS_WINDOW_RUNTIME: join(runtimeDirectory(), 'runtime.js'), MINDOS_WINDOW_PRELOAD: join(runtimeDirectory(), 'preload.js'),
    MINDOS_WINDOW_TIMEOUT: String(timeoutMs),
    MINDOS_WINDOW_PLUGIN_ID: pluginId, MINDOS_WINDOW_READ_VAULT: readVault ? '1' : '0',
  } });
  await expect.poll(async () => {
    try { return await application!.evaluate(() => !!((globalThis as any).editorWindow || (globalThis as any).editorFailure)); }
    catch (error) {
      // Chromium/Node inspector may replace its initial context while Electron boots.
      // Re-observe the SAME live process, never turn a crash into a passing retry.
      if (application!.process().exitCode === null && /Execution context was destroyed/.test(String(error))) return false;
      throw error;
    }
  }).toBe(true);
  return application;
}

test('real isolated Electron window formats and saves the fingerprint-approved Advanced Tables original', async () => {
  const app = await launch();
  expect(await app.evaluate(() => (globalThis as any).editorFailure)).toBeUndefined();
  expect(await app.evaluate(() => (globalThis as any).preloadErrors)).toEqual([]);
  const page = await app.firstWindow();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('Plugin command').locator('option')).toHaveCount(22);
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await frame.getByLabel('Plugin command').selectOption('table-editor-obsidian:format-table');
  await frame.getByRole('button', { name: 'Run command' }).click();
  await expect(page.getByRole('status')).toHaveText('未保存');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe('| Name  | Qty |\n| ----- | --- |\n| Apple | 2   |\n| Pear  | 10  |');
  await page.screenshot({ path: packagedAsar ? '/tmp/obsidian-packaged-editor-loaded.png' : '/tmp/obsidian-electron-editor-loaded.png', fullPage: true });
  expect(await app.evaluate(({ session }) => (globalThis as any).editorWindow.window.webContents.session === session.defaultSession)).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).editorWindow.window.webContents.getBackgroundThrottling())).toBe(false);
  await app.evaluate(() => (globalThis as any).editorWindow.close());
  expect(await app.evaluate(() => (globalThis as any).editorSession.snapshot.status)).toBe('closed');
});

test('the shipped runtime renders an explicit Markdown preview without changing the document', async () => {
  const app = await launch(); const page = await app.firstWindow(); const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: 'Render preview', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Render preview', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'Markdown preview' }).locator('table')).toBeVisible();
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(doc);
  await page.screenshot({ path: '/tmp/obsidian-desktop-markdown-preview.png' });
  await frame.locator('.cm-content').fill('new draft');
  await expect(frame.getByRole('region', { name: 'Markdown preview' })).toBeHidden();
});

test('plugin frame has no Node, main-window bridge, parent DOM or network access', async () => {
  const app = await launch(); expect(await app.evaluate(() => (globalThis as any).editorFailure)).toBeUndefined();
  const page = await app.firstWindow(); const frame = page.frames().find(frame => frame.parentFrame());
  expect(frame).toBeTruthy();
  const result = await frame!.evaluate(async url => {
    let parent = 'accessible'; try { window.parent.document.body; } catch { parent = 'blocked'; }
    let network = 'accessible'; try { await fetch(url); } catch { network = 'blocked'; }
    return { parent, network, node: typeof (window as any).require, process: typeof (window as any).process, bridge: typeof (window as any).mindos, origin: window.origin };
  }, server.baseUrl);
  expect(result).toEqual({ parent: 'blocked', network: 'blocked', node: 'undefined', process: 'undefined', bridge: 'undefined', origin: expect.stringMatching(/^https:\/\/[0-9a-f-]{36}\.obsidian\.mindos\.invalid$/) });
  expect(await page.evaluate(() => typeof (window as any).mindos)).toBe('undefined');
  await frame!.evaluate(() => window.parent.postMessage({ kind: 'save', content: 'forged', path: 'Other.md' }, '*'));
  await page.waitForTimeout(100);
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(doc);
});

test('the shipped plugin realm runs real Blob workers and IndexedDB without granting native or parent access', async () => {
  const app = await launch(); const page = await app.firstWindow();
  const frame = page.frames().find(frame => frame.parentFrame())!;
  const result = await frame.evaluate(async () => {
    const request = indexedDB.open('plugin-index', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pages');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('pages', 'readwrite');
    transaction.objectStore('pages').put({ title: '真实索引 📚', count: 42 }, 'notes');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    const read = db.transaction('pages').objectStore('pages').get('notes');
    const record = await new Promise<unknown>((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
    db.close();
    const blob = URL.createObjectURL(new Blob([`onmessage = event => { const bytes = new Uint8Array(event.data); bytes[0] += 1; postMessage({ bytes: bytes.buffer, node: typeof require, process: typeof process }, [bytes.buffer]); };`], { type: 'text/javascript' }));
    const worker = new Worker(blob);
    const bytes = new Uint8Array([41]);
    const response = new Promise<any>((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = () => reject(new Error('Real worker failed')); });
    worker.postMessage(bytes.buffer, [bytes.buffer]);
    const transferred = bytes.byteLength === 0;
    const message = await response;
    worker.terminate(); URL.revokeObjectURL(blob);
    let parentBlocked = false; try { window.parent.document; } catch { parentBlocked = true; }
    return { record, transferred, answer: new Uint8Array(message.bytes)[0], node: message.node, process: message.process, parentBlocked };
  });
  expect(result).toEqual({ record: { title: '真实索引 📚', count: 42 }, transferred: true, answer: 42, node: 'undefined', process: 'undefined', parentBlocked: true });
});

test('Blob workers inherit offline restrictions for fetch, importScripts and WebSocket', async () => {
  let requests = 0;
  const target = createHttpServer((_request, response) => { requests++; response.end('postMessage("escaped")'); });
  target.on('upgrade', (_request, socket) => { requests++; socket.destroy(); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  try {
    const app = await launch(); const page = await app.firstWindow(); const frame = page.frames().find(frame => frame.parentFrame())!;
    const result = await frame.evaluate(async port => {
      const source = `onmessage = async () => {
        const result = {};
        try { await fetch('http://127.0.0.1:${port}/fetch'); result.fetch = 'escaped'; } catch { result.fetch = 'blocked'; }
        try { importScripts('http://127.0.0.1:${port}/script'); result.importScripts = 'escaped'; } catch { result.importScripts = 'blocked'; }
        result.socket = await new Promise(resolve => {
          try { const socket = new WebSocket('ws://127.0.0.1:${port}/socket'); socket.onopen = () => { socket.close(); resolve('escaped'); }; socket.onerror = () => resolve('blocked'); }
          catch { resolve('blocked'); }
        });
        postMessage(result);
      };`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); const worker = new Worker(url);
      try { return await new Promise<unknown>((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = () => reject(new Error('Worker probe failed')); worker.postMessage('run'); }); }
      finally { worker.terminate(); URL.revokeObjectURL(url); }
    }, (target.address() as { port: number }).port);
    expect(result).toEqual({ fetch: 'blocked', importScripts: 'blocked', socket: 'blocked' });
    expect(requests).toBe(0);
  } finally { await new Promise<void>(resolve => target.close(() => resolve())); }
});

test('closing revokes the session storage and reopening uses a different origin with no previous browser data', async () => {
  const app = await launch(); const page = await app.firstWindow(); const frame = page.frames().find(frame => frame.parentFrame())!;
  const origin = await frame.evaluate(async () => {
    localStorage.setItem('private-note', 'old contents');
    const request = indexedDB.open('private-index', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return location.origin;
  });
  await app.evaluate(() => {
    const globals = globalThis as any; const session = globals.editorWindow.window.webContents.session;
    const clear = session.clearStorageData.bind(session);
    // Observe the real Electron cleanup rather than substituting an empty implementation.
    session.clearStorageData = async (...args: any[]) => { await clear(...args); globals.storageCleared = true; };
    globals.editorWindow.close();
  });
  await expect.poll(() => app.evaluate(() => (globalThis as any).storageCleared)).toBe(true);
  const opening = app.waitForEvent('window');
  await app.evaluate(async () => { await (globalThis as any).openEditor(); });
  const reopened = await opening;
  await expect(reopened.frameLocator('iframe').locator('.cm-content')).toBeVisible();
  const next = reopened.frames().find(frame => frame.parentFrame())!;
  const data = await next.evaluate(async () => ({ origin: location.origin, note: localStorage.getItem('private-note'), databases: await indexedDB.databases() }));
  expect(data.origin).not.toBe(origin); expect(data.note).toBeNull(); expect(data.databases).toEqual([]);
});

function installDataview() {
  const pluginDir = process.env.MINDOS_OBSIDIAN_DATAVIEW_DIR;
  test.skip(!pluginDir, 'Requires verified original Dataview 0.5.70 release assets.');
  const source = readFileSync(join(pluginDir!, 'main.js'));
  expect(createHash('sha256').update(source).digest('hex')).toBe('6bb1cf7010afad830e73575fca0e2bfbd3279c562e3d9d24f2d2f45161eb7d00');
  const packageDir = join(server.root, '.mindos/plugins/dataview'); mkdirSync(packageDir, { recursive: true });
  for (const name of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(join(packageDir, name), readFileSync(join(pluginDir!, name)));
}

test('Dataview 0.5.70 original indexes granted Markdown bytes and refreshes a rendered query', async () => {
  installDataview();
  writeFileSync(join(server.root, 'Tables.md'), '---\nscore: 3\n---\n```dataview\nTABLE score\nSORT file.name ASC\n```');
  writeFileSync(join(server.root, 'Other.md'), '---\nscore: 7\n---\n# 第二篇 📚');
  const app = await launch(10000, 'dataview', true);
  expect(await app.evaluate(() => (globalThis as any).editorFailure)).toBeUndefined();
  const page = await app.firstWindow(); const frame = page.frames().find(frame => frame.parentFrame())!;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await expect.poll(() => frame.evaluate(() => (window as any).DataviewAPI?.index?.initialized)).toBe(true);
  await expect.poll(() => frame.evaluate(() => (window as any).DataviewAPI?.index?.pages?.size)).toBe(2);
  expect(await frame.evaluate(() => (window as any).DataviewAPI.page('Other.md').score)).toBe(7);
  const ui = page.frameLocator('iframe');
  await ui.getByRole('button', { name: 'Render preview', exact: true }).click();
  const preview = ui.getByRole('region', { name: 'Markdown preview' });
  await expect(preview.locator('table')).toBeVisible().catch(async failure => {
    throw new Error(`${failure.message}\nPlugin errors: ${JSON.stringify(await app.evaluate(() => (globalThis as any).pluginErrors))}\nPage errors: ${errors.join('\n')}\nPreview: ${await preview.textContent().catch(() => 'closed')}`, { cause: failure });
  });
  await expect(preview).toContainText('Other'); await expect(preview).toContainText('7');
  await expect(preview.locator('th')).toContainText(['File', 'score']);
  await expect(preview.locator('a.internal-link').filter({ hasText: /^Other$/ })).toHaveAttribute('data-href', 'Other.md');
  await expect(preview).not.toContainText('[[Other.md');
  writeFileSync(join(server.root, 'Other.md'), '---\nscore: 19\n---\n# Updated');
  await page.getByRole('button', { name: '刷新知识库', exact: true }).click();
  await expect.poll(() => frame.evaluate(() => (window as any).DataviewAPI.page('Other.md').score)).toBe(19);
  await ui.getByRole('button', { name: 'Render preview', exact: true }).click();
  await expect(preview).toContainText('19');
  await page.screenshot({ path: '/tmp/obsidian-dataview-original-query.png', fullPage: true });
});

test('DataviewJS executes only after the original settings enable it and uses edited rendering options', async () => {
  installDataview();
  const source = '---\nscore: 3\n---\n```dataviewjs\ndv.table(["Name", "Score", "Missing"], dv.pages().sort(p => p.file.name).map(p => [p.file.link, p.score, null]));\n```\n\nInline result: `$= dv.current().score * 2`';
  writeFileSync(join(server.root, 'Tables.md'), source);
  writeFileSync(join(server.root, 'Other.md'), '---\nscore: 7\n---\n# 第二篇 📚');
  const app = await launch(10000, 'dataview', true); const page = await app.firstWindow();
  const frame = page.frames().find(frame => frame.parentFrame())!; const ui = page.frameLocator('iframe');
  await expect.poll(() => frame.evaluate(() => (window as any).DataviewAPI?.index?.pages?.size)).toBe(2);
  const preview = ui.getByRole('region', { name: 'Markdown preview' });
  await ui.getByRole('button', { name: 'Render preview', exact: true }).click();
  await expect(preview).toContainText('Dataview JS queries are disabled');
  await ui.getByRole('button', { name: 'Plugin settings', exact: true }).click();
  const settings = ui.getByRole('region', { name: 'Plugin settings (this session)', exact: true });
  // Reaching the final setting also proves the original display() did not stop midway.
  await expect(settings.getByRole('checkbox', { name: 'Recursive sub-task completion', exact: true })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await settings.getByRole('checkbox', { name: 'Enable JavaScript queries', exact: true }).check();
  await settings.getByRole('checkbox', { name: 'Enable inline JavaScript queries', exact: true }).check();
  await settings.getByRole('textbox', { name: 'Render null as', exact: true }).fill('空值 📚');
  await ui.getByRole('button', { name: 'Close plugin settings', exact: true }).click();
  await expect(settings).toBeHidden();
  await ui.getByRole('button', { name: 'Render preview', exact: true }).click();
  await expect(preview.locator('th')).toContainText(['Name', 'Score', 'Missing']);
  await expect(preview.locator('tbody tr')).toHaveCount(2);
  await expect(preview.locator('tbody tr').first()).toContainText('7');
  await expect(preview.locator('tbody tr').first()).toContainText('空值 📚');
  await expect(preview.locator('a.internal-link').filter({ hasText: /^Other$/ })).toHaveAttribute('data-href', 'Other.md');
  await expect(preview).toContainText('Inline result: 6');
  const inline = preview.locator('p').filter({ hasText: /^Inline result:/ }).first();
  await expect.poll(() => inline.evaluate(element => {
    const label = document.createRange(); label.selectNode(element.firstChild!);
    const value = document.createRange(); value.selectNode(element.querySelector('span')!);
    return Math.abs(label.getBoundingClientRect().top - value.getBoundingClientRect().top);
  })).toBeLessThan(3);
  await expect(inline.locator('div, p')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/obsidian-dataviewjs-original-query.png', fullPage: true });
  await ui.getByRole('button', { name: 'Plugin settings', exact: true }).click();
  await expect(settings.getByRole('checkbox', { name: 'Enable JavaScript queries', exact: true })).toBeChecked();
  await expect(settings.getByRole('textbox', { name: 'Render null as', exact: true })).toHaveValue('空值 📚');
  await settings.getByRole('checkbox', { name: 'Enable JavaScript queries', exact: true }).press('Escape');
  await expect(settings).toBeHidden();
  await expect(ui.getByRole('button', { name: 'Plugin settings', exact: true })).toBeFocused();
  await expect(ui.getByRole('button', { name: 'Plugin settings', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await ui.getByRole('button', { name: 'Plugin settings', exact: true }).click();
  await page.screenshot({ path: '/tmp/obsidian-dataview-original-settings.png', fullPage: true });
  await settings.getByRole('checkbox', { name: 'Automatic task completion tracking', exact: true }).check();
  await expect(settings.getByRole('textbox', { name: 'Completion field name', exact: true })).toBeEnabled();
  await settings.getByRole('checkbox', { name: 'Use emoji shorthand for completion', exact: true }).check();
  await expect(settings.getByRole('textbox', { name: 'Completion field name', exact: true })).toHaveCount(0);
  await settings.getByRole('checkbox', { name: 'Automatic task completion tracking', exact: true }).uncheck();
  await expect(settings.getByRole('checkbox', { name: 'Use emoji shorthand for completion', exact: true })).toHaveCount(0);
  await settings.getByRole('checkbox', { name: 'Enable JavaScript queries', exact: true }).uncheck();
  await ui.getByRole('button', { name: 'Close plugin settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Render preview', exact: true }).click();
  await expect(preview).toContainText('Dataview JS queries are disabled');
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(source);
  expect(await app.evaluate(() => (globalThis as any).pluginErrors)).toEqual([]);
});

test('WebRTC cannot send STUN datagrams or open TURN TCP connections outside the broker', async () => {
  const udp = createSocket('udp4'); let packets = 0; let connections = 0;
  udp.on('message', () => packets++);
  const tcp = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve));
  try {
    const app = await launch(); const page = await app.firstWindow();
    const frame = page.frames().find(frame => frame.parentFrame())!;
    await frame.evaluate(async ({ udpPort, tcpPort }) => {
      const peer = new RTCPeerConnection({ iceServers: [
        { urls: `stun:127.0.0.1:${udpPort}` },
        { urls: `turn:127.0.0.1:${tcpPort}?transport=tcp`, username: 'fixture', credential: 'fixture' },
      ] });
      peer.createDataChannel('fixture'); await peer.setLocalDescription(await peer.createOffer());
      await new Promise(resolve => setTimeout(resolve, 750)); peer.close();
    }, { udpPort: udp.address().port, tcpPort: (tcp.address() as { port: number }).port });
    expect({ packets, connections }).toEqual({ packets: 0, connections: 0 });
  } finally { udp.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
});

test('a synchronous plugin startup loop is terminated from Electron main without blocking main', async () => {
  writeFileSync(join(server.root, '.mindos/plugins/table-editor-obsidian/main.js'), 'while (true) {}');
  const app = await launch(1000);
  expect(await app.evaluate(() => (globalThis as any).editorFailure)).toMatch(/timed out/i);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  expect(await app.evaluate(() => (globalThis as any).editorSession.snapshot.status)).toBe('closed');
  expect(await app.evaluate(() => (process as any)._getActiveHandles().filter((handle: { constructor?: { name?: string } }) => handle.constructor?.name === 'Server').length)).toBe(0);
});

test('a failed original module load closes the window and releases its document session', async () => {
  writeFileSync(join(server.root, '.mindos/plugins/table-editor-obsidian/main.js'), 'throw new Error("fixture load failed")');
  const app = await launch();
  expect(await app.evaluate(() => (globalThis as any).editorFailure)).toContain('fixture load failed');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  expect(await app.evaluate(() => (globalThis as any).editorSession.snapshot.status)).toBe('closed');
});

test('a synchronous command failure revokes its execution window instead of leaving a silent broken command', async () => {
  writeFileSync(join(server.root, '.mindos/plugins/table-editor-obsidian/main.js'), `const {Plugin}=require('obsidian');
    module.exports=class extends Plugin{onload(){this.addCommand({id:'explode',name:'Throw',callback:()=>{throw new Error('fixture command failed')}})}}`);
  const app = await launch(); const page = await app.firstWindow();
  const frame = page.frameLocator('iframe'); await expect(frame.getByLabel('Plugin command').locator('option')).toHaveCount(1);
  await frame.getByRole('button', { name: 'Run command' }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  expect(await app.evaluate(() => (globalThis as any).editorSession.snapshot.status)).toBe('closed');
});

test('closing an unsaved editor can be cancelled without discarding the draft', async () => {
  const app = await launch(); const page = await app.firstWindow();
  const editor = page.frameLocator('iframe').locator('.cm-content');
  await editor.click(); await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText('Unsaved fixture draft');
  await expect(editor).toHaveText('Unsaved fixture draft');
  await expect(page.getByRole('status')).toHaveText('未保存');
  await app.evaluate(({ dialog }) => {
    // Native UI boundary only; the real BrowserWindow close event and transport run.
    dialog.showMessageBox = async (_window: unknown, options: any) => {
      (globalThis as any).closePrompt = options; return { response: 0, checkboxChecked: false };
    };
    (globalThis as any).editorWindow.window.close();
  });
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).closePrompt)).toBe(true);
  expect(await app.evaluate(() => (globalThis as any).editorWindow.window.isDestroyed())).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).editorSession.snapshot.content)).toBe('Unsaved fixture draft');
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(doc);
});

test('save explicitly captures the current editor even when its automatic draft update has not run', async () => {
  const app = await launch(); const page = await app.firstWindow();
  const frame = page.frames().find(frame => frame.parentFrame())!;
  // Pause only scheduled draft reporting, not the actual editor or capture messages.
  await frame.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.frameLocator('iframe').locator('.cm-content').fill('Latest unsent draft');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect.poll(() => readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe('Latest unsent draft');
});

for (const response of [1, 2]) test(`close decision ${response === 1 ? 'save' : 'discard'} closes with the expected disk content`, async () => {
  const app = await launch(); const page = await app.firstWindow();
  await page.frameLocator('iframe').locator('.cm-content').fill('Unsaved fixture draft');
  await expect(page.getByRole('status')).toHaveText('未保存');
  await app.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
    (globalThis as any).editorWindow.window.close();
  }, response);
  await expect.poll(() => app.evaluate(() => (globalThis as any).editorWindow.window.isDestroyed())).toBe(true);
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(response === 1 ? 'Unsaved fixture draft' : doc);
});

test('a conflict while saving on close keeps the window and unsaved draft', async () => {
  const app = await launch(); const page = await app.firstWindow();
  await page.frameLocator('iframe').locator('.cm-content').fill('Unsaved fixture draft');
  await expect(page.getByRole('status')).toHaveText('未保存');
  writeFileSync(join(server.root, 'Tables.md'), 'External edit');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    (globalThis as any).editorWindow.window.close();
  });
  await expect.poll(() => app.evaluate(() => (globalThis as any).editorSession.snapshot.status)).toBe('conflict');
  expect(await app.evaluate(() => (globalThis as any).editorWindow.window.isDestroyed())).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).editorSession.snapshot.content)).toBe('Unsaved fixture draft');
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe('External edit');
});

test('an unreported edit during save-and-close keeps its window after the earlier save completes', async () => {
  const app = await launch(); const page = await app.firstWindow();
  const editor = page.frameLocator('iframe').locator('.cm-content');
  await editor.fill('First draft'); await expect(page.getByRole('status')).toHaveText('未保存');
  afterSave = async () => {
    await page.frames().find(frame => frame.parentFrame())!.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await editor.fill('Later draft');
  };
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    (globalThis as any).editorWindow.window.close();
  });
  await expect.poll(() => readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe('First draft');
  await expect.poll(() => app.evaluate(() => (globalThis as any).editorSession.snapshot.content)).toBe('Later draft');
  expect(await app.evaluate(() => (globalThis as any).editorWindow.window.isDestroyed())).toBe(false);
});

test('a plugin that refuses capture cannot trap the user in its window', async () => {
  const app = await launch(); const page = await app.firstWindow();
  await page.frames().find(frame => frame.parentFrame())!.evaluate(() => {
    const owner = window.parent;
    // Malicious code can shadow the frame's replaceable parent property. Keep
    // heartbeat reporting alive while refusing the host's capture source check.
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: owner.postMessage.bind(owner) } });
  });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_owner: unknown, options: any) => {
      (globalThis as any).forceClosePrompt = options; return { response: 1, checkboxChecked: false };
    };
    (globalThis as any).editorWindow.window.close();
  });
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).forceClosePrompt)).toBe(true);
  await expect.poll(() => app.evaluate(() => (globalThis as any).editorWindow.window.isDestroyed())).toBe(true);
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(doc);
});
