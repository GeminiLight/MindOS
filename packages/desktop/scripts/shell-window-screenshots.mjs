/**
 * Visual verification for the Desktop shell surfaces (connect dialogs + the
 * boot shell hosted in the main window).
 *
 * These are plain HTML pages loaded by Electron BrowserWindows, so they can be
 * rendered headlessly with the real renderer bundle and a stubbed IPC bridge.
 * The point is the overflow behaviour: before this change both windows centred
 * their content with flex and clipped anything taller than the window.
 *
 * Run: node scripts/shell-window-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = '/tmp';
mkdirSync(out, { recursive: true });

const CONNECT_URL = `file://${path.join(root, 'src', 'connect.html')}`;
const BOOT_URL = `${CONNECT_URL}?shell=boot`;

/** Matches showModeSelectWindow()/showConnectWindow() geometry in connect-window.ts. */
const CONNECT_VIEWPORT = { width: 480, height: 600 };
/** Matches createMainWindow()'s default geometry in main.ts. */
const BOOT_VIEWPORT = { width: 1200, height: 800 };

const results = [];

function record(name, detail) {
  results.push({ name, ...detail });
}

/** True when the element's top edge is reachable by scrolling (i.e. not clipped away). */
async function topIsReachable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const rect = el.getBoundingClientRect();
    const scroller = document.scrollingElement || document.documentElement;
    return {
      found: true,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      // Negative top with no way to scroll up = unreachable (the old bug).
      reachable: rect.top >= 0 || scroller.scrollTop > 0 || scroller.scrollHeight > scroller.clientHeight,
    };
  }, selector);
}

const bridgeStub = `
window.mindosConnect = {
  getUiLang: async () => ({ preference: 'system', lang: 'zh' }),
  setUiLang: async (v) => ({ preference: v, lang: v === 'system' ? 'zh' : v }),
  checkNode: async () => true,
  checkMindosStatus: async () => ({ status: 'not-installed', path: null }),
  buildMindos: async () => ({ success: false, code: 'errBuildFailed', detail: 'next build exited with code 1', stderr: 'Error: Cannot find module \\'next/dist/bin/next\\'\\n    at Module._resolveFilename\\n    at Module._load\\n    at Function.executeUserEntryPoint' }),
  getMindosPath: async () => null,
  installMindos: async () => ({ success: false, code: 'errInstallFailed', detail: 'npm ERR! code EACCES', stderr: 'npm ERR! syscall mkdir\\nnpm ERR! path /usr/local/lib/node_modules\\nnpm ERR! errno -13' }),
  selectMode: async () => true,
  showNodeDialog: async () => 'cancel',
  openNodejs: async () => {},
  getRecentConnections: async () => ([
    { address: 'http://192.168.1.100:3456', label: 'Studio NAS', lastConnected: new Date().toISOString() },
    { address: 'http://10.0.0.21:3456', lastConnected: new Date(Date.now() - 1e6).toISOString() },
    { address: 'http://mindos.internal.example.com:3456', label: 'Office server', lastConnected: new Date(Date.now() - 2e6).toISOString() },
    { address: 'ssh://build-box:3456', label: 'build-box (SSH)', lastConnected: new Date(Date.now() - 3e6).toISOString() },
    { address: 'http://127.0.0.1:3456', label: 'Loopback', lastConnected: new Date(Date.now() - 4e6).toISOString() },
  ]),
  testConnection: async () => ({ status: 'online', authRequired: true, version: '0.6.27' }),
  connect: async () => ({ ok: true }),
  removeConnection: async () => {},
  getSavedPassword: async () => null,
  switchToLocal: async () => {},
  getSshHosts: async () => ({ available: true, hosts: [{ name: 'build-box', hostname: '10.0.0.9', user: 'ci' }] }),
  connectSsh: async () => ({ ok: false, code: 'errSshFailed', message: 'permission denied' }),
  cancelSsh: async () => ({ ok: true }),
  completeSshWithPassword: async () => ({ ok: true }),
  sshAddKey: async () => ({ ok: true }),
};
`;

/** The boot shell's extra surface — see connect-bridge.ts bootApi(). */
const bootBridgeStub = bridgeStub.replace('};\n', `
  shell: 'boot',
  onStatus(cb) { window.__bootStatus = cb; },
  onScreen(cb) { window.__bootScreen = cb; },
  action: async () => {},
};
`);

async function run() {
  const browser = await chromium.launch();

  // ── 1. Connect window: remote screen with a full recents list + password ──
  {
    const page = await browser.newPage({ viewport: CONNECT_VIEWPORT });
    await page.addInitScript(bridgeStub);
    await page.goto(CONNECT_URL);
    await page.waitForSelector('#remote-screen:not(.hidden)');
    await page.fill('#address', 'http://192.168.1.100:3456');
    await page.click('#test-btn');
    await page.waitForSelector('#password-section:not(.hidden)');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/desktop-connect-remote-full.png`, fullPage: false });
    record('connect remote (5 recents + password)', await topIsReachable(page, '.brand'));
    await page.close();
  }

  // ── 2. Connect window: local setup failure with a long stderr tail ──
  {
    const page = await browser.newPage({ viewport: CONNECT_VIEWPORT });
    await page.addInitScript(bridgeStub);
    await page.goto(`${CONNECT_URL}?modeSelect=true`);
    await page.waitForSelector('#mode-selection:not(.hidden)');
    await page.locator('.mode-card').first().click();
    await page.waitForSelector('#setup-install:not(.hidden)');
    await page.click('#install-btn');
    await page.waitForSelector('#install-status.error');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/desktop-connect-setup-error.png`, fullPage: false });
    record('connect local setup error', await topIsReachable(page, '.brand'));
    // The escape hatch and the install retry must both exist after a failure.
    record('setup escape hatch', {
      remoteButtonVisible: await page.isVisible('#setup-remote-btn'),
      installRetryVisible: await page.isVisible('#install-retry-btn'),
      installButtonStillPresent: (await page.locator('#install-btn').count()) === 1,
    });
    await page.close();
  }

  // ── 3. Connect window: dark theme sanity ──
  {
    const page = await browser.newPage({ viewport: CONNECT_VIEWPORT, colorScheme: 'dark' });
    await page.addInitScript(bridgeStub);
    await page.goto(`${CONNECT_URL}?modeSelect=true`);
    await page.waitForSelector('#mode-selection:not(.hidden)');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/desktop-connect-modes-dark.png` });
    record('connect mode cards (dark)', { ok: true });
    await page.close();
  }

  // ── 4. Boot shell: the port-conflict error, at the main window's size ──
  {
    const page = await browser.newPage({ viewport: BOOT_VIEWPORT });
    await page.addInitScript(bootBridgeStub);
    await page.goto(BOOT_URL);
    await page.waitForSelector('#boot-screen:not(.hidden)');
    await page.evaluate(() => {
      window.__bootStatus({
        // Mirrors mainStrings.portsAllInUse — keep in step with i18n/main-strings.ts.
        error: '端口 3456–3465 都被占用了。\n请关闭占用这些端口的程序后重试。可以用这条命令查看是谁占用了端口：\n  lsof -nP -iTCP:3456 -sTCP:LISTEN',
        actions: [
          { id: 'retry', label: 'retry', primary: true },
          { id: 'switch-remote', label: 'switchRemote' },
          { id: 'quit', label: 'quit' },
        ],
      });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/desktop-boot-port-error.png` });

    const buttons = await page.evaluate(() => {
      const scroller = document.scrollingElement || document.documentElement;
      return [...document.querySelectorAll('#boot-actions button')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          label: b.textContent,
          fullyVisible: r.top >= 0 && r.bottom <= scroller.clientHeight && r.left >= 0 && r.right <= scroller.clientWidth,
        };
      });
    });
    const lines = await page.evaluate(() => document.getElementById('boot-status').getBoundingClientRect().height);
    record('boot shell port-conflict error', { buttons, statusHeightPx: Math.round(lines) });
    await page.close();
  }

  // ── 5. Boot shell: normal startup progress ──
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: BOOT_VIEWPORT, colorScheme: theme });
    await page.addInitScript(bootBridgeStub);
    await page.goto(BOOT_URL);
    await page.waitForSelector('#boot-screen:not(.hidden)');
    await page.evaluate(() => window.__bootStatus({ status: 'starting' }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/desktop-boot-starting-${theme}.png` });
    record(`boot shell starting (${theme})`, { ok: true });
    await page.close();
  }

  // ── 6. Boot shell: first-run mode cards in the main window ──
  {
    const page = await browser.newPage({ viewport: BOOT_VIEWPORT });
    await page.addInitScript(bootBridgeStub);
    await page.goto(`${BOOT_URL}&modeSelect=true`);
    await page.waitForSelector('#mode-selection:not(.hidden)');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/desktop-boot-mode-select.png` });
    record('boot shell mode cards', { ok: true });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
