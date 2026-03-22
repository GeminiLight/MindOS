/**
 * System tray — mode-aware tray icon and context menu.
 * Generates fallback icon programmatically for Linux and packaged builds.
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import path from 'path';
import { existsSync } from 'fs';

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;

type ServerStatus = 'starting' | 'running' | 'error' | 'stopped';

/** Create a minimal 16x16 amber-colored PNG icon as fallback */
function createFallbackIcon(): Electron.NativeImage {
  // Minimal 16x16 RGBA buffer — fill with amber (#c8873a)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    // Simple circle mask
    const x = i % size - size / 2;
    const y = Math.floor(i / size) - size / 2;
    const inCircle = x * x + y * y <= (size / 2 - 1) * (size / 2 - 1);
    buf[i * 4 + 0] = inCircle ? 200 : 0;  // R
    buf[i * 4 + 1] = inCircle ? 135 : 0;  // G
    buf[i * 4 + 2] = inCircle ? 58 : 0;   // B
    buf[i * 4 + 3] = inCircle ? 255 : 0;  // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function loadTrayIcon(): Electron.NativeImage {
  // Try loading from various paths
  const candidates = [
    // Development
    path.join(__dirname, '..', 'src', 'icons', 'icon.png'),
    // Packaged (files copied to resources)
    path.join(__dirname, 'icons', 'icon.png'),
    // resourcesPath (electron-builder extraResources)
    process.resourcesPath ? path.join(process.resourcesPath, 'icon.png') : '',
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
      } catch { /* try next */ }
    }
  }

  return createFallbackIcon();
}

export function createTray(mainWindow: BrowserWindow): Tray | null {
  mainWindowRef = mainWindow;

  try {
    const icon = loadTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('MindOS');

    tray.on('click', () => {
      mainWindow.show();
      mainWindow.focus();
    });

    updateTrayMenu('local', 'starting');
    return tray;
  } catch (err) {
    // Tray creation can fail on Linux without AppIndicator
    console.warn('Failed to create system tray:', err);
    return null;
  }
}

export function updateTrayMenu(
  mode: 'local' | 'remote',
  status: ServerStatus,
  webPort?: number,
  mcpPort?: number,
  remoteAddress?: string,
): void {
  if (!tray || !mainWindowRef) return;

  const statusIcon = status === 'running' ? '🟢' : status === 'starting' ? '🟡' : '🔴';
  const statusLabel = status === 'running' ? 'Running' : status === 'starting' ? 'Starting...' : 'Error';

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: `${statusIcon} MindOS ${statusLabel}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open MindOS',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: () => {
        mainWindowRef?.show();
        mainWindowRef?.focus();
      },
    },
    { type: 'separator' },
  ];

  if (mode === 'local') {
    template.push(
      { label: `Web Server  ${webPort ? `● port ${webPort}` : ''}`, enabled: false },
      { label: `MCP Server  ${mcpPort ? `● port ${mcpPort}` : ''}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Open Knowledge Base',
        click: () => mainWindowRef?.webContents.send('ipc:open-mindroot'),
      },
      {
        label: 'Restart Services',
        click: () => mainWindowRef?.webContents.send('ipc:restart-services'),
      },
      { type: 'separator' },
      { label: 'Switch to Remote', click: () => mainWindowRef?.webContents.send('ipc:switch-mode') },
    );
  } else {
    template.push(
      { label: `Server  ${remoteAddress || 'Not connected'}`, enabled: false },
      { type: 'separator' },
      { label: 'Switch Server...', click: () => mainWindowRef?.webContents.send('ipc:switch-server') },
      { label: 'Disconnect', click: () => mainWindowRef?.webContents.send('ipc:disconnect') },
      { type: 'separator' },
      { label: 'Switch to Local', click: () => mainWindowRef?.webContents.send('ipc:switch-mode') },
    );
  }

  template.push(
    { type: 'separator' },
    { label: 'Settings...', click: () => mainWindowRef?.webContents.send('ipc:open-settings') },
    { label: 'Check for Updates...', click: () => mainWindowRef?.webContents.send('ipc:check-update') },
    { type: 'separator' },
    {
      label: 'Quit MindOS',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit(),
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`MindOS — ${statusLabel}`);
}
