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

// ── Language ──
function switchLang(lang: Lang): void {
  setLang(lang);
  try { localStorage.setItem('mindos-lang', lang); } catch { /* sandboxed */ }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  $('lang-zh')?.classList.toggle('active', lang === 'zh');
  $('lang-en')?.classList.toggle('active', lang === 'en');

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
  if (clickedCard) {
    clickedCard.style.opacity = '0.7';
    clickedCard.style.pointerEvents = 'none';
    clickedCard.innerHTML = clickedCard.innerHTML.replace(
      /<\/h3>/,
      `</h3><p style="margin-top:4px;font-size:12px;color:var(--amber)"><span class="spinner"></span> ${t('checking')}</p>`
    );
  }

  const restoreCard = () => {
    if (clickedCard) {
      clickedCard.style.opacity = '1';
      clickedCard.style.pointerEvents = '';
      // Remove the spinner paragraph
      const spinner = clickedCard.querySelector('p[style*="amber"]');
      if (spinner) spinner.remove();
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
          const lang = (() => { try { return localStorage.getItem('mindos-lang'); } catch { return null; } })() || detectSystemLang();
          switchLang(lang as Lang);
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
    item.innerHTML = `
      <div class="recent-dot"></div>
      <div class="recent-info">
        <div class="recent-label-text">${conn.label || conn.address}</div>
        <div class="recent-address">${conn.address}</div>
      </div>
      <button class="recent-forget" data-addr="${conn.address}">${t('forgot')}</button>
    `;
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('recent-forget')) {
        e.stopPropagation();
        void handleForget(conn.address);
        return;
      }
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
async function handleTest(): Promise<void> {
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
async function handleConnect(): Promise<void> {
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
      if (btn) { btn.disabled = false; btn.textContent = t('connect'); }
    }
  } catch (err) {
    if (status) {
      status.className = 'status-bar error';
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
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

  // Language switcher
  $('lang-zh')?.addEventListener('click', () => switchLang('zh'));
  $('lang-en')?.addEventListener('click', () => switchLang('en'));

  // Mode cards
  document.querySelectorAll('.mode-card').forEach((card, idx) => {
    card.addEventListener('click', () => {
      void selectMode(idx === 0 ? 'local' : 'remote');
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

  // Apply initial language
  const savedLang = (() => {
    try { return localStorage.getItem('mindos-lang'); } catch { return null; }
  })() || detectSystemLang();
  switchLang(savedLang as Lang);
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
