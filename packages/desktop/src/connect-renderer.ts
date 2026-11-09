/**
 * Connect window renderer script
 * Handles mode selection, connection testing, and server connection.
 *
 * All event binding via addEventListener (no inline onclick) for CSP
 * compatibility and reliable error handling in packaged Electron.
 *
 * Two invariants worth keeping:
 *  - every piece of visible text is driven by an i18n key, so toggling the
 *    language retranslates dynamic panels too (status bars, button labels);
 *  - translations are injected as text, never innerHTML. The one markup sink is
 *    `insertAdjacentHTML` in `connect-dom.ts`, gated on the small `HTML_I18N_KEYS`
 *    allowlist; the only innerHTML here is the theme toggle icon, assigned from
 *    the static `ICON_SUN` / `ICON_MOON` literals.
 */

import { getLang, setLang, t, translations, type I18nKeys, type Lang } from './i18n/index';
import {
  $,
  applyI18nToElement,
  failureParts,
  fitWindowToContent,
  getIpc,
  renderAllStatuses,
  renderKeyboardHints,
  setLabel,
  setStatus,
  type RecentConnection,
  type StatusPart,
  type TestResult,
  type ThemePreference,
  type UiLangPreference,
} from './connect-dom';
import {
  cancelSshConnect,
  handleSshConnect,
  isSshConnecting,
  loadSshHosts,
  resetSshFlowState,
} from './connect-ssh';
import {
  buildMindOS,
  installMindOS,
  recheckEnvironment,
  setBuildModulePath,
  setSetupHeading,
  showSetupPanel,
} from './connect-setup';
import {
  applyBootStatus,
  isBootScreenVisible,
  refreshBootScreen,
  showBootScreen,
} from './connect-boot';

let testResult: TestResult | null = null;
let recentConnections: RecentConnection[] = [];
let sshConnections: RecentConnection[] = [];


/** True when this window is the first-run mode picker (vs. the standalone connect window). */
let isModeSelectWindow = false;
/**
 * True when hosted inside the main window during startup rather than in a
 * dialog. The screens are the same; what differs is that this page does not
 * own its window — it cannot resize it, and it never closes itself. Main
 * navigates it to the product once services are up.
 */
let isBootShell = false;

// ── i18n application ──

function applyI18n(lang: Lang): void {
  setLang(lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => applyI18nToElement(el, lang));
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder') as I18nKeys;
    const text = translations[lang]?.[key];
    if (text != null) el.placeholder = text;
  });
  // Accessible names used to be hardcoded English regardless of UI language.
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria') as I18nKeys;
    const text = translations[lang]?.[key];
    if (text != null) el.setAttribute('aria-label', text);
  });

  renderAllStatuses();
  renderRecent();
  renderSshRecent();
  renderKeyboardHints();
  // The boot phase and its action buttons are descriptors, not baked strings,
  // so a language toggle mid-build retranslates them too.
  refreshBootScreen();
  updateToolbarAccessibility();
  fitWindowToContent();
}

// ── Theme / language preferences (default: follow system; no flicker — head script + connect-hydrating) ──

const ICON_SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const ICON_MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

/**
 * Theme preference now lives in the main process alongside the language, so
 * the boot shell, the connect dialogs and the main-window backdrop agree. The
 * localStorage copy survives only as a pre-paint hint for the inline head
 * script; the main process holds the truth.
 */
/**
 * Seeded from the same hint the pre-paint head script used, so this variable
 * and the DOM start in agreement. Initialising it to 'system' regardless let a
 * stale localStorage value win silently: the first sync compared 'system' to
 * 'system', saw no difference, and never corrected the attribute the hint had
 * already applied.
 */
let themePreference: ThemePreference = readThemeHint();

function cacheThemeHint(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem('mindos-connect-theme');
    else localStorage.setItem('mindos-connect-theme', pref);
  } catch { /* sandboxed */ }
}

function readThemeHint(): ThemePreference {
  try {
    const v = localStorage.getItem('mindos-connect-theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* sandboxed */ }
  return 'system';
}

function getThemePreference(): ThemePreference {
  return themePreference;
}

function applyThemeToDom(pref: ThemePreference): void {
  themePreference = pref;
  cacheThemeHint(pref);
  if (pref === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else if (pref === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

/** Resolved appearance (system uses OS preference). */
function getEffectiveColorScheme(): 'light' | 'dark' {
  const pref = getThemePreference();
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Toggle only light ↔ dark. Default (no storage) follows system until first click. */
async function toggleTheme(): Promise<void> {
  const pref = getThemePreference();
  const next: 'light' | 'dark' =
    pref === 'system'
      ? (getEffectiveColorScheme() === 'dark' ? 'light' : 'dark')
      : pref === 'light'
        ? 'dark'
        : 'light';
  applyThemeToDom(next);
  syncThemeIcon();
  updateToolbarAccessibility();
  try {
    await getIpc()?.setUiTheme(next);
  } catch (err) {
    console.warn('[MindOS] Could not persist the shell theme:', err);
  }
}

/** Adopt whatever the main process holds (it also drives the boot shell and the main window). */
async function syncThemeFromMain(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;
  try {
    const { preference } = await ipc.getUiTheme();
    // Applied unconditionally: the DOM may have been seeded from a stale hint
    // even when the preference value itself happens to match.
    applyThemeToDom(preference);
    syncThemeIcon();
    updateToolbarAccessibility();
  } catch (err) {
    console.warn('[MindOS] Could not read the shell theme:', err);
  }
}

function syncThemeIcon(): void {
  const btn = $('btn-theme');
  if (!btn) return;
  btn.innerHTML = getEffectiveColorScheme() === 'dark' ? ICON_MOON : ICON_SUN;
}

/**
 * Language preference now lives in the main process so the boot shell, tray, menu
 * and every dialog follow the same choice. localStorage is kept purely as a
 * pre-paint hint for the inline head script.
 */
let langPreference: UiLangPreference = 'system';

function cacheLangHint(preference: UiLangPreference): void {
  try {
    if (preference === 'system') localStorage.removeItem('mindos-lang');
    else localStorage.setItem('mindos-lang', preference);
  } catch { /* sandboxed */ }
}

async function toggleLang(): Promise<void> {
  const next: Lang = getLang() === 'zh' ? 'en' : 'zh';
  langPreference = next;
  cacheLangHint(next);
  applyI18n(next);
  syncLangIcon();
  try {
    const ipc = getIpc();
    if (ipc) {
      const applied = await ipc.setUiLang(next);
      langPreference = applied.preference;
      if (applied.lang !== getLang()) applyI18n(applied.lang);
      syncLangIcon();
    }
  } catch (err) {
    console.warn('[MindOS] Could not persist the UI language:', err);
  }
}

function syncLangIcon(): void {
  const btn = $('btn-lang');
  if (!btn) return;
  btn.replaceChildren();
  const glyph = document.createElement('span');
  glyph.className = 'lang-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = getLang() === 'zh' ? '文' : 'A';
  btn.appendChild(glyph);
}

function updateToolbarAccessibility(): void {
  const scheme = getEffectiveColorScheme();
  const themeBtn = $('btn-theme');
  const langBtn = $('btn-lang');
  if (themeBtn) {
    const tip = scheme === 'light' ? t('themeTooltipLight') : t('themeTooltipDark');
    (themeBtn as HTMLButtonElement).title = tip;
    themeBtn.setAttribute('aria-label', tip);
  }
  if (langBtn) {
    const tip = getLang() === 'zh' ? t('langTooltipZh') : t('langTooltipEn');
    (langBtn as HTMLButtonElement).title = tip;
    langBtn.setAttribute('aria-label', tip);
  }
}

// ── Mode Selection ──
let selectInProgress = false;

async function selectMode(mode: 'local' | 'remote'): Promise<void> {
  if (selectInProgress) return;
  selectInProgress = true;

  const ipc = getIpc();
  if (!ipc) {
    selectInProgress = false;
    showSetupPanel('install');
    setStatus('install-status', { cls: 'install-progress error', parts: ['errIpcUnavailable'] });
    return;
  }

  // Immediate visual feedback on the clicked card
  const cards = document.querySelectorAll('.mode-card');
  const clickedCard = cards[mode === 'local' ? 0 : 1] as HTMLElement | undefined;
  let spinnerEl: HTMLElement | null = null;
  if (clickedCard) {
    clickedCard.style.opacity = '0.7';
    clickedCard.style.pointerEvents = 'none';
    spinnerEl = document.createElement('p');
    spinnerEl.className = 'mode-sub';
    spinnerEl.dataset.i18n = 'checking';
    spinnerEl.dataset.i18nBusy = '1';
    applyI18nToElement(spinnerEl);
    const h3 = clickedCard.querySelector('h3');
    if (h3 && h3.parentElement) {
      h3.parentElement.insertBefore(spinnerEl, h3.nextSibling);
    } else {
      clickedCard.appendChild(spinnerEl);
    }
  }

  const restoreCard = () => {
    if (clickedCard) {
      clickedCard.style.opacity = '1';
      clickedCard.style.pointerEvents = '';
      if (spinnerEl && spinnerEl.parentElement) spinnerEl.remove();
    }
    selectInProgress = false;
  };

  try {
    if (mode === 'local') {
      const nodeAvailable = await ipc.checkNode();
      if (!nodeAvailable) {
        restoreCard();
        const choice = await ipc.showNodeDialog() || 'cancel';
        if (choice === 'remote') {
          await selectMode('remote');
        } else if (choice === 'install') {
          await ipc.openNodejs();
        }
        return;
      }

      const mindosStatus = await ipc.checkMindosStatus();
      restoreCard();

      if (mindosStatus?.status === 'ready') {
        await ipc.selectMode('local');
      } else if (mindosStatus?.status === 'installed-not-built') {
        setBuildModulePath(mindosStatus.path ?? null);
        setSetupHeading('build', 'cliInstalled');
        showSetupPanel('build');
      } else if (mindosStatus?.status === 'bundled-incomplete') {
        showSetupPanel('bundled');
      } else {
        setSetupHeading('install', 'missingCli');
        showSetupPanel('install');
      }
    } else {
      restoreCard();
      showRemoteScreen();
    }
  } catch (err) {
    console.error('[MindOS] selectMode error:', err);
    restoreCard();
  }
}

function showRemoteScreen(): void {
  $('mode-selection')?.classList.add('hidden');
  $('remote-screen')?.classList.remove('hidden');
  fitWindowToContent();
  void loadRecentConnections();
  void loadSshHosts();
}

function showModeSelection(): void {
  $('remote-screen')?.classList.add('hidden');
  $('mode-selection')?.classList.remove('hidden');
  showSetupPanel(null);
  fitWindowToContent();
}

// ── Recent Connections ──
async function loadRecentConnections(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;
  try {
    const all = await ipc.getRecentConnections() || [];
    // HTTP entries go in the HTTP panel; ssh:// entries in the SSH panel.
    recentConnections = all.filter(c => !c.address.startsWith('ssh://'));
    sshConnections = all.filter(c => c.address.startsWith('ssh://'));
    renderRecent();
    renderSshRecent();
    fitWindowToContent();
  } catch { /* ignore */ }
}

function buildRecentItem(
  conn: RecentConnection,
  onActivate: () => void,
  onForget: () => void,
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'recent-item';
  item.setAttribute('role', 'button');
  item.tabIndex = 0;

  // DOM nodes instead of innerHTML — addresses and labels are user data.
  const dot = document.createElement('div');
  dot.className = 'recent-dot checking';
  dot.title = t('reachableChecking');

  const info = document.createElement('div');
  info.className = 'recent-info';
  const labelEl = document.createElement('div');
  labelEl.className = 'recent-label-text';
  labelEl.textContent = conn.label || conn.address;
  info.appendChild(labelEl);
  // Unnamed servers used to print the address twice — once as the "name",
  // once underneath. The second line only earns its place under a real name.
  if (conn.label && conn.label !== conn.address) {
    const addrEl = document.createElement('div');
    addrEl.className = 'recent-address';
    addrEl.textContent = conn.address;
    info.appendChild(addrEl);
  }

  const forgetBtn = document.createElement('button');
  forgetBtn.type = 'button';
  forgetBtn.className = 'recent-forget';
  forgetBtn.textContent = t('forgot');
  forgetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onForget();
  });

  item.appendChild(dot);
  item.appendChild(info);
  item.appendChild(forgetBtn);
  item.addEventListener('click', onActivate);
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  });

  // The dot was decorative: `.online` existed in CSS but nothing ever set it,
  // so every saved server looked identically offline. Probe for real.
  void probeReachability(conn.address, dot);
  return item;
}

/** Cache so re-rendering the list (e.g. after a language toggle) does not re-probe. */
const reachability = new Map<string, 'online' | 'offline'>();

async function probeReachability(address: string, dot: HTMLElement): Promise<void> {
  const apply = (state: 'online' | 'offline') => {
    dot.classList.remove('checking');
    dot.classList.toggle('online', state === 'online');
    dot.classList.toggle('offline', state === 'offline');
    dot.title = state === 'online' ? t('reachableOnline') : t('reachableOffline');
  };

  const cached = reachability.get(address);
  if (cached) { apply(cached); return; }

  const ipc = getIpc();
  // SSH entries need a tunnel before they can be probed; leave them neutral.
  if (!ipc || address.startsWith('ssh://')) {
    dot.classList.remove('checking');
    return;
  }
  try {
    const result = await ipc.testConnection(address);
    const state = result.status === 'online' ? 'online' : 'offline';
    reachability.set(address, state);
    apply(state);
  } catch {
    reachability.set(address, 'offline');
    apply('offline');
  }
}

function renderRecent(): void {
  const section = $('recent-section');
  const list = $('recent-list');
  const divider = $('divider');
  if (!section || !list || !divider) return;

  const empty = recentConnections.length === 0;
  section.classList.toggle('hidden', empty);
  divider.classList.toggle('hidden', empty);
  list.replaceChildren();
  if (empty) return;

  for (const conn of recentConnections) {
    list.appendChild(buildRecentItem(
      conn,
      () => {
        const addressInput = $('address') as HTMLInputElement | null;
        if (addressInput) {
          addressInput.value = conn.address;
          void handleTest();
        }
      },
      () => void handleForget(conn.address),
    ));
  }
}

function renderSshRecent(): void {
  const section = $('ssh-recent-section');
  const list = $('ssh-recent-list');
  if (!section || !list) return;

  const empty = sshConnections.length === 0;
  section.classList.toggle('hidden', empty);
  list.replaceChildren();
  if (empty) return;

  for (const conn of sshConnections) {
    const parsed = /^ssh:\/\/(.+):(\d+)$/.exec(conn.address);
    list.appendChild(buildRecentItem(
      conn,
      () => {
        if (!parsed) return;
        const hostInput = $('ssh-host-input') as HTMLInputElement | null;
        const portInput = $('ssh-port') as HTMLInputElement | null;
        if (hostInput) hostInput.value = parsed[1];
        if (portInput) portInput.value = parsed[2];
        void handleSshConnect();
      },
      () => {
        if (!window.confirm(t('sshForgetConfirm'))) return;
        void handleForget(conn.address);
      },
    ));
  }
}

async function handleForget(address: string): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;
  await ipc.removeConnection(address);
  recentConnections = recentConnections.filter(c => c.address !== address);
  sshConnections = sshConnections.filter(c => c.address !== address);
  renderRecent();
  renderSshRecent();
}

// ── Test Connection ──
let testInProgress = false;

async function handleTest(): Promise<void> {
  if (testInProgress) return;
  const ipc = getIpc();
  if (!ipc) return;

  const addressInput = $('address') as HTMLInputElement;
  const addr = addressInput?.value.trim();
  const btn = $('test-btn') as HTMLButtonElement;
  const pwSection = $('password-section');
  const connectBtn = $('connect-btn') as HTMLButtonElement;

  if (!btn) return;
  if (!addr) {
    setStatus('status', { cls: 'status-bar error', parts: ['errEmptyAddress'] });
    addressInput?.focus();
    return;
  }

  testInProgress = true;
  btn.disabled = true;
  setLabel(btn, 'connecting', { busy: true });
  setStatus('status', { cls: 'status-bar info', parts: ['connecting'] });

  try {
    testResult = await ipc.testConnection(addr);
  } catch (err) {
    testResult = { status: 'error', error: String(err) };
  }

  testInProgress = false;
  btn.disabled = false;
  setLabel(btn, 'testConnection');

  const result = testResult!;

  if (result.status === 'online') {
    const parts: StatusPart[] = ['online'];
    if (result.version) parts.push({ text: ` · v${result.version}` });
    if (result.authRequired) parts.push({ text: ' · ' }, 'passwordRequired');
    setStatus('status', { cls: 'status-bar success', parts });

    if (result.authRequired) {
      pwSection?.classList.remove('hidden');
      fitWindowToContent();
      const pwInput = $('password') as HTMLInputElement;
      // Try to auto-fill saved password
      try {
        const savedPw = await ipc.getSavedPassword(addr);
        if (savedPw && pwInput) {
          pwInput.value = savedPw;
        }
      } catch { /* ignore — getSavedPassword may not be available */ }
      pwInput?.focus();
    } else {
      pwSection?.classList.add('hidden');
    }
    connectBtn?.classList.remove('hidden');
    if (connectBtn) connectBtn.disabled = false;
  } else if (result.status === 'not-mindos') {
    setStatus('status', { cls: 'status-bar error', parts: ['notMindos'] });
    connectBtn?.classList.add('hidden');
  } else {
    setStatus('status', {
      cls: 'status-bar error',
      parts: [{ text: '✗ ' }, ...failureParts(result, 'cannotReach')],
    });
    connectBtn?.classList.add('hidden');
  }
}

// ── Connect ──
let connectInProgress = false;

async function handleConnect(): Promise<void> {
  if (connectInProgress) return;
  const ipc = getIpc();
  if (!ipc) return;

  const addressInput = $('address') as HTMLInputElement;
  const pwInput = $('password') as HTMLInputElement;
  const btn = $('connect-btn') as HTMLButtonElement;

  const addr = addressInput?.value.trim();
  const pw = pwInput?.value || '';

  if (!addr || !testResult || testResult.status !== 'online') return;
  if (testResult.authRequired && !pw) {
    pwInput?.focus();
    return;
  }

  connectInProgress = true;
  if (btn) {
    btn.disabled = true;
    setLabel(btn, 'connecting');
  }

  try {
    const result = await ipc.connect(addr, pw || null);
    if (result.ok) {
      setLabel(btn, 'connected');
      // Reset after brief delay — window usually closes, but if not, allow retry
      setTimeout(() => {
        connectInProgress = false;
        if (btn) { btn.disabled = false; setLabel(btn, 'connect'); }
      }, 2000);
    } else {
      setStatus('status', { cls: 'status-bar error', parts: failureParts(result, 'connectionFailed') });
      connectInProgress = false;
      if (btn) { btn.disabled = false; setLabel(btn, 'connect'); }
    }
  } catch (err) {
    setStatus('status', {
      cls: 'status-bar error',
      parts: [{ text: err instanceof Error ? err.message : String(err) }],
    });
    connectInProgress = false;
    if (btn) { btn.disabled = false; setLabel(btn, 'connect'); }
  }
}

// ── Back / switch-mode button ──

/**
 * In the first-run mode picker this is a local screen toggle. In the standalone
 * connect window it asks main to switch to local mode. Previously both cases
 * went through connect:switch-local, which resolved null and quit the app on
 * first run.
 */
function handleBack(): void {
  // In the boot shell the cards are always reachable, and going through them
  // keeps the environment check. Calling switchToLocal() here started local
  // mode directly, under a label that promised the mode picker.
  if (isModeSelectWindow || isBootShell) {
    showModeSelection();
    return;
  }
  const ipc = getIpc();
  if (ipc) void ipc.switchToLocal();
}

/**
 * Keyboard navigation for the mode picker and a global Esc.
 *
 * Principle 2 is "Keyboard First, Mouse Welcome", but the shell shipped no
 * shortcut beyond Enter inside a text field, and nothing was discoverable.
 */
function installKeyboardShortcuts(): void {
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.mode-card'));
  const modePickerVisible = () => !$('mode-selection')?.classList.contains('hidden');

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    );

    // Esc: back out one level, mirroring the visible back button.
    if (e.key === 'Escape') {
      if (modePickerVisible()) {
        if (activeSetupPanel) { e.preventDefault(); showSetupPanel(null); }
        return;
      }
      e.preventDefault();
      handleBack();
      return;
    }

    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!modePickerVisible() || activeSetupPanel) return;

    // 1 / 2 pick a mode outright.
    if (e.key === '1' || e.key === '2') {
      e.preventDefault();
      void selectMode(e.key === '1' ? 'local' : 'remote');
      return;
    }
    // Arrows move the roving focus between the two cards.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = cards();
      if (list.length === 0) return;
      e.preventDefault();
      const current = list.findIndex((c) => c === document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (current + 1) % list.length
        : (current <= 0 ? list.length - 1 : current - 1);
      list[next]?.focus();
    }
  });
}

// ── Init ──
function init(): void {
  const urlParams = new URLSearchParams(window.location.search);
  isModeSelectWindow = urlParams.get('modeSelect') === 'true';
  isBootShell = urlParams.get('shell') === 'boot';

  if (isBootShell && !isModeSelectWindow) {
    // Already booting: go straight to progress, no mode cards.
    showBootScreen();
  } else if (isModeSelectWindow) {
    $('mode-selection')?.classList.remove('hidden');
    $('remote-screen')?.classList.add('hidden');
    setLabel($('back-btn'), 'backToModes');
  } else {
    $('mode-selection')?.classList.add('hidden');
    $('remote-screen')?.classList.remove('hidden');
    setLabel($('back-btn'), 'switchLocal');
    void loadRecentConnections();
  }
  showSetupPanel(null);

  if (isBootShell) {
    /**
     * Once main starts reporting progress the choice has been made, so the
     * cards give way to the boot state in the same window. This is the moment
     * that used to be a separate 360x240 splash appearing somewhere else on
     * screen.
     */
    getIpc()?.onStatus?.((data) => {
      if (!isBootScreenVisible()) showBootScreen();
      applyBootStatus(data);
    });

    // Main can hand the shell back to the user mid-boot — e.g. a saved remote
    // server that no longer answers needs the connect form, in this window
    // rather than in a dialog stacked on top of it.
    getIpc()?.onScreen?.((screen) => {
      if (screen === 'remote') {
        $('boot-screen')?.classList.add('hidden');
        setLabel($('back-btn'), 'backToModes');
        showRemoteScreen();
      } else if (screen === 'modes') {
        $('boot-screen')?.classList.add('hidden');
        showModeSelection();
      } else {
        showBootScreen();
      }
    });
  }

  // ── Bind ALL events via addEventListener (no inline onclick) ──

  $('btn-theme')?.addEventListener('click', () => void toggleTheme());
  $('btn-lang')?.addEventListener('click', () => void toggleLang());

  // Mode cards
  document.querySelectorAll('.mode-card').forEach((card, idx) => {
    card.addEventListener('click', () => {
      void selectMode(idx === 0 ? 'local' : 'remote');
    });
    card.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        void selectMode(idx === 0 ? 'local' : 'remote');
      }
    });
  });

  $('install-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void installMindOS();
  });
  $('build-btn')?.addEventListener('click', () => void buildMindOS());
  $('install-retry-btn')?.addEventListener('click', () => void recheckEnvironment());
  $('build-retry-btn')?.addEventListener('click', () => void recheckEnvironment());
  $('bundled-retry-btn')?.addEventListener('click', () => void recheckEnvironment());
  $('setup-remote-btn')?.addEventListener('click', () => {
    showSetupPanel(null);
    void selectMode('remote');
  });

  // Test connection
  $('test-btn')?.addEventListener('click', () => void handleTest());

  // Connect button
  $('connect-btn')?.addEventListener('click', () => void handleConnect());

  // Back / switch to local
  $('back-btn')?.addEventListener('click', () => handleBack());

  // Keyboard shortcuts
  $('address')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void handleTest();
  });
  $('password')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void handleConnect();
  });

  // ── SSH / HTTP tab switching ──
  $('tab-ssh')?.addEventListener('click', () => {
    $('tab-ssh')?.classList.add('active');
    $('tab-http')?.classList.remove('active');
    $('ssh-panel')?.classList.remove('hidden');
    $('http-panel')?.classList.add('hidden');
    void loadSshHosts();
  });
  $('tab-http')?.addEventListener('click', () => {
    $('tab-http')?.classList.add('active');
    $('tab-ssh')?.classList.remove('active');
    $('http-panel')?.classList.remove('hidden');
    $('ssh-panel')?.classList.add('hidden');
    // Clear stale SSH password/passphrase state when switching tabs
    resetSshFlowState();
    $('ssh-password-section')?.classList.add('hidden');
    $('ssh-passphrase-section')?.classList.add('hidden');
    void loadRecentConnections();
  });

  // SSH host input — Enter to connect
  for (const id of ['ssh-host-input', 'ssh-port', 'ssh-password', 'ssh-passphrase']) {
    $(id)?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void handleSshConnect();
    });
  }

  // SSH connect button — also handles "cancel" while connecting
  $('ssh-connect-btn')?.addEventListener('click', () => {
    if (isSshConnecting()) {
      void cancelSshConnect();
      return;
    }
    void handleSshConnect();
  });

  // Pre-paint language came from localStorage; the main process holds the truth.
  applyI18n(getLang());
  syncThemeIcon();
  syncLangIcon();
  updateToolbarAccessibility();
  installKeyboardShortcuts();
  void syncLangFromMain();
  void syncThemeFromMain();
  fitWindowToContent();

  if (!isModeSelectWindow && !isBootShell) void loadSshHosts();

  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemePreference() === 'system') {
        syncThemeIcon();
        updateToolbarAccessibility();
      }
    });
  } catch { /* older WebKit */ }

  window.addEventListener('languagechange', () => {
    if (langPreference !== 'system') return;
    void syncLangFromMain();
  });

  const finishHydrate = (): void => {
    document.documentElement.classList.remove('connect-hydrating');
  };
  requestAnimationFrame(finishHydrate);
  setTimeout(finishHydrate, 400);
}

async function syncLangFromMain(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;
  try {
    const { preference, lang } = await ipc.getUiLang();
    langPreference = preference;
    cacheLangHint(preference);
    if (lang !== getLang()) {
      applyI18n(lang);
      syncLangIcon();
    }
  } catch (err) {
    console.warn('[MindOS] Could not read the shell UI language:', err);
  }
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
