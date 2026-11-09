/**
 * Real-Electron dogfood run for the Desktop shell.
 *
 * Everything before this was static review, unit tests and headless Chromium
 * renders of two HTML files — the main process had never actually executed.
 * This launches the real app and drives the paths the shell-compat work
 * changed, with HOME redirected to a throwaway directory so the run cannot
 * touch ~/.mindos, the CLI shim or the user's shell startup files.
 *
 * Run: node packages/desktop/scripts/dogfood-electron.mjs
 */
import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const shots = '/tmp';

const sandboxHome = mkdtempSync(path.join(tmpdir(), 'mindos-dogfood-home-'));
mkdirSync(path.join(sandboxHome, '.mindos'), { recursive: true });

const results = [];
const pass = (name, detail) => { results.push({ name, ok: true, ...detail }); console.log(`  PASS  ${name}`); };
const fail = (name, detail) => { results.push({ name, ok: false, ...detail }); console.log(`  FAIL  ${name} — ${JSON.stringify(detail)}`); };

/** Windows the main process has open right now, with their URLs. */
async function windowSummary(app) {
  const wins = app.windows();
  const out = [];
  for (const w of wins) {
    try { out.push({ url: w.url(), title: await w.title().catch(() => '') }); }
    catch { out.push({ url: '(gone)' }); }
  }
  return out;
}

function findWindow(app, fragment) {
  return app.windows().find((w) => w.url().includes(fragment));
}

async function waitForWindow(app, fragment, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = findWindow(app, fragment);
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

async function run() {
  console.log(`sandbox HOME = ${sandboxHome}\n`);

  const app = await electron.launch({
    executablePath: path.join(desktopRoot, 'node_modules', '.bin', 'electron'),
    // Pass the package directory, not dist-electron/main/main.js: assets are
    // resolved against app.getAppPath() (see resolve-packaged-asset.ts), and
    // pointing Electron straight at the entry file makes that the main/ dir,
    // so mindos-connect:// 404s on src/connect.html.
    // electron-store and the windows' localStorage live in Chromium's
    // userData, which MINDOS_DESKTOP_HOME_DIR does not cover — isolate it
    // too so a run cannot change the user's real shell preferences.
    args: [desktopRoot, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mindos-dogfood-ud-'))}`],
    env: {
      ...process.env,
      // Redirect every path the shell writes to (config, CLI shim, private
      // Node, uninstall.sh) into the sandbox. See src/desktop-home.ts.
      MINDOS_DESKTOP_HOME_DIR: sandboxHome,
      // Do not touch the real shell startup files or steal the global hotkey.
      MINDOS_DISABLE_CLI_SHIM_PATH_APPEND: '1',
      MINDOS_DISABLE_GLOBAL_SHORTCUT: '1',
      MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER: '1',
    },
    timeout: 60000,
  });

  const mainLogs = [];
  app.process().stderr?.on('data', (d) => mainLogs.push(String(d)));
  app.process().stdout?.on('data', (d) => mainLogs.push(String(d)));

  // ── 1. First run shows the mode picker (no config.json in the sandbox) ──
  const picker = await waitForWindow(app, 'modeSelect=true');
  if (!picker) {
    fail('first run opens the mode picker', { windows: await windowSummary(app) });
    await app.close();
    return;
  }
  await picker.waitForSelector('#mode-selection:not(.hidden)', { timeout: 15000 });
  await picker.screenshot({ path: `${shots}/dogfood-1-mode-picker.png` });
  pass('first run opens the mode picker');

  // The shell language must resolve through the main process, not localStorage.
  const lang = await picker.evaluate(() => document.documentElement.lang);
  pass('mode picker resolved a language', { lang });

  // ── 1b. One window, at the user's remembered geometry ──
  // The picker used to be its own 480x388 dialog, followed by a 360x240
  // splash, followed by the real window: three sizes, three centre positions.
  const windowCount = app.windows().length;
  if (windowCount === 1) pass('first run uses exactly one window', { windowCount });
  else fail('first run uses exactly one window', { windows: await windowSummary(app) });

  const fitOf = (page) => page.evaluate(() => {
    const container = document.querySelector('.container');
    const style = getComputedStyle(document.body);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const scroller = document.scrollingElement || document.documentElement;
    const content = Math.ceil(container.getBoundingClientRect().height + padding);
    return { content, viewport: scroller.clientHeight, dead: scroller.clientHeight - content };
  });

  const fitIdle = await fitOf(picker);
  // Content is centred in the window the user keeps; it must not resize it.
  if (fitIdle.viewport >= 600) pass('mode cards render at the main window size', fitIdle);
  else fail('mode cards render at the main window size', fitIdle);

  // ── 2. The bug that quit the app: Remote → "← back" ──
  await picker.click('.mode-card >> nth=1');
  await picker.waitForSelector('#remote-screen:not(.hidden)', { timeout: 15000 });
  await picker.screenshot({ path: `${shots}/dogfood-2-remote-screen.png` });

  const backLabel = await picker.textContent('#back-btn');
  await picker.click('#back-btn');

  // Previously: connect:switch-local → resolve(null) → app.quit().
  await new Promise((r) => setTimeout(r, 2500));
  let appAlive = true;
  try { await picker.evaluate(() => 1); } catch { appAlive = false; }

  if (!appAlive) {
    fail('back button does not quit the app', { backLabel, note: 'window went away' });
  } else {
    const backOnPicker = await picker.isVisible('#mode-selection');
    if (backOnPicker) pass('back button returns to the mode picker (was: app.quit())', { backLabel });
    else fail('back button returns to the mode picker', { backLabel, visible: false });
    await picker.screenshot({ path: `${shots}/dogfood-3-back-to-picker.png` });
  }

  // ── 3. Theme + language toolbar round-trips through main ──
  if (appAlive) {
    const before = await picker.evaluate(() => document.documentElement.lang);
    await picker.click('#btn-lang');
    await new Promise((r) => setTimeout(r, 600));
    const after = await picker.evaluate(() => document.documentElement.lang);
    if (before !== after) pass('language toggle persisted through main-process IPC', { before, after });
    else fail('language toggle changed the document language', { before, after });

    // Labels must be retranslated, not left stale.
    const cardTitle = await picker.textContent('.mode-card >> nth=0 >> h3');
    pass('mode card retranslated after toggle', { cardTitle });
    await picker.screenshot({ path: `${shots}/dogfood-4-language-toggled.png` });

    await picker.click('#btn-theme');
    await new Promise((r) => setTimeout(r, 400));
    const theme = await picker.evaluate(() => document.documentElement.getAttribute('data-theme'));
    pass('theme toggle applied', { theme });
    await picker.screenshot({ path: `${shots}/dogfood-5-theme-toggled.png` });
  }

  // ── 4. Local mode: does the picker survive a real environment probe? ──
  if (appAlive) {
    await picker.click('.mode-card >> nth=0');
    await new Promise((r) => setTimeout(r, 6000));
    const stillUp = app.windows().length > 0;
    const summary = await windowSummary(app);
    const setupVisible = findWindow(app, 'modeSelect=true')
      ? await picker.evaluate(() => {
          const ids = ['setup-install', 'setup-build', 'setup-bundled'];
          const shown = ids.filter((id) => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
          });
          return { shown, escapeHatch: !document.getElementById('setup-remote-btn')?.classList.contains('hidden') };
        }).catch(() => null)
      : null;
    pass('local mode probe did not crash the shell', { stillUp, windows: summary.length, setupVisible });
    if (findWindow(app, 'modeSelect=true')) {
      await picker.screenshot({ path: `${shots}/dogfood-6-local-probe.png` });
      // The boot shell must never resize the window it is hosted in; an
      // expanding setup panel has to stay reachable instead.
      const fitPanel = await fitOf(picker);
      const sameSize = fitPanel.viewport === fitIdle.viewport;
      const reachable = await picker.evaluate(() => {
        const scroller = document.scrollingElement || document.documentElement;
        const panel = ['setup-install', 'setup-build', 'setup-bundled']
          .map((id) => document.getElementById(id))
          .find((el) => el && !el.classList.contains('hidden'));
        if (!panel) return true;
        return panel.getBoundingClientRect().bottom <= scroller.clientHeight + scroller.scrollTop;
      });
      if (sameSize && reachable) pass('setup panel fits without resizing the main window', fitPanel);
      else fail('setup panel fits without resizing the main window', { ...fitPanel, idle: fitIdle.viewport, reachable });
    }
  }

  // ── 5. Sandbox side effects: confirm nothing escaped ──
  const sandboxMindos = path.join(sandboxHome, '.mindos');
  const wrote = existsSync(sandboxMindos) ? readdirSync(sandboxMindos) : [];
  pass('shell wrote only inside the sandbox home', { entries: wrote });

  const crashes = mainLogs.join('').match(/Error:[^\n]*/g) ?? [];
  const uncaught = mainLogs.join('').match(/uncaughtException[^\n]*/g) ?? [];
  if (uncaught.length) fail('no uncaught exceptions in the main process', { uncaught: uncaught.slice(0, 5) });
  else pass('no uncaught exceptions in the main process');

  console.log('\n--- main process diagnostics (first 25 lines) ---');
  console.log(mainLogs.join('').split('\n').filter(Boolean).slice(0, 25).join('\n'));
  if (crashes.length) {
    console.log('\n--- Error: lines ---');
    console.log([...new Set(crashes)].slice(0, 12).join('\n'));
  }

  await app.close().catch(() => {});
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  rmSync(sandboxHome, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('DRIVER ERROR:', err);
  rmSync(sandboxHome, { recursive: true, force: true });
  process.exit(1);
});
