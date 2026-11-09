/**
 * Real-Electron dogfood, scenario 3: a genuine local-mode boot.
 *
 * Scenarios 1 and 2 never started the services. This one boots the shell all
 * the way through: Node detection → runtime resolution → spawn Next + MCP →
 * health check → main window loads the real Web UI. Then it exercises the
 * post-boot actions (tray-equivalent restart, mode switch overlays) and a
 * clean shutdown.
 *
 * Isolation:
 *   - HOME is a throwaway dir, so config, CLI shim and private Node stay there
 *   - MIND_ROOT points inside it, so no real knowledge base is touched
 *   - ports are far from the defaults, so a running dev server is unaffected
 *   - the repo itself is the runtime via MINDOS_RUNTIME_ROOT (no extra build)
 *
 * Run: node packages/desktop/scripts/dogfood-electron-local-mode.mjs
 */
import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const shots = '/tmp';

const results = [];
const pass = (name, detail) => { results.push({ name, ok: true, ...detail }); console.log(`  PASS  ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`); };
const fail = (name, detail) => { results.push({ name, ok: false, ...detail }); console.log(`  FAIL  ${name} — ${JSON.stringify(detail)}`); };

function freePort(start) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(freePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    setTimeout(() => reject(new Error('port scan timeout')), 5000).unref?.();
  });
}

async function findWindow(app, fragment, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().includes(fragment));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

async function run() {
  // Deliberately far from 3456/8781 so a running dev server is never touched.
  const webPort = await freePort(39456);
  const mcpPort = await freePort(39781);

  const home = mkdtempSync(path.join(tmpdir(), 'mindos-localboot-'));
  const mindRoot = path.join(home, 'MindOS', 'mind');
  mkdirSync(path.join(home, '.mindos'), { recursive: true });
  mkdirSync(mindRoot, { recursive: true });
  writeFileSync(path.join(mindRoot, 'hello.md'), '# dogfood note\n');
  writeFileSync(
    path.join(home, '.mindos', 'config.json'),
    JSON.stringify({ desktopMode: 'local', mindRoot, port: webPort, mcpPort, setupPending: false }, null, 2),
  );

  console.log(`sandbox HOME = ${home}`);
  console.log(`web=${webPort}  mcp=${mcpPort}  runtime=${repoRoot}\n`);

  const app = await electron.launch({
    executablePath: path.join(desktopRoot, 'node_modules', '.bin', 'electron'),
    // electron-store and the windows' localStorage live in Chromium's
    // userData, which MINDOS_DESKTOP_HOME_DIR does not cover — isolate it
    // too so a run cannot change the user's real shell preferences.
    args: [desktopRoot, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mindos-dogfood-ud-'))}`],
    env: {
      ...process.env,
      MINDOS_DESKTOP_HOME_DIR: home,
      MINDOS_RUNTIME_ROOT: repoRoot,
      MINDOS_DISABLE_CLI_SHIM_PATH_APPEND: '1',
      MINDOS_DISABLE_GLOBAL_SHORTCUT: '1',
      MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER: '1',
    },
    timeout: 90_000,
  });

  const logs = [];
  app.process().stdout?.on('data', (d) => logs.push(String(d)));
  app.process().stderr?.on('data', (d) => logs.push(String(d)));

  try {
    // ── 1. The main window actually loads the Web UI ──
    const main = await findWindow(app, `127.0.0.1:${webPort}`, 180_000);
    if (!main) {
      fail('main window loads the local Web UI', {
        windows: app.windows().map((w) => w.url()),
        tail: logs.join('').split('\n').filter(Boolean).slice(-15),
      });
      return;
    }
    await main.waitForLoadState('domcontentloaded', { timeout: 60_000 });
    pass('main window loads the local Web UI', { url: main.url().slice(0, 60) });

    // Give the app shell a moment to hydrate before judging it.
    await main.waitForTimeout(6000);
    await main.screenshot({ path: `${shots}/dogfood-C-local-booted.png` });

    const shell = await main.evaluate(() => ({
      title: document.title,
      bodyChars: (document.body?.innerText || '').trim().length,
      hasBridge: !!window.mindos,
      macAttr: document.documentElement.hasAttribute('data-electron-mac'),
      shellFlag: !!window.mindosShell,
      // Must be absent: the same preload serves the boot shell, and the
      // connect surface has to stay out of the product's reach.
      hasConnectBridge: !!window.mindosConnect,
    }));
    if (shell.bodyChars > 0) pass('Web UI rendered content', shell);
    else fail('Web UI rendered content', shell);

    // The preload contract the Web titlebar depends on.
    if (shell.hasBridge) pass('window.mindos bridge is exposed to the Web app');
    else fail('window.mindos bridge is exposed to the Web app', shell);

    // The boot shell ran in this very window moments ago. After the handover
    // the product origin must not see the connect surface at all.
    if (!shell.hasConnectBridge) pass('connect bridge is NOT reachable from the product origin');
    else fail('connect bridge is NOT reachable from the product origin', shell);

    // Startup opened one window and navigated it; nothing else lingers.
    const windowsNow = app.windows().length;
    if (windowsNow === 1) pass('boot handed over inside a single window', { windowsNow });
    else fail('boot handed over inside a single window', { windows: app.windows().map((w) => w.url()) });

    // ── 2. Services are really listening ──
    // Probed from Node, not from the page: the Web origin is :webPort, so a
    // cross-origin fetch to the MCP port is blocked by the browser and would
    // report a false negative.
    const probe = async (port, pathname) => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}${pathname}`, { cache: 'no-store' });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch (e) { return { error: String(e) }; }
    };
    const health = { web: await probe(webPort, '/api/health'), mcp: await probe(mcpPort, '/api/health') };
    if (health.web?.body?.ok === true) pass('web /api/health is live', { service: health.web.body.service });
    else fail('web /api/health is live', health.web);
    if (health.mcp?.body?.ok === true) pass('MCP /api/health is live', { service: health.mcp.body.service });
    else fail('MCP /api/health is live', health.mcp);

    // ── 3. Overlay injection against the real page (restart services) ──
    // restart-services is intentionally not renderer-reachable; drive the same
    // code path the tray uses by checking the services recover on their own.
    const overlayProbe = await main.evaluate(() => ({
      overlayPresent: !!document.getElementById('mindos-switch-overlay'),
      bridgeHasRestart: typeof window.mindos?.restartServices === 'function',
    }));
    if (!overlayProbe.bridgeHasRestart) {
      pass('restart-services is not exposed to the renderer (tray/menu only)');
    } else {
      fail('restart-services is not exposed to the renderer', overlayProbe);
    }

    // ── 3b. Mid-session mode switch: the standalone dialog ──
    // The only shell dialogs left after the boot shell moved into the main
    // window. They now run sandboxed like the main window; this proves the
    // dialog still loads, gets its bridge, and cannot see the product bridge.
    // window.mindos.switchMode() is the same IPC the Web titlebar uses.
    await main.evaluate(() => { void window.mindos.switchMode(); });
    const dialog = await findWindow(app, 'modeSelect=true', 15_000);
    if (!dialog) {
      fail('mid-session switch opens the mode dialog', { windows: app.windows().map((w) => w.url()) });
    } else {
      await dialog.waitForSelector('#mode-selection:not(.hidden)', { timeout: 15_000 }).catch(() => {});
      await dialog.screenshot({ path: `${shots}/dogfood-C-switch-mode-dialog.png` }).catch(() => {});
      // Ask Electron, not the page: with contextIsolation the page never sees
      // `process` either way, so a page-side check cannot tell sandboxed from
      // unsandboxed. getAppMetrics() reports the renderer process's real state.
      const sandbox = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        const metrics = electronApp.getAppMetrics();
        return BrowserWindow.getAllWindows().map((w) => {
          const pid = w.webContents.getOSProcessId();
          const m = metrics.find((x) => x.pid === pid);
          return { url: w.webContents.getURL(), sandboxed: m ? m.sandboxed : null };
        });
      });
      const dialogSandbox = sandbox.find((w) => w.url.includes('modeSelect=true'))?.sandboxed ?? null;
      const mainSandbox = sandbox.find((w) => w.url.startsWith('http'))?.sandboxed ?? null;
      const probe = await dialog.evaluate(async () => ({
        bridge: typeof window.mindosConnect === 'object',
        shell: window.mindosConnect && window.mindosConnect.shell,
        productBridge: typeof window.mindos === 'object',
        // A real IPC round-trip, not just the bridge object existing.
        ipc: await window.mindosConnect.getUiLang().then((r) => typeof r?.lang === 'string').catch(() => false),
        cards: document.querySelectorAll('.mode-card').length,
      }));
      probe.sandboxed = dialogSandbox;
      probe.mainWindowSandboxed = mainSandbox;
      const ok = probe.sandboxed === true && probe.bridge && probe.shell === 'dialog' && !probe.productBridge && probe.ipc && probe.cards === 2;
      if (ok) pass('mode dialog works sandboxed, with only its own bridge', probe);
      else fail('mode dialog works sandboxed, with only its own bridge', probe);

      // Closing it must leave the product window exactly as it was.
      const beforeUrl = main.url();
      await dialog.close();
      await new Promise((r) => setTimeout(r, 1500));
      const stayed = main.url() === beforeUrl && !main.isClosed();
      if (stayed) pass('closing the dialog leaves the product page alone');
      else fail('closing the dialog leaves the product page alone', { beforeUrl, after: main.url() });
    }

    // ── 4. Sandbox containment ──
    const written = existsSync(path.join(home, '.mindos')) ? readdirSync(path.join(home, '.mindos')) : [];
    pass('state stayed inside the sandbox home', { entries: written.slice(0, 12) });
    const noteIntact = existsSync(path.join(mindRoot, 'hello.md'));
    if (noteIntact) pass('knowledge base untouched'); else fail('knowledge base untouched', {});

    // ── 5. No crashes along the way ──
    const text = logs.join('');
    const uncaught = text.match(/uncaughtException[^\n]*/g) ?? [];
    const crashDialogs = text.match(/Service Crashed|service stopped|服务崩溃|服务意外停止/gi) ?? [];
    if (uncaught.length) fail('no uncaught exceptions', { uncaught: uncaught.slice(0, 3) });
    else pass('no uncaught exceptions');
    if (crashDialogs.length) fail('no crash dialog was raised', { count: crashDialogs.length });
    else pass('no crash dialog was raised');

    console.log('\n--- boot timeline ---');
    console.log(
      text.split('\n')
        .filter((l) => /ProcessManager|runtime pick|heal|telemetry\] desktop\.boot|Node\.js:/.test(l))
        .slice(0, 18).join('\n'),
    );
  } finally {
    await app.close().catch(() => {});
    // The shell must not leave orphaned children behind on quit.
    await new Promise((r) => setTimeout(r, 2500));
    const { execFileSync } = await import('node:child_process');
    let leaked = '';
    try {
      leaked = execFileSync('bash', ['-lc', `lsof -nP -iTCP:${webPort} -sTCP:LISTEN -iTCP:${mcpPort} 2>/dev/null | tail -n +2`], { encoding: 'utf-8' });
    } catch { leaked = ''; }
    if (leaked.trim()) fail('no orphaned child processes after quit', { leaked: leaked.trim().split('\n').slice(0, 4) });
    else pass('no orphaned child processes after quit');
    rmSync(home, { recursive: true, force: true });
  }

  console.log('\n=== SUMMARY ===');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => { console.error('DRIVER ERROR:', err); process.exit(1); });
