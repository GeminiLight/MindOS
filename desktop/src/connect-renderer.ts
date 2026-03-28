/**
 * Connect window renderer script
 * Handles mode selection, connection testing, and server connection.
 *
 * All event binding via addEventListener (no inline onclick) for CSP
 * compatibility and reliable error handling in packaged Electron.
 */

import { t, setLang, translations, type Lang, type I18nKeys } from './i18n/index';

// ── IPC bridge (set by preload, may be undefined if preload fails) ──
function getIpc() {
  const bridge = (window as any).mindosConnect;
  if (!bridge) {
    console.error('[MindOS] window.mindosConnect not found — preload may not have loaded');
  }
  return bridge as {
    checkNode: () => Promise<boolean>;
    checkMindosStatus: () => Promise<{ status: 'not-installed' | 'ready' | 'installed-not-built'; path: string | null }>;
    buildMindos: (modulePath: string) => Promise<{ success: boolean; output?: string; error?: string; stderr?: string }>;
    getMindosPath: () => Promise<{ path: string; source: 'user' } | null>;
    installMindos: () => Promise<{ success: boolean; output?: string; error?: string; stderr?: string }>;
    selectMode: (mode: 'local' | 'remote') => Promise<boolean>;
    showNodeDialog: () => Promise<'install' | 'remote' | 'cancel'>;
    openNodejs: () => Promise<void>;
    getRecentConnections: () => Promise<Array<{ address: string; label?: string }>>;
    testConnection: (address: string) => Promise<{ status: 'online' | 'not-mindos' | 'error'; authRequired?: boolean; version?: string; error?: string }>;
    connect: (address: string, password: string | null) => Promise<{ ok: boolean; error?: string }>;
    removeConnection: (address: string) => Promise<void>;
    switchToLocal: () => Promise<void>;
    // SSH
    getSshHosts: () => Promise<{ available: boolean; hosts: Array<{ name: string; hostname?: string; user?: string }> }>;
    connectSsh: (host: string, remotePort: number) => Promise<{ ok: boolean; url?: string; error?: string; authRequired?: boolean }>;
  } | undefined;
}

type TestResult = {
  status: 'online' | 'not-mindos' | 'error';
  authRequired?: boolean;
  version?: string;
  error?: string;
};

let testResult: TestResult | null = null;
let recentConnections: Array<{ address: string; label?: string }> = [];

// ── Helpers ──
function $(id: string): HTMLElement | null { return document.getElementById(id); }

// ── Theme / language preferences (default: follow system; no flicker — head script + connect-hydrating) ──
type ThemePreference = 'system' | 'light' | 'dark';
type LangPreference = 'system' | Lang;

const ICON_SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const ICON_MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem('mindos-connect-theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* sandboxed */ }
  return 'system';
}

function applyThemeToDom(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem('mindos-connect-theme');
    else localStorage.setItem('mindos-connect-theme', pref);
  } catch { /* sandboxed */ }
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
function toggleTheme(): void {
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
}

function syncThemeIcon(): void {
  const btn = $('btn-theme');
  if (!btn) return;
  btn.innerHTML = getEffectiveColorScheme() === 'dark' ? ICON_MOON : ICON_SUN;
}

function getLangPreference(): LangPreference {
  try {
    const v = localStorage.getItem('mindos-lang');
    if (v === 'zh' || v === 'en') return v;
    if (v === 'system') return 'system';
  } catch { /* sandboxed */ }
  return 'system';
}

function resolveLang(pref: LangPreference): Lang {
  if (pref === 'zh' || pref === 'en') return pref;
  return detectSystemLang();
}

/** Toggle only 中文 ↔ English. Default (no storage) follows system until first click. */
function toggleLang(): void {
  const resolved = resolveLang(getLangPreference());
  const next: Lang = resolved === 'zh' ? 'en' : 'zh';
  try {
    localStorage.setItem('mindos-lang', next);
  } catch { /* sandboxed */ }
  applyI18n(next);
  syncLangIcon();
  updateToolbarAccessibility();
}

function syncLangIcon(): void {
  const btn = $('btn-lang');
  if (!btn) return;
  const resolved = resolveLang(getLangPreference());
  btn.innerHTML =
    resolved === 'zh'
      ? '<span class="lang-glyph" aria-hidden="true">文</span>'
      : '<span class="lang-glyph" aria-hidden="true">A</span>';
}

function updateToolbarAccessibility(): void {
  const scheme = getEffectiveColorScheme();
  const resolved = resolveLang(getLangPreference());
  const themeBtn = $('btn-theme');
  const langBtn = $('btn-lang');
  if (themeBtn) {
    const tip = scheme === 'light' ? t('themeTooltipLight') : t('themeTooltipDark');
    (themeBtn as HTMLButtonElement).title = tip;
    themeBtn.setAttribute('aria-label', tip);
  }
  if (langBtn) {
    const tip = resolved === 'zh' ? t('langTooltipZh') : t('langTooltipEn');
    (langBtn as HTMLButtonElement).title = tip;
    langBtn.setAttribute('aria-label', tip);
  }
}

// ── Language (UI strings) ──
function applyI18n(lang: Lang): void {
  setLang(lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n') as I18nKeys;
    const text = translations[lang]?.[key];
    if (text != null) el.innerHTML = text;
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder') as I18nKeys;
    const text = translations[lang]?.[key];
    if (text != null) el.placeholder = text;
  });
}

function detectSystemLang(): Lang {
  try {
    const nav = navigator.language || '';
    return nav.startsWith('zh') ? 'zh' : 'en';
  } catch { return 'en'; }
}

// ── Mode Selection ──
let selectInProgress = false;

async function selectMode(mode: 'local' | 'remote'): Promise<void> {
  if (selectInProgress) return;
  selectInProgress = true;

  const ipc = getIpc();
  if (!ipc) {
    selectInProgress = false;
    alert('Internal error: IPC bridge not available. Try restarting the app.');
    return;
  }

  // Immediate visual feedback on the clicked card
  const cards = document.querySelectorAll('.mode-card');
  const clickedCard = cards[mode === 'local' ? 0 : 1] as HTMLElement | undefined;
  let spinnerEl: HTMLElement | null = null;
  if (clickedCard) {
    clickedCard.style.opacity = '0.7';
    clickedCard.style.pointerEvents = 'none';
    // Append spinner via DOM API instead of fragile innerHTML regex
    spinnerEl = document.createElement('p');
    spinnerEl.style.cssText = 'margin-top:4px;font-size:12px;color:var(--amber)';
    const spinIcon = document.createElement('span');
    spinIcon.className = 'spinner';
    spinnerEl.appendChild(spinIcon);
    spinnerEl.appendChild(document.createTextNode(` ${t('checking')}`));
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

      if (mindosStatus?.status === 'ready') {
        await ipc.selectMode('local');
        // Window will close — no need to restore
        return;
      } else if (mindosStatus?.status === 'installed-not-built') {
        restoreCard();
        showBuildSection(mindosStatus.path!);
      } else {
        restoreCard();
        // MindOS not installed — show install section
        const setupSection = $('local-setup');
        if (setupSection) {
          setupSection.style.display = 'block';
          applyI18n(resolveLang(getLangPreference()));
          setupSection.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } else {
      restoreCard();
      $('mode-selection')?.classList.add('hidden');
      $('remote-screen')?.classList.remove('hidden');
      await loadRecentConnections();
    }
  } catch (err) {
    console.error('[MindOS] selectMode error:', err);
    restoreCard();
  }
}

// ── Build Section ──
function showBuildSection(modulePath: string): void {
  const setupSection = $('local-setup');
  if (!setupSection) return;

  setupSection.style.display = 'block';
  setupSection.innerHTML = `
    <h4>${t('cliInstalled')}</h4>
    <p>${t('cliInstalledDesc')}</p>
    <button class="setup-btn" id="build-btn">${t('buildBtn')}</button>
    <div id="build-status" class="hidden"></div>
    <button class="setup-btn" id="retry-btn" style="display:none; margin-top:10px;">${t('retryLocal')}</button>
  `;

  // Bind event after DOM insertion
  $('build-btn')?.addEventListener('click', () => void buildMindOS(modulePath));
  $('retry-btn')?.addEventListener('click', () => void checkNodeAgain());
  setupSection.scrollIntoView({ behavior: 'smooth' });
}

async function buildMindOS(modulePath: string): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const buildBtn = $('build-btn') as HTMLButtonElement | null;
  const statusEl = $('build-status');

  if (!buildBtn || !statusEl) return;

  buildBtn.disabled = true;
  buildBtn.innerHTML = `<span class="spinner"></span> ${t('building')}`;
  buildBtn.style.opacity = '0.7';
  statusEl.classList.remove('hidden');
  statusEl.className = 'install-progress';
  statusEl.textContent = t('buildingDesc');

  try {
    const result = await ipc.buildMindos(modulePath);
    if (result?.success) {
      buildBtn.style.display = 'none';
      statusEl.className = 'install-progress success';
      statusEl.textContent = t('buildSuccess');
      await checkNodeAgain();
    } else {
      buildBtn.disabled = false;
      buildBtn.style.opacity = '1';
      buildBtn.innerHTML = t('retryBuild');
      statusEl.className = 'install-progress error';
      statusEl.innerHTML = `${t('buildFailed')}: ${result?.error ?? '?'}${result?.stderr ? `<br><small>${result.stderr}</small>` : ''}`;
    }
  } catch (err) {
    buildBtn.disabled = false;
    buildBtn.style.opacity = '1';
    buildBtn.innerHTML = t('retryBuild');
    statusEl.className = 'install-progress error';
    statusEl.textContent = `${t('buildError')}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Install MindOS CLI ──
async function installMindOS(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const installBtn = $('install-btn') as HTMLButtonElement | null;
  const statusEl = $('install-status');

  if (!installBtn || !statusEl) return;

  installBtn.disabled = true;
  installBtn.innerHTML = `<span class="spinner"></span> ${t('installing')}`;
  installBtn.style.opacity = '0.7';
  statusEl.classList.remove('hidden');
  statusEl.className = 'install-progress';
  statusEl.textContent = t('installingDesc');

  try {
    const result = await ipc.installMindos();
    if (result?.success) {
      installBtn.style.display = 'none';
      statusEl.className = 'install-progress success';
      statusEl.textContent = t('installSuccess');
      await checkNodeAgain();
    } else {
      installBtn.disabled = false;
      installBtn.style.opacity = '1';
      installBtn.innerHTML = t('retryInstall');
      statusEl.className = 'install-progress error';
      statusEl.innerHTML = `${t('installFailed')}: ${result?.error ?? '?'}${result?.stderr ? `<br><small>${result.stderr}</small>` : ''}`;
    }
  } catch (err) {
    installBtn.disabled = false;
    installBtn.style.opacity = '1';
    installBtn.innerHTML = t('retryInstall');
    statusEl.className = 'install-progress error';
    statusEl.textContent = `${t('installError')}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Re-check environment ──
async function checkNodeAgain(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const setupSection = $('local-setup');
  const statusEl = setupSection?.querySelector('h4');

  if (statusEl) statusEl.textContent = t('checking');

  try {
    const nodeAvailable = await ipc.checkNode();
    if (!nodeAvailable) {
      if (statusEl) statusEl.textContent = t('missingNode');
      return;
    }

    const mindosStatus = await ipc.checkMindosStatus();

    if (mindosStatus?.status === 'ready') {
      if (statusEl) statusEl.textContent = t('envReady');
      await ipc.selectMode('local');
    } else if (mindosStatus?.status === 'installed-not-built') {
      showBuildSection(mindosStatus.path!);
    } else {
      if (statusEl) statusEl.textContent = t('missingCliStill');
    }
  } catch (err) {
    console.error('[MindOS] checkNodeAgain error:', err);
    if (statusEl) statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Recent Connections ──
async function loadRecentConnections(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;
  try {
    recentConnections = await ipc.getRecentConnections() || [];
    renderRecent();
  } catch { /* ignore */ }
}

function renderRecent(): void {
  const section = $('recent-section');
  const list = $('recent-list');
  const divider = $('divider');
  if (!section || !list || !divider) return;

  if (recentConnections.length === 0) {
    section.classList.add('hidden');
    divider.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  divider.classList.remove('hidden');
  list.innerHTML = '';

  for (const conn of recentConnections) {
    const item = document.createElement('div');
    item.className = 'recent-item';

    // Build DOM nodes instead of innerHTML to prevent XSS from stored addresses/labels
    const dot = document.createElement('div');
    dot.className = 'recent-dot';

    const info = document.createElement('div');
    info.className = 'recent-info';
    const labelEl = document.createElement('div');
    labelEl.className = 'recent-label-text';
    labelEl.textContent = conn.label || conn.address;
    const addrEl = document.createElement('div');
    addrEl.className = 'recent-address';
    addrEl.textContent = conn.address;
    info.appendChild(labelEl);
    info.appendChild(addrEl);

    const forgetBtn = document.createElement('button');
    forgetBtn.className = 'recent-forget';
    forgetBtn.textContent = t('forgot');
    forgetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleForget(conn.address);
    });

    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(forgetBtn);

    item.addEventListener('click', () => {
      const addressInput = $('address') as HTMLInputElement;
      if (addressInput) {
        addressInput.value = conn.address;
        void handleTest();
      }
    });
    list.appendChild(item);
  }
}

async function handleForget(address: string): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;
  await ipc.removeConnection(address);
  recentConnections = recentConnections.filter(c => c.address !== address);
  renderRecent();
}

// ── Test Connection ──
let testInProgress = false;

async function handleTest(): Promise<void> {
  if (testInProgress) return;
  const ipc = getIpc();
  if (!ipc) return;

  const addressInput = $('address') as HTMLInputElement;
  const addr = addressInput?.value.trim();
  if (!addr) return;

  const btn = $('test-btn') as HTMLButtonElement;
  const status = $('status') as HTMLElement;
  const pwSection = $('password-section');
  const connectBtn = $('connect-btn') as HTMLButtonElement;

  if (!btn || !status) return;

  testInProgress = true;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t('connecting')}`;
  status.classList.remove('hidden');
  status.className = 'status-bar info';
  status.textContent = t('connecting');

  try {
    testResult = await ipc.testConnection(addr);
  } catch (err) {
    testResult = { status: 'error', error: String(err) };
  }

  testInProgress = false;
  btn.disabled = false;
  btn.textContent = t('testConnection');

  const result = testResult!;

  if (result.status === 'online') {
    status.className = 'status-bar success';
    const version = result.version ? ` · v${result.version}` : '';
    const auth = result.authRequired ? ` · ${t('passwordRequired')}` : '';
    status.textContent = `${t('online')}${version}${auth}`;

    if (result.authRequired) {
      pwSection?.classList.remove('hidden');
      ($('password') as HTMLInputElement)?.focus();
    } else {
      pwSection?.classList.add('hidden');
    }
    connectBtn?.classList.remove('hidden');
    if (connectBtn) connectBtn.disabled = false;
  } else if (result.status === 'not-mindos') {
    status.className = 'status-bar error';
    status.textContent = t('notMindos');
    connectBtn?.classList.add('hidden');
  } else {
    status.className = 'status-bar error';
    status.textContent = `✗ ${result.error || t('cannotReach')}`;
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
  const status = $('status') as HTMLElement;

  const addr = addressInput?.value.trim();
  const pw = pwInput?.value || '';

  if (!addr || !testResult || testResult.status !== 'online') return;
  if (testResult.authRequired && !pw) {
    pwInput?.focus();
    return;
  }

  connectInProgress = true;
  if (btn) btn.disabled = true;
  if (btn) btn.textContent = t('connecting');

  try {
    const result = await ipc.connect(addr, pw || null);
    if (result.ok) {
      if (btn) btn.textContent = t('connected');
    } else {
      if (status) {
        status.className = 'status-bar error';
        status.textContent = result.error || t('connectionFailed');
      }
      connectInProgress = false;
      if (btn) { btn.disabled = false; btn.textContent = t('connect'); }
    }
  } catch (err) {
    if (status) {
      status.className = 'status-bar error';
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    connectInProgress = false;
    if (btn) { btn.disabled = false; btn.textContent = t('connect'); }
  }
}

// ── Init ──
function init(): void {
  console.log('[MindOS] connect-renderer init, mindosConnect available:', !!(window as any).mindosConnect);

  const urlParams = new URLSearchParams(window.location.search);
  const modeSelect = urlParams.get('modeSelect');

  if (modeSelect === 'true') {
    $('mode-selection')?.classList.remove('hidden');
    $('remote-screen')?.classList.add('hidden');
  } else {
    $('mode-selection')?.classList.add('hidden');
    $('remote-screen')?.classList.remove('hidden');
    void loadRecentConnections();
  }

  // ── Bind ALL events via addEventListener (no inline onclick) ──

  $('btn-theme')?.addEventListener('click', () => toggleTheme());
  $('btn-lang')?.addEventListener('click', () => toggleLang());

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

  // Install MindOS button
  $('install-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void installMindOS();
  });

  // Retry button
  $('retry-btn')?.addEventListener('click', () => void checkNodeAgain());

  // Test connection
  $('test-btn')?.addEventListener('click', () => void handleTest());

  // Connect button
  $('connect-btn')?.addEventListener('click', () => void handleConnect());

  // Switch to local mode
  document.querySelector('.switch-mode')?.addEventListener('click', () => {
    const ipc = getIpc();
    if (ipc) void ipc.switchToLocal();
  });

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
  });
  $('tab-http')?.addEventListener('click', () => {
    $('tab-http')?.classList.add('active');
    $('tab-ssh')?.classList.remove('active');
    $('http-panel')?.classList.remove('hidden');
    $('ssh-panel')?.classList.add('hidden');
    void loadRecentConnections();
  });

  // Load SSH hosts when remote screen shows
  void loadSshHosts();

  // SSH host input — Enter to connect
  $('ssh-host-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void handleSshConnect();
  });
  $('ssh-port')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void handleSshConnect();
  });

  // SSH connect button
  $('ssh-connect-btn')?.addEventListener('click', () => void handleSshConnect());

  const langPref = getLangPreference();
  applyI18n(resolveLang(langPref));
  syncThemeIcon();
  syncLangIcon();
  updateToolbarAccessibility();

  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemePreference() === 'system') {
        syncThemeIcon();
        updateToolbarAccessibility();
      }
    });
  } catch { /* older WebKit */ }

  window.addEventListener('languagechange', () => {
    if (getLangPreference() !== 'system') return;
    applyI18n(resolveLang('system'));
    syncLangIcon();
    updateToolbarAccessibility();
  });

  const finishHydrate = (): void => {
    document.documentElement.classList.remove('connect-hydrating');
  };
  requestAnimationFrame(finishHydrate);
  setTimeout(finishHydrate, 400);
}

// ── SSH Functions ──

async function loadSshHosts(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const datalist = $('ssh-host-list') as HTMLDataListElement;
  const note = $('ssh-note');
  if (!datalist) return;

  try {
    const result = await ipc.getSshHosts();

    if (!result.available) {
      // SSH not available — hide SSH tab, default to HTTP
      $('tab-ssh')?.classList.add('hidden');
      $('tab-http')?.classList.add('active');
      $('ssh-panel')?.classList.add('hidden');
      $('http-panel')?.classList.remove('hidden');
      return;
    }

    // Populate datalist suggestions from ~/.ssh/config (may be empty)
    datalist.innerHTML = '';
    for (const host of result.hosts) {
      const opt = document.createElement('option');
      opt.value = host.name;
      opt.label = host.hostname
        ? `${host.name} — ${host.user ? host.user + '@' : ''}${host.hostname}`
        : host.name;
      datalist.appendChild(opt);
    }

    if (result.hosts.length === 0 && note) {
      note.textContent = t('sshNoConfig');
    }
  } catch (err) {
    console.error('[MindOS] Failed to load SSH hosts:', err);
  }
}

async function handleSshConnect(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const hostInput = $('ssh-host-input') as HTMLInputElement;
  const portInput = $('ssh-port') as HTMLInputElement;
  const btn = $('ssh-connect-btn') as HTMLButtonElement;
  const status = $('ssh-status') as HTMLElement;

  const host = hostInput?.value.trim();
  const port = parseInt(portInput?.value || '3456', 10);
  if (!host) { hostInput?.focus(); return; }

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t('sshConnecting')}`;
  status.classList.remove('hidden');
  status.className = 'status-bar info';
  status.textContent = t('sshConnecting');

  try {
    const result = await ipc.connectSsh(host, port);

    if (result.ok) {
      status.className = 'status-bar success';
      status.textContent = t('sshSuccess');
      btn.textContent = t('connected');
      // Window will close automatically (IPC handler calls resolve + close)
    } else {
      status.className = 'status-bar error';
      status.textContent = `${t('sshFailed')}: ${result.error}`;
      btn.disabled = false;
      btn.textContent = t('sshConnect');
    }
  } catch (err) {
    status.className = 'status-bar error';
    status.textContent = `${t('sshFailed')}: ${err instanceof Error ? err.message : String(err)}`;
    btn.disabled = false;
    btn.textContent = t('sshConnect');
  }
}

// Start
init();
