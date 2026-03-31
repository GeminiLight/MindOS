/**
 * Application menu — bilingual (zh/en) menu bar for all platforms.
 *
 * macOS: App name menu + standard Edit/View/Window/Help
 * Windows/Linux: File + Edit + View + Window + Help (replaces default English menu)
 *
 * Electron's default menu is English-only. This module provides proper
 * Chinese translations when the system locale is zh-*.
 */
import { Menu, app, shell, BrowserWindow } from 'electron';

function isZh(): boolean {
  return app.getLocale()?.startsWith('zh') ?? false;
}

export interface AppMenuCallbacks {
  onOpenMindRoot: () => void;
  onChangeMode: () => Promise<void>;
  onRestartServices: () => Promise<void>;
}

export function setupAppMenu(callbacks: AppMenuCallbacks): void {
  const zh = isZh();
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [];

  // ── macOS App menu ──
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: zh ? '关于 MindOS' : 'About MindOS' },
        { type: 'separator' },
        { role: 'services', label: zh ? '服务' : 'Services' },
        { type: 'separator' },
        { role: 'hide', label: zh ? '隐藏 MindOS' : 'Hide MindOS' },
        { role: 'hideOthers', label: zh ? '隐藏其他' : 'Hide Others' },
        { role: 'unhide', label: zh ? '显示全部' : 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: zh ? '退出 MindOS' : 'Quit MindOS' },
      ],
    });
  }

  // ── File menu (Windows/Linux only — macOS uses the App menu for quit) ──
  if (!isMac) {
    template.push({
      label: zh ? '文件' : 'File',
      submenu: [
        {
          label: zh ? '打开知识库目录' : 'Open Knowledge Base',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => callbacks.onOpenMindRoot(),
        },
        { type: 'separator' },
        {
          label: zh ? '切换模式...' : 'Switch Mode...',
          click: () => { callbacks.onChangeMode(); },
        },
        {
          label: zh ? '重启服务' : 'Restart Services',
          click: () => { callbacks.onRestartServices(); },
        },
        { type: 'separator' },
        { role: 'quit', label: zh ? '退出' : 'Quit' },
      ],
    });
  }

  // ── Edit menu ──
  template.push({
    label: zh ? '编辑' : 'Edit',
    submenu: [
      { role: 'undo', label: zh ? '撤销' : 'Undo' },
      { role: 'redo', label: zh ? '重做' : 'Redo' },
      { type: 'separator' },
      { role: 'cut', label: zh ? '剪切' : 'Cut' },
      { role: 'copy', label: zh ? '复制' : 'Copy' },
      { role: 'paste', label: zh ? '粘贴' : 'Paste' },
      { role: 'delete', label: zh ? '删除' : 'Delete' },
      { type: 'separator' },
      { role: 'selectAll', label: zh ? '全选' : 'Select All' },
    ],
  });

  // ── View menu ──
  template.push({
    label: zh ? '视图' : 'View',
    submenu: [
      { role: 'reload', label: zh ? '重新加载' : 'Reload' },
      { role: 'forceReload', label: zh ? '强制重新加载' : 'Force Reload' },
      { role: 'toggleDevTools', label: zh ? '开发者工具' : 'Toggle DevTools' },
      { type: 'separator' },
      { role: 'resetZoom', label: zh ? '重置缩放' : 'Actual Size' },
      { role: 'zoomIn', label: zh ? '放大' : 'Zoom In' },
      { role: 'zoomOut', label: zh ? '缩小' : 'Zoom Out' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: zh ? '全屏' : 'Toggle Fullscreen' },
    ],
  });

  // ── Window menu ──
  template.push({
    label: zh ? '窗口' : 'Window',
    submenu: [
      { role: 'minimize', label: zh ? '最小化' : 'Minimize' },
      { role: 'zoom', label: zh ? '缩放' : 'Zoom' },
      ...(isMac
        ? [
            { type: 'separator' as const },
            { role: 'front' as const, label: zh ? '全部置前' : 'Bring All to Front' },
          ]
        : [
            { role: 'close' as const, label: zh ? '关闭窗口' : 'Close Window' },
          ]),
    ],
  });

  // ── Help menu ──
  template.push({
    label: zh ? '帮助' : 'Help',
    submenu: [
      {
        label: zh ? 'MindOS 文档' : 'MindOS Documentation',
        click: () => { shell.openExternal('https://mindos.app/docs'); },
      },
      {
        label: zh ? '报告问题' : 'Report Issue',
        click: () => { shell.openExternal('https://github.com/GeminiLight/mindos/issues'); },
      },
      { type: 'separator' },
      {
        label: zh ? '关于 MindOS' : 'About MindOS',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) {
            const { dialog } = require('electron');
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'MindOS',
              message: `MindOS Desktop v${app.getVersion()}`,
              detail: zh
                ? '本地优先的 AI 知识管理工具\nhttps://mindos.app'
                : 'Local-first AI knowledge management\nhttps://mindos.app',
            });
          }
        },
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
