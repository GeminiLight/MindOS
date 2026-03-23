/**
 * Connect window renderer script
 * Handles mode selection, connection testing, and server connection
 */

import { t, setLang, translations, type Lang, type I18nKeys } from './i18n/index';

// IPC bridge — exposed by preload
declare global {
  interface Window {
    mindosConnect: {
      checkNode: () => Promise<boolean>;
      checkMindosStatus: () => Promise<{
        status: 'not-installed' | 'ready' | 'installed-not-built';
        path: string | null;
      }>;
      buildMindos: (modulePath: string) => Promise<{ success: boolean; output?: string; error?: string; stderr?: string }>;
      getMindosPath: () => Promise<{ path: string; source: 'user' } | null>;
      installMindos: () => Promise<{ success: boolean; output?: string; error?: string; stderr?: string }>;
      selectMode: (mode: 'local' | 'remote') => Promise<boolean>;
      showNodeDialog: () => Promise<'install' | 'remote' | 'cancel'>;
      openNodejs: () => Promise<void>;
      getRecentConnections: () => Promise<Array<{ address: string; label?: string }>>;
      testConnection: (address: string) => Promise<{
        status: 'online' | 'not-mindos' | 'error';
        authRequired?: boolean;
        version?: string;
        error?: string;
      }>;
      connect: (address: string, password: string | null) => Promise<{ ok: boolean; error?: string }>;
      removeConnection: (address: string) => Promise<void>;
      switchToLocal: () => Promise<void>;
    };
  }
}

const ipc = window.mindosConnect;

type TestResult = {
  status: 'online' | 'not-mindos' | 'error';
  authRequired?: boolean;
  version?: string;
  error?: string;
};

let testResult: TestResult | null = null;
let recentConnections: Array<{ address: string; label?: string }> = [];

// ── Language switcher (exposed to HTML onclick) ──
function switchLang(lang: Lang): void {
  setLang(lang);
  localStorage.setItem('mindos-lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.getElementById('lang-zh')?.classList.toggle('active', lang === 'zh');
  document.getElementById('lang-en')?.classList.toggle('active', lang === 'en');

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n') as I18nKeys;
    const text = translations[lang][key];
    if (text != null) el.innerHTML = text;
  });

  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder') as I18nKeys;
    const text = translations[lang][key];
    if (text != null) el.placeholder = text;
  });
}

// ── IPC helpers ──
function switchToLocal(): void {
  void ipc.switchToLocal?.();
}

function openNodejs(): void {
  void ipc.openNodejs?.();
}

// ── Mode Selection ──
async function selectMode(mode: 'local' | 'remote'): Promise<void> {
  if (mode === 'local') {
    const nodeAvailable = await ipc.checkNode?.();
    if (!nodeAvailable) {
      const choice = await ipc.showNodeDialog?.() || 'cancel';
      if (choice === 'remote') {
        await selectMode('remote');
      } else if (choice === 'install') {
        ipc.openNodejs?.();
      }
      return;
    }

    const mindosStatus = await ipc.checkMindosStatus?.();

    if (mindosStatus?.status === 'ready') {
      ipc.selectMode?.('local');
    } else if (mindosStatus?.status === 'installed-not-built') {
      showBuildSection(mindosStatus.path!);
    } else {
      const setupSection = document.getElementById('local-setup');
      if (setupSection) {
        setupSection.style.display = 'block';
        setupSection.scrollIntoView({ behavior: 'smooth' });
      }
    }
  } else {
    document.getElementById('mode-selection')?.classList.add('hidden');
    document.getElementById('remote-screen')?.classList.remove('hidden');
    await loadRecentConnections();
  }
}

/** Show build section for user's local MindOS that needs building */
function showBuildSection(modulePath: string): void {
  const setupSection = document.getElementById('local-setup');
  if (!setupSection) return;

  // Escape path for safe insertion into an HTML onclick attribute
  const safePath = modulePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  setupSection.style.display = 'block';
  setupSection.innerHTML = `
    <h4>${t('cliInstalled')}</h4>
    <p>${t('cliInstalledDesc')}</p>
    <button class="setup-btn" id="build-btn" onclick="buildMindOS('${safePath}')">
      ${t('buildBtn')}
    </button>
    <div id="build-status" class="hidden"></div>
    <button class="setup-btn" id="retry-btn" onclick="checkNodeAgain()" style="display:none; margin-top:12px;">
      ${t('retryLocal')}
    </button>
  `;
  setupSection.scrollIntoView({ behavior: 'smooth' });
}

/** Auto-build user's local MindOS */
async function buildMindOS(modulePath: string): Promise<void> {
  const buildBtn = document.getElementById('build-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('build-status') as HTMLElement;
  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

  if (!buildBtn || !statusEl) return;

  buildBtn.disabled = true;
  buildBtn.innerHTML = `<span class="spinner"></span> ${t('building')}`;
  buildBtn.style.opacity = '0.7';
  statusEl.classList.remove('hidden');
  statusEl.className = 'install-progress';
  statusEl.textContent = t('buildingDesc');

  try {
    const result = await ipc.buildMindos?.(modulePath);

    if (result?.success) {
      buildBtn.style.display = 'none';
      statusEl.className = 'install-progress success';
      statusEl.textContent = t('buildSuccess');
      // Auto-proceed: trigger local mode start
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
(window as typeof window & { buildMindOS: typeof buildMindOS }).buildMindOS = buildMindOS;

/** Auto-install MindOS CLI */
async function installMindOS(event?: Event): Promise<void> {
  event?.stopPropagation();

  const installBtn = document.getElementById('install-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('install-status') as HTMLElement;
  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

  if (!installBtn || !statusEl) return;

  installBtn.disabled = true;
  installBtn.innerHTML = `<span class="spinner"></span> ${t('installing')}`;
  installBtn.style.opacity = '0.7';
  statusEl.classList.remove('hidden');
  statusEl.className = 'install-progress';
  statusEl.textContent = t('installingDesc');

  try {
    const result = await ipc.installMindos?.();

    if (result?.success) {
      installBtn.style.display = 'none';
      statusEl.className = 'install-progress success';
      statusEl.textContent = t('installSuccess');
      // Auto-proceed: no need to click "Start Local Mode"
      await checkNodeAgain();
    } else {
      installBtn.disabled = false;
      installBtn.style.opacity = '1';
      installBtn.innerHTML = t('retryInstall');
      statusEl.className = 'install-progress error';
      statusEl.innerHTML = `${t('installFailed')}: ${result?.error ?? '?'}${result?.stderr ? `<br><small>${result.stderr}</small>` : ''}`;
      retryBtn.style.display = 'none';
    }
  } catch (err) {
    installBtn.disabled = false;
    installBtn.style.opacity = '1';
    installBtn.innerHTML = t('retryInstall');
    statusEl.className = 'install-progress error';
    statusEl.textContent = `${t('installError')}: ${err instanceof Error ? err.message : String(err)}`;
    retryBtn.style.display = 'none';
  }
}

/** Re-check environment after user claims to have installed dependencies */
async function checkNodeAgain(): Promise<void> {
  const setupSection = document.getElementById('local-setup');
  const statusEl = setupSection?.querySelector('h4');

  if (statusEl) statusEl.textContent = t('checking');

  const nodeAvailable = await ipc.checkNode?.();
  if (!nodeAvailable) {
    if (statusEl) statusEl.textContent = t('missingNode');
    return;
  }

  const mindosStatus = await ipc.checkMindosStatus?.();

  if (mindosStatus?.status === 'ready') {
    if (statusEl) statusEl.textContent = t('envReady');
    await ipc.selectMode?.('local');
  } else if (mindosStatus?.status === 'installed-not-built') {
    showBuildSection(mindosStatus.path!);
  } else {
    if (statusEl) statusEl.textContent = t('missingCliStill');
  }
}

async function loadRecentConnections(): Promise<void> {
  try {
    recentConnections = await ipc.getRecentConnections?.() || [];
    renderRecent();
  } catch {
    // ignore
  }
}

// ── Render Recent Connections ──
function renderRecent(): void {
  const section = document.getElementById('recent-section');
  const list = document.getElementById('recent-list');
  const divider = document.getElementById('divider');

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
      const addressInput = document.getElementById('address') as HTMLInputElement;
      if (addressInput) {
        addressInput.value = conn.address;
        void handleTest();
      }
    });
    list.appendChild(item);
  }
}

async function handleForget(address: string): Promise<void> {
  await ipc.removeConnection?.(address);
  recentConnections = recentConnections.filter(c => c.address !== address);
  renderRecent();
}

// ── Test Connection ──
async function handleTest(): Promise<void> {
  const addressInput = document.getElementById('address') as HTMLInputElement;
  const addr = addressInput?.value.trim();
  if (!addr) return;

  const btn = document.getElementById('test-btn') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLElement;
  const pwSection = document.getElementById('password-section');
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;

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

  // testResult is guaranteed non-null after the try/catch above
  const result = testResult!;

  if (result.status === 'online') {
    status.className = 'status-bar success';
    const version = result.version ? ` · v${result.version}` : '';
    const auth = result.authRequired ? ` · ${t('passwordRequired')}` : '';
    status.textContent = `${t('online')}${version}${auth}`;

    if (result.authRequired) {
      pwSection?.classList.remove('hidden');
      const pwInput = document.getElementById('password') as HTMLInputElement;
      pwInput?.focus();
    } else {
      pwSection?.classList.add('hidden');
    }
    connectBtn?.classList.remove('hidden');
    connectBtn.disabled = false;
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
  const addressInput = document.getElementById('address') as HTMLInputElement;
  const pwInput = document.getElementById('password') as HTMLInputElement;
  const btn = document.getElementById('connect-btn') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLElement;

  const addr = addressInput?.value.trim();
  const pw = pwInput?.value || '';

  if (!addr || !testResult || testResult.status !== 'online') return;
  if (testResult.authRequired && !pw) {
    pwInput?.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = t('connecting');

  try {
    const result = await ipc.connect(addr, pw || null);
    if (result.ok) {
      btn.textContent = t('connected');
    } else {
      status.className = 'status-bar error';
      status.textContent = result.error || t('connectionFailed');
      btn.disabled = false;
      btn.textContent = t('connect');
    }
  } catch (err) {
    status.className = 'status-bar error';
    status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    btn.disabled = false;
    btn.textContent = t('connect');
  }
}

// ── Init ──
function init(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const modeSelect = urlParams.get('modeSelect');

  if (modeSelect === 'true') {
    document.getElementById('mode-selection')?.classList.remove('hidden');
    document.getElementById('remote-screen')?.classList.add('hidden');
  } else {
    document.getElementById('mode-selection')?.classList.add('hidden');
    document.getElementById('remote-screen')?.classList.remove('hidden');
    void loadRecentConnections();
  }

  document.getElementById('address')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void handleTest();
  });

  document.getElementById('password')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void handleConnect();
  });

  // Expose functions to global scope for HTML onclick handlers
  const g = window as unknown as Record<string, unknown>;
  g['switchLang']     = switchLang;
  g['selectMode']     = selectMode;
  g['switchToLocal']  = switchToLocal;
  g['openNodejs']     = openNodejs;
  g['checkNodeAgain'] = checkNodeAgain;
  g['installMindOS']  = installMindOS;
  g['handleTest']     = handleTest;
  g['handleConnect']  = handleConnect;

  // Apply initial language from saved preference (default: zh)
  const savedLang = (localStorage.getItem('mindos-lang') || 'zh') as 'zh' | 'en';
  switchLang(savedLang);
}

// Start
init();
