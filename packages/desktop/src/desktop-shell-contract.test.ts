import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { en } from './i18n/en';
import { zh } from './i18n/zh';

const read = (...parts: string[]) => readFileSync(path.join(__dirname, ...parts), 'utf-8').replace(/\r\n/g, '\n');

const connectWindow = read('connect-window.ts');
// The mode cards' environment probing and the local-setup panels moved into
// their own modules when the boot shell pushed both files past 1000 lines.
const modeHandlers = read('connect-mode-handlers.ts');
const connectSetup = read('connect-setup.ts');
const connectScreens = read('connect-renderer.ts');
const connectDom = read('connect-dom.ts');
const connectSsh = read('connect-ssh.ts');
/** The connect window renderer is split across three modules; assert on all of them. */
const connectRenderer = connectScreens + connectDom + connectSsh;
const connectHtml = read('connect.html');
const mainSource = read('main.ts');
/** The renderer-facing IPC surface, including uninstall, lives here now. */
const ipcSource = read('ipc-handlers.ts');

describe('connect / mode-select navigation contract', () => {
  // Regression: on first run, picking Remote and then pressing
  // "← Switch to Local Mode" resolved null, which app.whenReady() read as a
  // cancellation and turned into app.quit().
  it('distinguishes connected, switch-local and cancelled outcomes', () => {
    expect(connectWindow).toContain("{ kind: 'connected'; url: string }");
    expect(connectWindow).toContain("{ kind: 'switch-local' }");
    expect(connectWindow).toContain("{ kind: 'cancelled' }");
    // The only `resolve(null)`-shaped exit is the mode picker's own close path.
    expect(connectWindow).not.toContain('resolve(null);\n    safeClose();');
  });

  it('resolves the mode picker to a mode rather than null when switching to local', () => {
    expect(connectWindow).toContain("if (result.kind === 'switch-local') return 'local';");
    expect(connectWindow).toContain("if (result.kind === 'connected') return 'remote';");
  });

  it('treats a closed connect window as cancelled, not as a local-mode choice', () => {
    expect(connectWindow).toContain("return { kind: 'cancelled' };");
  });

  it('never quits the app when the user asked for local mode', () => {
    expect(mainSource).toContain("outcome.kind === 'switch-local'");
    expect(mainSource).toContain("if (result.kind === 'switch-local') {");
    // bootApp re-opens the splash with choices instead of leaving no window.
    expect(mainSource).toContain("id: 'select-mode', label: 'selectMode'");
  });

  it('keeps the first-run back button inside the window instead of resolving', () => {
    expect(connectRenderer).toContain('if (isModeSelectWindow) {');
    expect(connectRenderer).toContain('showModeSelection();');
    expect(connectRenderer).toContain("setLabel($('back-btn'), 'backToModes')");
  });
});

describe('setup panel contract', () => {
  // Regression: showBuildSection() replaced #local-setup's innerHTML, which
  // permanently destroyed the install button — a dead end with no way back.
  it('ships install, build and bundled panels as separate static sections', () => {
    for (const id of ['setup-install', 'setup-build', 'setup-bundled']) {
      expect(connectHtml).toContain(`id="${id}"`);
    }
    expect(connectHtml).toContain('id="install-btn"');
    expect(connectHtml).toContain('id="build-btn"');
  });

  it('never rebuilds a setup panel by assigning innerHTML', () => {
    for (const src of [connectRenderer, connectSetup]) {
      expect(src).not.toMatch(/setupSection\.innerHTML\s*=/);
      expect(src).not.toMatch(/\.innerHTML\s*=\s*`/);
    }
  });

  it('routes a re-check back to whichever panel matches the detected state', () => {
    expect(connectSetup).toContain('async function recheckEnvironment()');
    expect(connectSetup).toContain("showSetupPanel('install')");
    expect(connectSetup).toContain("showSetupPanel('build')");
    expect(connectSetup).toContain("showSetupPanel('bundled')");
  });
});

describe('SSH cancellation contract', () => {
  // Regression: "cancel" only reset the renderer buttons. The tunnel kept being
  // built and either closed the window behind the user or leaked an ssh child.
  it('asks main to abort the in-flight tunnel', () => {
    expect(connectRenderer).toContain('ipc?.cancelSsh()');
    expect(connectWindow).toContain("safeHandle('connect:ssh-cancel'");
    expect(connectWindow).toContain('abandonTunnel(activeTunnel)');
  });

  it('checks the cancellation flag after every await in the connect handler', () => {
    const handler = connectWindow.slice(
      connectWindow.indexOf("safeHandle('connect:ssh-connect'"),
      connectWindow.indexOf("safeHandle('connect:ssh-add-key'"),
    );
    expect(handler.split('attempt.cancelled').length - 1).toBeGreaterThanOrEqual(5);
    expect(handler).toContain('await abandonTunnel(tunnel)');
  });
});

describe('long-running command contract', () => {
  // Regression: promisify(exec) with the default 1 MB maxBuffer killed real
  // `npm install && next build` runs and reported the success as a failure.
  it('runs build and install through the streaming runner', () => {
    expect(modeHandlers).not.toMatch(/require\(['"]util['"]\)/);
    expect(modeHandlers).not.toContain('execBuild(');
    expect(modeHandlers).not.toContain('execInstall(');
    expect(modeHandlers).not.toContain("'npm install && npm run build'");
    expect(modeHandlers).toContain('runCommandSequence(');
    expect(modeHandlers).toContain('runCommand(');
  });

  it('bounds retained output instead of buffering the whole stream', () => {
    const runner = read('run-command.ts');
    expect(runner).toContain('class TailBuffer');
    expect(runner).not.toMatch(/^\s*maxBuffer\s*:/m);
  });
});

describe('window overflow contract', () => {
  // Regression: both windows centred their content with flex and clipped
  // anything taller than the (non-resizable) window — including the startup
  // action buttons, exactly when the user needed to click Retry.
  it('lets the connect window scroll and be resized', () => {
    expect(connectHtml).toContain('overflow-y: auto');
    expect(connectHtml).toContain('margin: auto');
    expect(connectHtml).not.toMatch(/body\s*\{[^}]*align-items:\s*center/);
    expect(connectWindow).toContain('resizable: true');
    expect(connectWindow).toContain('minHeight:');
  });

  it('keeps boot errors and their actions reachable at the minimum window size', () => {
    // The old splash was 360x240 and had to grow to 460x420 to fit an error
    // with three buttons. The boot shell inherits the connect page's scroll
    // container instead, so there is no size it can be clipped at.
    const bootCss = connectHtml.slice(connectHtml.indexOf('.boot-screen {'));
    expect(bootCss).toContain('.boot-actions');
    expect(connectHtml).toContain('overflow-y: auto');
    expect(connectHtml).toContain('min-height: 100vh');
  });
});

describe('boot shell lifecycle', () => {
  const bootShell = read('boot-shell.ts');

  // The connect:* channels are reachable from the main window while the boot
  // shell is up. The whole security argument for that is the ordering below:
  // they are handed back before a page from the product origin can exist.
  it('releases the connect channels before navigating to the product', () => {
    const bootApp = mainSource.slice(
      mainSource.indexOf('async function bootApp()'),
      mainSource.indexOf('function installMainWindowLoadHandlers('),
    );
    const release = bootApp.indexOf('releaseBootShell();');
    const navigate = bootApp.indexOf('win.loadURL(loadUrl);');
    expect(release).toBeGreaterThan(-1);
    expect(navigate).toBeGreaterThan(-1);
    expect(release).toBeLessThan(navigate);
  });

  it('pins the sender on the boot action channel', () => {
    expect(bootShell).toContain('event.sender !== entry.window.webContents');
    expect(bootShell).toContain('Refused shell:action');
  });

  it('replays the last status once the renderer is listening', () => {
    // Healing progress can beat first paint; the splash dropped those messages
    // and opened on a phase that had already passed.
    expect(bootShell).toContain("win.webContents.once('did-finish-load'");
    expect(bootShell).toContain('entry.pending');
    expect(bootShell).toContain('entry.ready = true;');
  });

  it('re-arms the outcome so a retry does not read the previous answer', () => {
    expect(bootShell).toContain('if (entry.settled) arm(entry);');
  });

  // Regression (#409): the boot shell only registered the mode-card handlers
  // on first run, yet two paths show the cards on any run — the "select mode"
  // recovery action, and the back button on the remote screen. The cards were
  // visible but dead: clicking Local invoked a channel nobody handled.
  it('registers the mode-card handlers on every run, not just the first', () => {
    const armFn = bootShell.slice(bootShell.indexOf('function arm('), bootShell.indexOf('export function showBootShell('));
    expect(armFn).toContain('includeModeSelect: true');
    expect(armFn).not.toContain('includeModeSelect: entry.modeSelect');
  });

  // Same regression: the back button read "← Back to mode selection" but,
  // outside first run, called switchToLocal() — silently starting local mode
  // without the environment check the cards perform.
  it('sends the back button to the mode cards whenever it is in the boot shell', () => {
    const handleBack = connectRenderer.slice(
      connectRenderer.indexOf('function handleBack('),
      connectRenderer.indexOf('function installKeyboardShortcuts('),
    );
    expect(handleBack).toContain('if (isModeSelectWindow || isBootShell)');
    expect(connectRenderer).toMatch(/^let isBootShell = false;/m);
  });

  it('is a no-op once the window has moved on to the product', () => {
    // Long local-mode phases keep reporting after a retry already succeeded.
    const status = bootShell.slice(bootShell.indexOf('export function shellStatus('));
    expect(status).toContain('if (!entry || entry.window.isDestroyed()) return;');
  });
});

describe('connect IPC ownership', () => {
  it('refuses invocations from anything but the surface that registered them', () => {
    // Registration alone used to be the whole gate: while any connect window
    // was open, any renderer could invoke connect:ssh-connect.
    expect(connectWindow).toContain('handlerOwnerContents');
    expect(connectWindow).toContain('event.sender !== handlerOwnerContents');
    expect(connectWindow).toMatch(/Refused \$\{channel\}/);
  });

  it('clears the pinned sender when the surface is released', () => {
    const release = connectWindow.slice(connectWindow.indexOf('function releaseHandlers('));
    expect(release.slice(0, 400)).toContain('handlerOwnerContents = null;');
  });
});


describe('brand and iconography', () => {
  // wiki/21-design-principle.md defines the Asymmetric Infinity as the mark.
  // The shell printed the text glyph `∞`, so the very first frame of the
  // product showed a mark the product itself never uses.
  it('renders the Asymmetric Infinity, not the text glyph', () => {
    for (const [name, src] of [['connect.html', connectHtml]] as const) {
      // The glyph may still appear inside an explanatory comment.
      const markup = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(markup.includes('∞'), `${name} still prints the ∞ glyph`).toBe(false);
      // Dashed human side, solid agent side, sparkle at the crossing.
      expect(src, name).toContain('stroke-dasharray="2 4"');
      expect(src, name).toContain('stroke-width="4.5"');
      expect(src, name).toContain('var(--logo-sparkle)');
      expect(src, name).toContain('--logo-sparkle: #FEF3C7');
    }
  });

  it('uses line icons rather than emoji for the mode cards', () => {
    // `u` matters: without it the class holds lone surrogate halves, which
    // match any astral character, not just these.
    expect(connectHtml).not.toMatch(/[⚡🌐📦🔨🔍💡🔒⏳✅❌]/u);
    const localCard = connectHtml.slice(connectHtml.indexOf('ariaLocalMode'), connectHtml.indexOf('ariaRemoteMode'));
    expect(localCard).toContain('<svg');
    expect(localCard).toContain('stroke="currentColor"');
  });

  it('keeps pictographic emoji out of the translated copy', () => {
    // Emoji render differently per OS (breaking 同类同形) and read as toy-like.
    // Monochrome marks stay: they inherit text colour, render identically
    // everywhere, and carry state when colour alone is not perceivable.
    const ALLOWED = new Set(['✓', '✗', '⚠', '←', '→', '↑', '↓', '·', '—', '…', '≥', '≤']);
    // VS16 (U+FE0F) is a separate alternative, not a class member: it is a
    // combining mark, and inside a class it reads as if it combined.
    const SYMBOL_RANGE = /[\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}]|\u{FE0F}/u;
    for (const [name, dict] of [['zh', zh], ['en', en]] as const) {
      for (const [key, value] of Object.entries(dict)) {
        const offenders = Array.from(value).filter((ch) => SYMBOL_RANGE.test(ch) && !ALLOWED.has(ch));
        expect(offenders, `${name}.${key} contains emoji ${JSON.stringify(offenders)} in: ${value}`).toEqual([]);
      }
    }
  });
});

describe('keyboard affordances', () => {
  // Principle 2 is "Keyboard First, Mouse Welcome"; the shell shipped no
  // discoverable shortcut beyond Enter inside a text field.
  it('offers number, arrow and Enter handling on the mode picker', () => {
    expect(connectRenderer).toContain('function installKeyboardShortcuts()');
    expect(connectRenderer).toContain("e.key === '1' || e.key === '2'");
    expect(connectRenderer).toContain("e.key === 'ArrowDown' || e.key === 'ArrowUp'");
  });

  it('treats Escape as "back one level"', () => {
    expect(connectRenderer).toContain("e.key === 'Escape'");
    expect(connectRenderer).toContain('handleBack();');
  });

  it('ignores shortcuts while the user is typing or holding a modifier', () => {
    expect(connectRenderer).toContain("target.tagName === 'INPUT'");
    expect(connectRenderer).toContain('e.metaKey || e.ctrlKey || e.altKey');
  });

  it('shows the shortcuts instead of hiding them', () => {
    expect(connectHtml).toContain('id="kbd-hint-modes"');
    expect(connectHtml).toContain('id="kbd-hint-remote"');
    expect(connectRenderer).toContain('function renderKeyboardHints()');
    // Built from DOM nodes: the translation is never parsed as markup.
    expect(connectRenderer).toContain("document.createElement('kbd')");
  });
});

describe('saved-server reachability', () => {
  // `.recent-dot.online` existed in CSS but nothing ever applied it, so every
  // saved server showed the same permanently grey dot.
  it('probes each saved server and reflects the result', () => {
    expect(connectRenderer).toContain('async function probeReachability(');
    expect(connectRenderer).toContain("dot.classList.toggle('online'");
    expect(connectRenderer).toContain("dot.classList.toggle('offline'");
    expect(connectHtml).toContain('.recent-dot.offline');
    expect(connectHtml).toContain('.recent-dot.checking');
  });

  it('caches results so a language toggle does not re-probe every server', () => {
    expect(connectRenderer).toContain('const reachability = new Map<');
  });

  it('leaves ssh:// entries neutral — they need a tunnel before they answer', () => {
    expect(connectRenderer).toContain("address.startsWith('ssh://')");
  });
});

describe('boot error hierarchy', () => {
  const connectBoot = read('connect-boot.ts');

  // A 36px wordmark above a 12px error told the user which app had failed,
  // not what to do about it.
  it('demotes the brand and promotes the message when something breaks', () => {
    expect(connectHtml).toContain('body.has-error .boot-screen .brand-word');
    expect(connectHtml).toContain('body.has-error .boot-status');
    expect(connectBoot).toContain("document.body.classList.add('has-error')");
    expect(connectBoot).toContain("document.body.classList.remove('has-error')");
  });

  it('never clips verbatim command output in an error', () => {
    const errorCss = connectHtml.slice(connectHtml.indexOf('body.has-error .boot-status'));
    expect(errorCss.slice(0, 400)).toContain('white-space: pre-wrap');
    expect(errorCss.slice(0, 400)).toContain('overflow-wrap: anywhere');
  });

  it('shows elapsed time so a multi-minute first build is not mistaken for a hang', () => {
    expect(connectBoot).toContain('ELAPSED_VISIBLE_AFTER_MS');
    expect(connectBoot).toContain('function startPhase(');
    expect(connectBoot).toContain('function stopElapsed(');
    expect(connectBoot).toContain('FIRST_RUN_HINT_AFTER_MS');
  });

  it('keeps the phase as a descriptor so a language toggle retranslates it', () => {
    // The splash stored rendered text and froze in whatever language it
    // started in, which a 3-minute build made very visible.
    expect(connectBoot).toContain('export function refreshBootScreen()');
    expect(read('connect-renderer.ts')).toContain('refreshBootScreen();');
  });

  it('disables the remaining actions once one is clicked', () => {
    expect(connectBoot).toContain('.disabled = true;');
  });
});

describe('one appearance source for the whole shell', () => {
  // Language already resolved through the main process; theme did not, so the
  // splash followed the OS, the connect window followed its own localStorage,
  // and the main window painted a hardcoded light backdrop.
  it('persists the theme in the main process, with localStorage only as a hint', () => {
    expect(connectWindow).toContain("safeHandle('connect:get-ui-theme'");
    expect(connectWindow).toContain("safeHandle('connect:set-ui-theme'");
    expect(read('connect-bridge.ts')).toContain("ipcRenderer.invoke('connect:set-ui-theme'");
    expect(connectRenderer).toContain('async function syncThemeFromMain()');
    expect(connectRenderer).toContain('setUiTheme(next)');
  });

  it('seeds the renderer state from the same hint the pre-paint script used', () => {
    // Starting at 'system' regardless let a stale localStorage value win: the
    // first sync compared 'system' to 'system' and never corrected the DOM.
    expect(connectRenderer).toContain('let themePreference: ThemePreference = readThemeHint();');
  });

  it('gives the boot shell the same pre-paint theme as every other shell surface', () => {
    // The splash had its own bootstrap and its own sync IPC channel, and
    // followed the OS even when the user had chosen a theme explicitly. The
    // boot shell is connect.html, so it inherits the one that already works.
    expect(connectHtml).toContain("localStorage.getItem('mindos-connect-theme')");
    expect(connectHtml).toContain('html[data-theme="dark"]');
    expect(read('connect-bridge.ts')).toContain("ipcRenderer.invoke('connect:get-ui-theme')");
  });

  it('paints every window with the resolved backdrop instead of a fixed colour', () => {
    expect(mainSource).toContain('backgroundColor: currentWindowBackground()');
    expect(mainSource).not.toContain("backgroundColor: '#f8f6f1'");
    expect(connectWindow).toContain('backgroundColor: currentWindowBackground()');
  });
});

describe('windows sized to their content', () => {
  // Natural content is ~363 (mode picker) / ~401 (remote screen); the windows
  // were fixed at 600 / 640, so ~40% of each was dead space — and the crowded
  // panels still overflowed.
  it('opens close to the natural content height', () => {
    expect(connectWindow).toContain('const MODE_SELECT_HEIGHT = 420;');
    expect(connectWindow).toContain('height: 470,');
    expect(connectWindow).not.toContain('height: 640,');
  });

  it('resizes to measured content, clamped by main', () => {
    expect(connectRenderer).toContain('function fitWindowToContent()');
    expect(connectWindow).toContain("safeHandle('connect:fit-window'");
    // Main owns the clamp: only it knows the work area.
    expect(connectWindow).toContain('workAreaSize');
    expect(connectWindow).toContain('Math.min(maxHeight');
    expect(connectWindow).toContain('CONNECT_WINDOW_DEFAULTS.minHeight');
  });

  it('coalesces the measurement bursts that follow a re-render', () => {
    expect(connectRenderer).toContain('clearTimeout(fitTimer)');
  });

  it('releases the fit handler with the rest when the window closes', () => {
    expect(connectWindow).toContain('FIT_CHANNEL');
    // Released with the rest of the surface's channels, and only registered
    // for surfaces that may resize (never the boot shell in the main window).
    expect(connectWindow).toContain('...(options.allowFit ? [FIT_CHANNEL] : [])');
    expect(connectWindow).toContain('releaseHandlers(owner, channels)');
  });
});

describe('connect window hardening', () => {  it('declares a content security policy', () => {
    expect(connectHtml).toContain('http-equiv="Content-Security-Policy"');
    expect(connectHtml).toContain("connect-src 'none'");
  });

  it('only injects allowlisted translations as markup', () => {
    expect(connectRenderer).toContain('HTML_I18N_KEYS.has(key)');
    expect(connectRenderer).toContain('document.createTextNode(text)');
  });

  it('does not reference a font it never loads', () => {
    expect(connectHtml).not.toContain("'Lora'");
  });
});

describe('renderer translation dictionaries', () => {
  it('define exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it('have no empty strings', () => {
    for (const [key, value] of Object.entries({ ...zh })) {
      expect(value, `zh.${key}`).toBeTruthy();
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key}`).toBeTruthy();
    }
  });

  it('keep Han characters out of the English dictionary', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(/[一-鿿]/.test(value), `en.${key} contains Han characters`).toBe(false);
    }
  });

  it('are fully used by the connect UI or produced as error codes by main', () => {
    // Error codes are emitted by connect-window.ts / connection-sdk.ts and
    // translated in the renderer, so both sides count as usage.
    const surface = connectRenderer + connectHtml + connectWindow + modeHandlers
      + connectSetup + read('connection-sdk.ts') + read('connect-boot.ts');
    const unused = Object.keys(zh).filter(
      (key) => !surface.includes(`'${key}'`) && !surface.includes(`"${key}"`),
    );
    expect(unused).toEqual([]);
  });

  it('localize accessible names instead of hardcoding English', () => {
    expect(connectHtml).toContain('data-i18n-aria="ariaToolbar"');
    expect(connectHtml).toContain('data-i18n-aria="ariaLocalMode"');
    expect(connectRenderer).toContain("querySelectorAll<HTMLElement>('[data-i18n-aria]')");
  });
});

describe('shared shell language', () => {
  it('routes every shell surface through getUiLang', () => {
    for (const file of ['main.ts', 'tray.ts', 'app-menu.ts', 'install-cli-shim.ts', 'connect-window.ts']) {
      expect(read(file), `${file} still reads app.getLocale() directly`).not.toMatch(
        /app\.getLocale\(\)\s*\?\.\s*(toLowerCase\(\)\s*\.)?startsWith\('zh'\)/,
      );
    }
    expect(read('tray.ts')).toContain("getUiLang() === 'zh'");
    expect(read('app-menu.ts')).toContain("getUiLang() === 'zh'");
  });

  it('gives the boot shell the same resolved language as every other shell surface', () => {
    expect(read('connect-bridge.ts')).toContain("ipcRenderer.invoke('connect:get-ui-lang')");
    expect(connectRenderer).toContain('void syncLangFromMain();');
  });

  it('persists the connect window toggle in the main process', () => {
    expect(read('connect-bridge.ts')).toContain("ipcRenderer.invoke('connect:set-ui-lang'");
    expect(connectWindow).toContain("safeHandle('connect:set-ui-lang'");
    expect(connectRenderer).toContain('ipc.setUiLang(next)');
  });
});

describe('uninstall completeness', () => {
  // Regression: macOS/AppImage uninstall only trashed the bundle, leaving the
  // CLI shim, private Node, cached runtimes and shell-rc PATH lines behind.
  it('runs the generated cleanup script before trashing the app', () => {
    expect(ipcSource).toContain('runDesktopCleanupScript');
    expect(ipcSource).toContain("path.join(CONFIG_DIR, 'uninstall.sh')");
    const uninstall = ipcSource.slice(
      ipcSource.indexOf("handleLocalOnly('uninstall-app'"),
      ipcSource.indexOf('async function runDesktopCleanupScript'),
    );
    expect(uninstall.indexOf('runDesktopCleanupScript()')).toBeLessThan(uninstall.indexOf('shell.trashItem'));
  });

  it('localizes the manual-uninstall guidance', () => {
    expect(ipcSource).toContain("mt('uninstallPackageManager')");
    expect(ipcSource).toContain("mt('uninstallNoUninstaller'");
  });
});

describe('connect UI polish', () => {
  it('shows an unnamed server once, not as both its name and its address', () => {
    const builder = connectRenderer.slice(
      connectRenderer.indexOf('function buildRecentItem('),
      connectRenderer.indexOf("forgetBtn.type = 'button';"),
    );
    expect(builder).toContain('if (conn.label && conn.label !== conn.address)');
  });

  it('joins a label to its detail with a translatable separator', () => {
    // A literal ": " put an ASCII colon into Chinese ("安装失败: npm ERR!") and
    // could not follow a language toggle.
    const dom = read('connect-dom.ts');
    const setup = read('connect-setup.ts');
    expect(dom).not.toContain("{ text: `: ${");
    expect(dom).not.toContain("{ text: ': ' }");
    expect(setup).not.toMatch(/\$\{t\('(build|install)Error'\)\}: /);
    expect(zh.labelSeparator).toBe('：');
    expect(en.labelSeparator).toBe(': ');
  });

  it('gives a failed boot a title, not just a paragraph', () => {
    expect(connectHtml).toContain('id="boot-title"');
    expect(read('connect-boot.ts')).toContain("setLabel(title, 'bootFailed');");
  });

  it('sets the explanation in body colour and commands in a copyable block', () => {
    const css = connectHtml.slice(connectHtml.indexOf('body.has-error .boot-status {'));
    expect(css.slice(0, 500)).toContain('color: var(--foreground)');
    expect(connectHtml).toContain('.boot-code {');
    expect(connectHtml).toMatch(/\.boot-code \{[^}]*user-select: all/);
  });
});

describe('remote mode module', () => {
  const remote = read('remote-mode.ts');
  const start = remote.slice(remote.indexOf('export async function startRemoteMode('), remote.indexOf('function fromConnectWindow('));

  it('tries the saved server, then the last SSH tunnel, and only then asks', () => {
    const saved = start.indexOf('getActiveRemoteConnection()');
    const ssh = start.indexOf('getLastSshConnection()');
    const ask = start.lastIndexOf('await prompt()');
    expect(saved).toBeGreaterThan(-1);
    expect(ssh).toBeGreaterThan(saved);
    expect(ask).toBeGreaterThan(ssh);
  });

  it('checks server compatibility before trusting a saved connection', () => {
    expect(start.indexOf('confirmRemoteCompatible(')).toBeLessThan(start.indexOf('getLastSshConnection()'));
  });

  it('lives outside main.ts, like local mode', () => {
    expect(mainSource).not.toContain('async function startRemoteMode(');
    expect(mainSource).toContain("from './remote-mode'");
  });
});
