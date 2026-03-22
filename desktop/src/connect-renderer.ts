/**
 * Connect window renderer script
 * Handles mode selection, connection testing, and server connection
 */

// IPC bridge — exposed by preload
declare global {
  interface Window {
    mindosConnect: {
      checkNode: () => Promise<boolean>;
      checkMindos: () => Promise<boolean>;
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

let testResult: {
  status: 'online' | 'not-mindos' | 'error';
  authRequired?: boolean;
  version?: string;
  error?: string;
} | null = null;

let recentConnections: Array<{ address: string; label?: string }> = [];
let currentLang: 'zh' | 'en' = 'zh';

// ── i18n Translations ──
const i18n = {
  zh: {
    subtitle: '选择连接模式',
    localTitle: '本地模式 / Local Mode',
    localDesc: '在本机运行 MindOS，需要安装 Node.js',
    localSub: '推荐：个人使用或开发测试',
    remoteTitle: '远程模式 / Remote Mode',
    remoteDesc: '连接到远程 MindOS 服务器',
    remoteSub: '推荐：团队协作或服务器部署',
    connectServer: '连接到服务器 / Connect to Server',
    recentServers: '最近连接的服务器 / Recent Servers',
    orConnect: '或连接新服务器 / or connect to a new server',
    serverAddress: '服务器地址 / Server Address',
    testConnection: '测试连接 / Test Connection',
    password: '密码 / Password',
    enterPassword: '输入服务器密码 / Enter server password',
    connect: '连接 / Connect',
    hint: '💡 在主机上的 <strong>MindOS 设置</strong> 中查看服务器地址和密码',
    switchLocal: '← 切换到本地模式',
    switchRemote: '← 切换到远程模式',
    connecting: '连接中...',
    online: '✓ 在线',
    passwordRequired: '· 需要密码',
    notMindos: '⚠ 不是 MindOS 服务器',
    cannotReach: '无法连接到服务器',
    incorrectPassword: '密码错误',
    connectionFailed: '连接失败',
    connected: '已连接！',
    forgot: 'Forget / 忘记',
  },
  en: {
    subtitle: 'Choose Connection Mode',
    localTitle: 'Local Mode / 本地模式',
    localDesc: 'Run MindOS on this machine, requires Node.js',
    localSub: 'Recommended for: personal use or development',
    remoteTitle: 'Remote Mode / 远程模式',
    remoteDesc: 'Connect to a remote MindOS server',
    remoteSub: 'Recommended for: team collaboration or server deployment',
    connectServer: 'Connect to Server / 连接到服务器',
    recentServers: 'Recent Servers / 最近连接的服务器',
    orConnect: 'or connect to a new server / 或连接新服务器',
    serverAddress: 'Server Address / 服务器地址',
    testConnection: 'Test Connection / 测试连接',
    password: 'Password / 密码',
    enterPassword: 'Enter server password / 输入服务器密码',
    connect: 'Connect / 连接',
    hint: '💡 Find your server address and password in <strong>MindOS Settings</strong> on the host machine.',
    switchLocal: '← Switch to Local Mode',
    switchRemote: '← Switch to Remote Mode',
    connecting: 'Connecting...',
    online: '✓ Online',
    passwordRequired: '· Password required',
    notMindos: '⚠ Not a MindOS server',
    cannotReach: 'Cannot reach server',
    incorrectPassword: 'Incorrect password',
    connectionFailed: 'Connection failed',
    connected: 'Connected!',
    forgot: 'Forget',
  }
};

// ── i18n Helpers ──
function setLang(lang: 'zh' | 'en'): void {
  currentLang = lang;
  document.getElementById('lang-zh')?.classList.toggle('active', lang === 'zh');
  document.getElementById('lang-en')?.classList.toggle('active', lang === 'en');

  // Update all elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n') as keyof typeof i18n.zh;
    if (i18n[lang][key]) {
      el.innerHTML = i18n[lang][key];
    }
  });

  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder') as keyof typeof i18n.zh;
    if (i18n[lang][key]) {
      (el as HTMLInputElement).placeholder = i18n[lang][key];
    }
  });
}

function t(key: keyof typeof i18n.zh): string {
  return i18n[currentLang][key] || key;
}

// ── Mode Selection ──
async function selectMode(mode: 'local' | 'remote'): Promise<void> {
  if (mode === 'local') {
    // Check if Node.js is available
    const nodeAvailable = await ipc.checkNode?.();
    const mindosAvailable = await ipc.checkMindos?.();

    if (!nodeAvailable || !mindosAvailable) {
      // Show setup guide inline instead of dialog
      const setupSection = document.getElementById('local-setup');
      if (setupSection) {
        setupSection.style.display = 'block';
        setupSection.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    ipc.selectMode?.('local');
  } else {
    document.getElementById('mode-selection')?.classList.add('hidden');
    document.getElementById('remote-screen')?.classList.remove('hidden');
    // Load recent connections
    await loadRecentConnections();
  }
}

async function showNodeRequiredDialog(): Promise<void> {
  const choice = await ipc.showNodeDialog?.() || 'cancel';
  if (choice === 'install') {
    ipc.openNodejs?.();
  } else if (choice === 'remote') {
    await selectMode('remote');
  }
}

function switchToLocal(): void {
  document.getElementById('remote-screen')?.classList.add('hidden');
  document.getElementById('mode-selection')?.classList.remove('hidden');
}

/** Open Node.js download page */
async function openNodejs(): Promise<void> {
  await ipc.openNodejs?.();
}

/** Auto-install MindOS CLI */
async function installMindOS(event?: Event): Promise<void> {
  // Prevent event bubbling to parent card
  event?.stopPropagation();

  const installBtn = document.getElementById('install-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('install-status') as HTMLElement;
  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

  if (!installBtn || !statusEl) return;

  // Show installing state
  installBtn.disabled = true;
  installBtn.innerHTML = `<span class="spinner"></span> 正在安装...`;
  installBtn.style.opacity = '0.7';
  statusEl.classList.remove('hidden');
  statusEl.className = 'install-progress';
  statusEl.textContent = '⏳ 正在下载并安装 @geminilight/mindos，请稍候（约需1-2分钟）...';

  try {
    const result = await ipc.installMindos?.();

    if (result?.success) {
      // Installation successful
      installBtn.style.display = 'none';
      statusEl.className = 'install-progress success';
      statusEl.textContent = '✅ MindOS CLI 安装成功！';
      retryBtn.style.display = 'inline-flex';
    } else {
      // Installation failed
      installBtn.disabled = false;
      installBtn.style.opacity = '1';
      installBtn.innerHTML = '重试安装';
      statusEl.className = 'install-progress error';
      const errorMsg = result?.error || '未知错误';
      statusEl.innerHTML = `❌ 安装失败: ${errorMsg}${result?.stderr ? `<br><small>${result.stderr}</small>` : ''}`;
      retryBtn.style.display = 'none';
    }
  } catch (err) {
    installBtn.disabled = false;
    installBtn.style.opacity = '1';
    installBtn.innerHTML = '重试安装';
    statusEl.className = 'install-progress error';
    statusEl.textContent = `❌ 安装出错: ${err instanceof Error ? err.message : String(err)}`;
    retryBtn.style.display = 'none';
  }
}

/** Re-check environment after user claims to have installed dependencies */
async function checkNodeAgain(): Promise<void> {
  const setupSection = document.getElementById('local-setup');
  const statusEl = setupSection?.querySelector('h4');

  // Show checking status
  if (statusEl) {
    statusEl.textContent = '🔍 检测中... / Checking...';
  }

  const nodeAvailable = await ipc.checkNode?.();
  const mindosAvailable = await ipc.checkMindos?.();

  if (nodeAvailable && mindosAvailable) {
    // All good, proceed with local mode
    if (statusEl) {
      statusEl.textContent = '✅ 环境检测通过！正在启动... / Environment ready! Starting...';
    }
    await ipc.selectMode?.('local');
  } else {
    // Still not ready, show what's missing
    const missing: string[] = [];
    if (!nodeAvailable) missing.push('Node.js');
    if (!mindosAvailable) missing.push('MindOS CLI');

    if (statusEl) {
      statusEl.textContent = `❌ 仍未检测到 / Still missing: ${missing.join(', ')}`;
    }
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

  if (testResult.status === 'online') {
    status.className = 'status-bar success';
    const version = testResult.version ? ` · v${testResult.version}` : '';
    const auth = testResult.authRequired ? ` · ${t('passwordRequired')}` : '';
    status.textContent = `${t('online')}${version}${auth}`;

    if (testResult.authRequired) {
      pwSection?.classList.remove('hidden');
      const pwInput = document.getElementById('password') as HTMLInputElement;
      pwInput?.focus();
    } else {
      pwSection?.classList.add('hidden');
    }
    connectBtn?.classList.remove('hidden');
    connectBtn.disabled = false;
  } else if (testResult.status === 'not-mindos') {
    status.className = 'status-bar error';
    status.textContent = t('notMindos');
    connectBtn?.classList.add('hidden');
  } else {
    status.className = 'status-bar error';
    status.textContent = `✗ ${testResult.error || t('cannotReach')}`;
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
      // Success — main process will load the URL
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
  // Check URL params to see if we're in mode selection or connection screen
  const urlParams = new URLSearchParams(window.location.search);
  const modeSelect = urlParams.get('modeSelect');

  if (modeSelect === 'true') {
    // Show mode selection by default
    document.getElementById('mode-selection')?.classList.remove('hidden');
    document.getElementById('remote-screen')?.classList.add('hidden');
  } else {
    // Direct connection screen (already configured as remote)
    document.getElementById('mode-selection')?.classList.add('hidden');
    document.getElementById('remote-screen')?.classList.remove('hidden');
    void loadRecentConnections();
  }

  // Setup event listeners
  const addressInput = document.getElementById('address');
  const passwordInput = document.getElementById('password');

  addressInput?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      void handleTest();
    }
  });

  passwordInput?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      void handleConnect();
    }
  });

  // Expose functions to global scope for HTML onclick handlers
  (window as typeof window & {
    setLang: typeof setLang;
    selectMode: typeof selectMode;
    switchToLocal: typeof switchToLocal;
    openNodejs: typeof openNodejs;
    checkNodeAgain: typeof checkNodeAgain;
    installMindOS: typeof installMindOS;
    handleTest: typeof handleTest;
    handleConnect: typeof handleConnect;
  }).setLang = setLang;
  (window as typeof window & { selectMode: typeof selectMode }).selectMode = selectMode;
  (window as typeof window & { switchToLocal: typeof switchToLocal }).switchToLocal = switchToLocal;
  (window as typeof window & { openNodejs: typeof openNodejs }).openNodejs = openNodejs;
  (window as typeof window & { checkNodeAgain: typeof checkNodeAgain }).checkNodeAgain = checkNodeAgain;
  (window as typeof window & { installMindOS: typeof installMindOS }).installMindOS = installMindOS;
  (window as typeof window & { handleTest: typeof handleTest }).handleTest = handleTest;
  (window as typeof window & { handleConnect: typeof handleConnect }).handleConnect = handleConnect;
}

// Start
init();
