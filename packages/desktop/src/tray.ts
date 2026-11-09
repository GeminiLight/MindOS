/**
 * System tray — mode-aware tray icon and context menu.
 * Uses callbacks to trigger main process actions directly (not via renderer IPC).
 */
import { Tray, Menu, BrowserWindow, app, clipboard, nativeImage } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { getUiLang } from './i18n/lang';
import { TOGGLE_WINDOW_ACCELERATOR } from './shortcuts';

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;
/** Only advertise the toggle accelerator when it was actually registered. */
let toggleShortcutRegistered = false;

/** Called once the global shortcut registration result is known. */
export function setToggleShortcutRegistered(registered: boolean): void {
  toggleShortcutRegistered = registered;
}

type ServerStatus = 'starting' | 'running' | 'error' | 'stopped';

/** Callbacks from tray menu → main process */
export interface TrayCallbacks {
  onChangeMode: () => Promise<void>;
  onOpenMindRoot: () => void;
  onRestartServices: () => Promise<void>;
  onSwitchServer: () => Promise<void>;
  onReconnect?: () => Promise<void>;
  /** Re-install ~/.mindos/bin/mindos and show PATH hints */
  onRefreshCliShim?: () => void;
}

let callbacks: TrayCallbacks | null = null;

/** Create a minimal 16x16 amber-colored PNG icon as fallback */
function createFallbackIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size - size / 2;
    const y = Math.floor(i / size) - size / 2;
    const inCircle = x * x + y * y <= (size / 2 - 1) * (size / 2 - 1);
    buf[i * 4 + 0] = inCircle ? 200 : 0;
    buf[i * 4 + 1] = inCircle ? 135 : 0;
    buf[i * 4 + 2] = inCircle ? 58 : 0;
    buf[i * 4 + 3] = inCircle ? 255 : 0;
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function loadTrayIcon(): Electron.NativeImage {
  const appRoot = app.getAppPath();

  // macOS: use Template image (black + alpha, macOS handles light/dark automatically)
  if (process.platform === 'darwin') {
    const p = path.join(appRoot, 'src', 'icons', 'tray-iconTemplate.png');
    if (existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) { img.setTemplateImage(true); return img; }
      } catch { /* fallback */ }
    }
  }

  // Windows: .ico carries multiple sizes so the shell picks a sharp one at any DPI
  if (process.platform === 'win32') {
    const ico = path.join(appRoot, 'src', 'icons', 'icon.ico');
    if (existsSync(ico)) {
      try {
        const img = nativeImage.createFromPath(ico);
        if (!img.isEmpty()) return img;
      } catch { /* fallback */ }
    }
  }

  // Linux: colored PNG. Note: under appindicator/StatusNotifier the 'click'
  // event never fires — the context menu (with "Open MindOS" first) is the
  // reliable entry point there.
  const p = path.join(appRoot, 'src', 'icons', 'icon.png');
  if (existsSync(p)) {
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    } catch { /* fallback */ }
  }
  return createFallbackIcon();
}

export function createTray(mainWindow: BrowserWindow, cbs: TrayCallbacks): Tray | null {
  mainWindowRef = mainWindow;
  callbacks = cbs;

  try {
    const icon = loadTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('MindOS');
    tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
    updateTrayMenu('local', 'starting');
    return tray;
  } catch (err) {
    console.warn('Failed to create system tray:', err);
    return null;
  }
}

export function updateTrayMenu(
  mode: 'local' | 'remote',
  status: ServerStatus,
  remoteAddress?: string,
  webPort?: number,
  mcpPort?: number,
): void {
  if (!tray || !mainWindowRef) return;

  const zh = getUiLang() === 'zh';
  const statusIcon = status === 'running' ? '\u25CF' : status === 'starting' ? '\u25CB' : '\u2716';  // ● ○ ✖
  const statusLabel = status === 'running'
    ? (zh ? '运行中' : 'Running')
    : status === 'starting'
    ? (zh ? '启动中…' : 'Starting…')
    : (zh ? '出错' : 'Error');

  const modeLabel = mode === 'local'
    ? (zh ? '本地模式' : 'Local Mode')
    : (remoteAddress || (zh ? '远程模式' : 'Remote Mode'));

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── Status ──
    { label: `${statusIcon} MindOS · ${modeLabel}`, enabled: false },
    { type: 'separator' },

    // ── Daily use ──
    {
      label: zh ? '打开 MindOS' : 'Open MindOS',
      // Only advertised when the global shortcut was actually registered —
      // another app may already own this chord, and showing a dead accelerator
      // is worse than showing none.
      ...(toggleShortcutRegistered ? { accelerator: TOGGLE_WINDOW_ACCELERATOR } : {}),
      click: () => { mainWindowRef?.show(); mainWindowRef?.focus(); },
    },
    {
      label: zh ? '打开知识库目录' : 'Open Knowledge Base',
      click: () => callbacks?.onOpenMindRoot(),
    },
    ...(callbacks?.onRefreshCliShim
      ? [{
          label: zh ? '安装或更新终端命令 mindos…' : 'Install or Update the mindos Command…',
          click: () => callbacks?.onRefreshCliShim?.(),
        } as const]
      : []),
    { type: 'separator' },
  ];

  // ── Mode-specific actions ──
  if (mode === 'local') {
    if (webPort || mcpPort) {
      // These used to be disabled labels, so the MCP endpoint that every agent
      // config needs could be read but never copied.
      if (webPort) {
        template.push({
          label: zh ? `复制 Web 地址 · ${webPort}` : `Copy Web Address · ${webPort}`,
          click: () => clipboard.writeText(`http://127.0.0.1:${webPort}`),
        });
      }
      if (mcpPort) {
        template.push({
          label: zh ? `复制 MCP 地址 · ${mcpPort}` : `Copy MCP Address · ${mcpPort}`,
          click: () => clipboard.writeText(`http://127.0.0.1:${mcpPort}/mcp`),
        });
      }
      template.push({ type: 'separator' });
    }
    template.push({
      label: zh ? '重启服务' : 'Restart Services',
      click: () => { callbacks?.onRestartServices(); },
    });
  } else {
    if (remoteAddress) {
      template.push(
        {
          label: zh ? `复制服务器地址 · ${remoteAddress}` : `Copy Server Address · ${remoteAddress}`,
          click: () => clipboard.writeText(remoteAddress),
        },
        { type: 'separator' },
      );
    }
    template.push({
      label: zh ? '重新连接' : 'Reconnect',
      enabled: status === 'error',
      click: () => { callbacks?.onReconnect?.(); },
    });
    template.push({
      label: zh ? '更换服务器…' : 'Change Server…',
      click: () => { callbacks?.onSwitchServer(); },
    });
  }

  template.push(
    {
      label: zh ? '切换模式…' : 'Switch Mode…',
      click: () => { callbacks?.onChangeMode(); },
    },
    { type: 'separator' },

    // ── Exit ──
    {
      label: zh ? '退出 MindOS' : 'Quit MindOS',
      // Tray accelerators are display-only; Cmd+Q is real on macOS, misleading elsewhere
      ...(process.platform === 'darwin' ? { accelerator: 'CmdOrCtrl+Q' } : {}),
      click: () => app.quit(),
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`MindOS — ${statusLabel}`);
}
