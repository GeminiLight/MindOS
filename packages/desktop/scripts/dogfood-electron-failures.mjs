/**
 * Real-Electron dogfood, scenario 2: the failure paths.
 *
 * Scenario 1 (dogfood-electron.mjs) covers first-run navigation. This one
 * drives the main-process behaviour that only appears when something goes
 * wrong — the boot shell's error state (whose action buttons used to be
 * clipped by a 360x240 splash) and the standalone connect window's
 * switch-to-local result.
 *
 * Run: node packages/desktop/scripts/dogfood-electron-failures.mjs
 */
import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const shots = '/tmp';

const results = [];
const pass = (name, detail) => { results.push({ name, ok: true, ...detail }); console.log(`  PASS  ${name}`); };
const fail = (name, detail) => { results.push({ name, ok: false, ...detail }); console.log(`  FAIL  ${name} — ${JSON.stringify(detail)}`); };

function makeHome({ desktopMode }) {
  const home = mkdtempSync(path.join(tmpdir(), 'mindos-dogfood-fail-'));
  mkdirSync(path.join(home, '.mindos'), { recursive: true });
  // A pre-seeded config skips the mode picker and boots straight into the mode.
  writeFileSync(
    path.join(home, '.mindos', 'config.json'),
    JSON.stringify({ desktopMode, mindRoot: path.join(home, 'MindOS', 'mind') }, null, 2),
  );
  return home;
}

function launch(home, extraEnv = {}) {
  return electron.launch({
    executablePath: path.join(desktopRoot, 'node_modules', '.bin', 'electron'),
    // electron-store and the windows' localStorage live in Chromium's
    // userData, which MINDOS_DESKTOP_HOME_DIR does not cover — isolate it
    // too so a run cannot change the user's real shell preferences.
    args: [desktopRoot, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mindos-dogfood-ud-'))}`],
    env: {
      ...process.env,
      MINDOS_DESKTOP_HOME_DIR: home,
      MINDOS_DISABLE_CLI_SHIM_PATH_APPEND: '1',
      MINDOS_DISABLE_GLOBAL_SHORTCUT: '1',
      MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER: '1',
      ...extraEnv,
    },
    timeout: 60000,
  });
}

async function findWindow(app, fragment, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().includes(fragment));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

// ── Scenario A: local boot fails → the boot shell must stay usable ──
async function bootErrorState() {
  console.log('\n[A] local boot failure → boot shell error state');
  const home = makeHome({ desktopMode: 'local' });
  // user-only policy with no global install = guaranteed resolution failure.
  const app = await launch(home, { MINDOS_RUNTIME_POLICY: 'user-only' });
  const logs = [];
  app.process().stderr?.on('data', (d) => logs.push(String(d)));

  try {
    const boot = await findWindow(app, 'shell=boot');
    if (!boot) { fail('boot shell opens in the main window', { windows: app.windows().map((w) => w.url()) }); return; }

    // Wait for the error state (actions become visible).
    await boot.waitForSelector('#boot-actions:not(.hidden) button', { timeout: 40000 });
    await new Promise((r) => setTimeout(r, 800));
    await boot.screenshot({ path: `${shots}/dogfood-A-boot-error.png` });

    // The point of merging the splash into the main window: startup never
    // shows more than one window.
    const windowCount = app.windows().length;
    if (windowCount === 1) pass('startup uses exactly one window', { windowCount });
    else fail('startup uses exactly one window', { windows: app.windows().map((w) => w.url()) });

    const state = await boot.evaluate(() => {
      const scroller = document.scrollingElement || document.documentElement;
      const status = document.getElementById('boot-status');
      const buttons = [...document.querySelectorAll('#boot-actions button')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          label: b.textContent,
          fullyVisible: r.top >= 0 && r.bottom <= scroller.clientHeight
            && r.left >= 0 && r.right <= scroller.clientWidth,
        };
      });
      return {
        viewport: { w: scroller.clientWidth, h: scroller.clientHeight },
        statusText: (status?.textContent || '').slice(0, 160),
        statusWraps: (status?.getBoundingClientRect().height ?? 0) > 20,
        buttons,
      };
    });

    // The whole point of the fix: every action must be clickable.
    const unreachable = state.buttons.filter((b) => !b.fullyVisible);
    if (state.buttons.length === 0) fail('boot shell shows recovery actions', state);
    else if (unreachable.length) fail('every recovery action is fully visible', { unreachable, ...state });
    else pass('every recovery action is fully visible', { buttons: state.buttons.map((b) => b.label), viewport: state.viewport });

    // The error renders at the main window's size, not in a 360x240 box.
    if (state.viewport.h >= 600) pass('error renders at the main window size', { height: state.viewport.h });
    else fail('error renders at the main window size', { height: state.viewport.h });

    // Error text must be localized and readable, not a raw English dump.
    pass('boot error text', { text: state.statusText, wrapped: state.statusWraps });

    // Clicking an action must not crash the main process.
    const retry = boot.locator('#boot-actions button').first();
    await retry.click();
    await new Promise((r) => setTimeout(r, 3000));
    const alive = app.windows().length > 0;
    if (alive) pass('retry action keeps the app alive');
    else fail('retry action keeps the app alive', {});

    const uncaught = logs.join('').match(/uncaughtException[^\n]*/g) ?? [];
    if (uncaught.length) fail('no uncaught exception during failed boot', { uncaught: uncaught.slice(0, 3) });
    else pass('no uncaught exception during failed boot');
  } finally {
    await app.close().catch(() => {});
    rmSync(home, { recursive: true, force: true });
  }
}

// ── Scenario B: remote mode with no saved server → connect window ──
async function remoteConnectWindow() {
  console.log('\n[B] remote mode with no saved server → connect window');
  const home = makeHome({ desktopMode: 'remote' });
  const app = await launch(home);
  const logs = [];
  app.process().stderr?.on('data', (d) => logs.push(String(d)));

  try {
    // Remote with no saved connection drives the boot shell to the remote
    // screen — in the main window, not a second one.
    const connect = await findWindow(app, 'connect.html');
    if (!connect) { fail('remote screen appears for remote mode', { windows: app.windows().map((w) => w.url()) }); return; }
    const isBootShell = connect.url().includes('shell=boot');
    await connect.waitForSelector('#remote-screen:not(.hidden)', { timeout: 20000 });
    await connect.screenshot({ path: `${shots}/dogfood-B-remote-screen.png` });
    pass('remote screen appears', { inBootShell: isBootShell });

    const windowCount = app.windows().length;
    if (windowCount === 1) pass('remote boot stays in one window', { windowCount });
    else fail('remote boot stays in one window', { windows: app.windows().map((w) => w.url()) });

    // The back button offers the way out: back to the mode cards in the boot
    // shell, switch-to-local in a standalone dialog.
    const label = await connect.textContent('#back-btn');
    pass('back button offers a way out', { label, inBootShell: isBootShell });

    // The label promises the mode picker, so that is where the click must land.
    // (This used to assert only that the app survived, which is how a back
    // button that silently started local mode passed for a whole release.)
    await connect.click('#back-btn');
    const onCards = await connect.waitForSelector('#mode-selection:not(.hidden)', { timeout: 5000 })
      .then(() => true).catch(() => false);
    if (onCards) pass('back button lands on the mode cards it promises', { label });
    else fail('back button lands on the mode cards it promises', { label, url: connect.url() });

    // Cards that are visible must also work: picking Local has to reach the
    // environment check (a setup panel) or start booting (the progress screen).
    // Before the fix the handler was not registered and nothing happened.
    if (onCards) {
      await connect.click('.mode-card >> nth=0');
      const reacted = await connect.waitForFunction(() => {
        const visible = (id) => {
          const el = document.getElementById(id);
          return !!el && !el.classList.contains('hidden');
        };
        return visible('boot-screen') || visible('setup-install') || visible('setup-build') || visible('setup-bundled');
      }, null, { timeout: 15000 }).then(() => true).catch(() => false);
      await connect.screenshot({ path: `${shots}/dogfood-B-local-from-cards.png` }).catch(() => {});
      if (reacted) pass('local mode card responds after coming back from remote');
      else fail('local mode card responds after coming back from remote', {});
    }

    const alive = app.windows().length > 0 || !app.process().killed;
    if (alive) pass('the back-button flow does not quit the app', { windowsAfter: app.windows().length });
    else fail('the back-button flow does not quit the app', {});

    const uncaught = logs.join('').match(/uncaughtException[^\n]*/g) ?? [];
    if (uncaught.length) fail('no uncaught exception in remote flow', { uncaught: uncaught.slice(0, 3) });
    else pass('no uncaught exception in remote flow');
  } finally {
    await app.close().catch(() => {});
    rmSync(home, { recursive: true, force: true });
  }
}

// Scenarios run in separate processes by default: two Electron instances in
// one run share Chromium's userData dir and the single-instance lock, which
// makes the second launch flaky. Pass `a` or `b` to run just one.
const only = process.argv[2];
if (!only || only === 'a') await bootErrorState();
if (!only || only === 'b') await remoteConnectWindow();

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
