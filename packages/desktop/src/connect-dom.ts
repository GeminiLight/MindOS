/**
 * Leaf primitives for the connect window: the IPC bridge shape, element
 * lookup, translation application, the status-bar descriptor system and the
 * fit-to-content reporter.
 *
 * Split out of connect-renderer.ts. Nothing here knows about screens or flow,
 * so both the screen logic and the SSH flow can depend on it without cycles.
 */
import {
  HTML_I18N_KEYS,
  getLang,
  isI18nKey,
  t,
  translations,
  translateFailure,
  type I18nKeys,
  type Lang,
} from './i18n/index';

/** Appearance preference shared with the main process (see ui-theme.ts). */
export type ThemePreference = 'system' | 'light' | 'dark';

// ── IPC bridge (set by preload, may be undefined if preload fails) ──
export type UiLangPreference = 'system' | Lang;

export type MindosConnectBridge = {
  getUiLang: () => Promise<{ preference: UiLangPreference; lang: Lang }>;
  setUiLang: (value: UiLangPreference) => Promise<{ preference: UiLangPreference; lang: Lang }>;
  getUiTheme: () => Promise<{ preference: ThemePreference; theme: 'light' | 'dark' }>;
  setUiTheme: (value: ThemePreference) => Promise<{ preference: ThemePreference; theme: 'light' | 'dark' }>;
  fitWindow: (height: number) => Promise<{ applied: boolean; height?: number }>;
  checkNode: () => Promise<boolean>;
  checkMindosStatus: () => Promise<{ status: 'not-installed' | 'ready' | 'installed-not-built' | 'bundled-incomplete'; path: string | null }>;
  buildMindos: (modulePath: string) => Promise<CommandOutcome>;
  getMindosPath: () => Promise<{ path: string; source: 'user' | 'bundled' } | null>;
  installMindos: () => Promise<CommandOutcome>;
  selectMode: (mode: 'local' | 'remote') => Promise<boolean>;
  showNodeDialog: () => Promise<'install' | 'remote' | 'cancel'>;
  openNodejs: () => Promise<void>;
  getRecentConnections: () => Promise<RecentConnection[]>;
  testConnection: (address: string) => Promise<TestResult>;
  connect: (address: string, password: string | null) => Promise<Failable>;
  removeConnection: (address: string) => Promise<void>;
  getSavedPassword: (address: string) => Promise<string | null>;
  switchToLocal: () => Promise<void>;
  // SSH
  getSshHosts: () => Promise<{ available: boolean; hosts: Array<{ name: string; hostname?: string; user?: string }> }>;
  connectSsh: (host: string, remotePort: number) => Promise<SshResult>;
  cancelSsh: () => Promise<{ ok: boolean }>;
  completeSshWithPassword: (sshHost: string, sshRemotePort: number, tunnelUrl: string, password: string) => Promise<Failable>;
  sshAddKey: (host: string, remotePort: number, passphrase: string, remember: boolean) => Promise<SshResult>;
  /**
   * Where this page is hosted. 'boot' means the main window during startup,
   * which additionally receives the status stream and the action channel; see
   * connect-bridge.ts for why the two surfaces are kept apart.
   */
  shell?: 'boot' | 'dialog';
  onStatus?: (callback: (data: BootStatusData) => void) => void;
  onScreen?: (callback: (screen: 'remote' | 'modes' | 'boot') => void) => void;
  action?: (id: string) => Promise<void>;
};

export type BootStatusData = {
  status?: string;
  message?: string;
  error?: string;
  actions?: Array<{ id: string; label: string; primary?: boolean }>;
  done?: boolean;
};

export type Failable = { ok: boolean; code?: string; params?: Record<string, string | number>; message?: string };
export type CommandOutcome = { success: boolean; output?: string; code?: string; detail?: string; stderr?: string };
export type RecentConnection = { address: string; label?: string; lastConnected?: string };

export type TestResult = {
  status: 'online' | 'offline' | 'not-mindos' | 'error';
  authRequired?: boolean;
  version?: string;
  code?: string;
  params?: Record<string, string | number>;
  error?: string;
};

export type SshResult = {
  ok: boolean;
  url?: string;
  code?: string;
  message?: string;
  authRequired?: boolean;
  passphraseNeeded?: boolean;
  cancelled?: boolean;
  sshHost?: string;
  sshRemotePort?: number;
  version?: string;
};

export function getIpc(): MindosConnectBridge | undefined {
  const bridge = (window as unknown as { mindosConnect?: MindosConnectBridge }).mindosConnect;
  if (!bridge) {
    console.error('[MindOS] window.mindosConnect not found — preload may not have loaded');
  }
  return bridge;
}

// ── Helpers ──
export function $(id: string): HTMLElement | null { return document.getElementById(id); }

/**
 * Render one element's translation. Text is set via DOM nodes so a translation
 * can never act as an HTML sink; only HTML_I18N_KEYS are injected as markup.
 * `data-i18n-busy` prefixes a spinner, which keeps busy button labels
 * translatable instead of baking a spinner into innerHTML.
 */
export function applyI18nToElement(el: HTMLElement, lang: Lang = getLang()): void {
  const key = el.dataset.i18n as I18nKeys | undefined;
  if (!key) return;
  const text = translations[lang]?.[key];
  if (text == null) return;

  const busy = el.dataset.i18nBusy === '1';
  el.replaceChildren();
  if (busy) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    el.appendChild(spinner);
    el.appendChild(document.createTextNode(' '));
  }
  if (HTML_I18N_KEYS.has(key)) {
    el.insertAdjacentHTML('beforeend', text);
  } else {
    el.appendChild(document.createTextNode(text));
  }
}

/**
 * Render the shortcut hints with real keycaps. Built from DOM nodes so the
 * translation itself is never parsed as markup.
 */
export function renderKeyboardHints(): void {
  const build = (el: HTMLElement | null, text: string) => {
    if (!el) return;
    el.replaceChildren();
    // Split on the tokens we want to render as keys, keeping them.
    for (const part of text.split(/([0-9]|↑↓|Esc|Enter|回车)/g)) {
      if (!part) continue;
      if (/^([0-9]|↑↓|Esc|Enter|回车)$/.test(part)) {
        const kbd = document.createElement('kbd');
        kbd.textContent = part;
        el.appendChild(kbd);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    }
  };
  build($('kbd-hint-modes'), t('kbdHintModes'));
  build($('kbd-hint-remote'), t('kbdHintRemote'));
}

/** Set a (re-translatable) button label. */
export function setLabel(el: HTMLElement | null, key: I18nKeys, opts?: { busy?: boolean }): void {
  if (!el) return;
  el.dataset.i18n = key;
  if (opts?.busy) el.dataset.i18nBusy = '1';
  else delete el.dataset.i18nBusy;
  applyI18nToElement(el);
}

// ── Status bars (kept as descriptors so they survive a language toggle) ──

export type StatusPart = I18nKeys | { key: I18nKeys; params?: Record<string, string | number> } | { text: string };
export interface StatusDescriptor {
  cls: string;
  parts: StatusPart[];
  /** Verbatim diagnostic tail (command stderr) rendered in a <small>. */
  detail?: string;
}

const statusState = new Map<string, StatusDescriptor | null>();

export function renderStatusPart(part: StatusPart): string {
  if (typeof part === 'string') return t(part);
  if ('text' in part) return part.text;
  return t(part.key, part.params);
}

export function renderStatus(id: string): void {
  const el = $(id);
  if (!el) return;
  const desc = statusState.get(id);
  if (!desc) {
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }
  el.className = desc.cls;
  el.classList.remove('hidden');
  el.replaceChildren(document.createTextNode(desc.parts.map(renderStatusPart).join('')));
  if (desc.detail) {
    const detail = document.createElement('small');
    detail.textContent = desc.detail;
    el.appendChild(detail);
  }
}

export function setStatus(id: string, desc: StatusDescriptor | null): void {
  statusState.set(id, desc);
  renderStatus(id);
  fitWindowToContent();
}

export function renderAllStatuses(): void {
  for (const id of statusState.keys()) renderStatus(id);
}

/** Status descriptor for a failed IPC call, preferring the localized code. */
export function failureParts(failure: Failable | TestResult | CommandOutcome | null, fallback: I18nKeys): StatusPart[] {
  const normalized = failure as { code?: unknown; params?: Record<string, string | number>; message?: string; detail?: string } | null;
  const message = normalized?.message ?? normalized?.detail;
  return [{ text: translateFailure({ code: normalized?.code, params: normalized?.params, message }, fallback) }];
}

/**
 * `<prefix>: <concrete reason>` for a failed command.
 *
 * The generic code (errBuildFailed / errInstallFailed) says the same thing as
 * the prefix, so repeating it produced "❌ 安装失败: 安装失败" and hid the actual
 * `npm ERR! code EACCES` detail.
 */
export function commandFailureParts(
  result: CommandOutcome | null | undefined,
  prefixKey: I18nKeys,
  genericCode: I18nKeys,
): StatusPart[] {
  const parts: StatusPart[] = [prefixKey];
  // The separator is a key, not literal text: "：" in Chinese, ": " in English,
  // and it has to follow a language toggle like the rest of the line.
  if (result?.detail) {
    parts.push('labelSeparator', { text: result.detail });
  } else if (result?.code && result.code !== genericCode && isI18nKey(result.code)) {
    parts.push('labelSeparator', { key: result.code });
  }
  return parts;
}

/**
 * Report the height the content actually needs so main can size the window.
 *
 * Both shell windows used to be fixed at a height chosen for the largest
 * possible panel, which left ~40% dead space on the common screens and still
 * overflowed on the crowded ones. Measuring is cheap and removes both.
 */
let fitTimer: ReturnType<typeof setTimeout> | undefined;
export function fitWindowToContent(): void {
  clearTimeout(fitTimer);
  // Coalesce the bursts that follow a screen switch or a re-render.
  fitTimer = setTimeout(() => {
    const container = document.querySelector<HTMLElement>('.container');
    const ipc = getIpc();
    if (!container || !ipc) return;
    // The boot shell lives in the main window, whose size is the user's and is
    // restored from window-state. Content must not resize it.
    if (ipc.shell === 'boot') return;
    const style = getComputedStyle(document.body);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const needed = Math.ceil(container.getBoundingClientRect().height + padding);
    void ipc.fitWindow(needed).catch(() => { /* window may be closing */ });
  }, 60);
}
