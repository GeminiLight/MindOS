/**
 * System tray — mode-aware tray icon and context menu.
 * Uses callbacks to trigger main process actions directly (not via renderer IPC).
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import path from 'path';
import { existsSync } from 'fs';

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;

type ServerStatus = 'starting' | 'running' | 'error' | 'stopped';

/** Callbacks from tray menu → main process */
export interface TrayCallbacks {
  onChangeMode: () => Promise<void>;
  onOpenMindRoot: () => void;
  onRestartServices: () => Promise<void>;
  onSwitchServer: () => Promise<void>;
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

  // Windows/Linux: use colored icon
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

  const zh = app.getLocale()?.startsWith('zh');
  const statusIcon = status === 'running' ? '\u25CF' : status === 'starting' ? '\u25CB' : '\u25CF';  // ● ○ ●
  const statusLabel = status === 'running'
    ? (zh ? '运行中' : 'Running')
    : status === 'starting'
    ? (zh ? '启动中...' : 'Starting...')
    : (zh ? '错误' : 'Error');

  const modeLabel = mode === 'local'
    ? (zh ? '本地模式' : 'Local')
    : (remoteAddress || (zh ? '远程模式' : 'Remote'));

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── Status ──
    { label: `${statusIcon} MindOS · ${modeLabel}`, enabled: false },
    { type: 'separator' },

    // ── Daily use ──
    {
      label: zh ? '打开 MindOS' : 'Open MindOS',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: () => { mainWindowRef?.show(); mainWindowRef?.focus(); },
    },
    {
      label: zh ? '打开知识库目录' : 'Open Knowledge Base',
      click: () => callbacks?.onOpenMindRoot(),
    },
    ...(callbacks?.onRefreshCliShim
      ? [{
          label: zh ? '安装/刷新终端命令 mindos…' : 'Install / refresh mindos CLI…',
          click: () => callbacks?.onRefreshCliShim?.(),
        } as const]
      : []),
    { type: 'separator' },
  ];

  // ── Mode-specific actions ──
  if (mode === 'local') {
    if (webPort || mcpPort) {
      template.push(
        { label: `Web ${webPort ? `· port ${webPort}` : ''}`, enabled: false },
        { label: `MCP ${mcpPort ? `· port ${mcpPort}` : ''}`, enabled: false },
        { type: 'separator' },
      );
    }
    template.push({
      label: zh ? '重启服务' : 'Restart Services',
      click: () => { callbacks?.onRestartServices(); },
    });
  } else {
    if (remoteAddress) {
      template.push(
        { label: `Server · ${remoteAddress}`, enabled: false },
        { type: 'separator' },
      );
    }
    template.push({
      label: zh ? '更换服务器...' : 'Switch Server...',
      click: () => { callbacks?.onSwitchServer(); },
    });
  }

  template.push(
    {
      label: zh ? '切换模式...' : 'Switch Mode...',
      click: () => { callbacks?.onChangeMode(); },
    },
    { type: 'separator' },

    // ── Exit ──
    {
      label: zh ? '退出 MindOS' : 'Quit MindOS',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit(),
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`MindOS — ${statusLabel}`);
}
