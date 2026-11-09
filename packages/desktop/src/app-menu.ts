/**
 * Application menu — bilingual (zh/en) menu bar for all platforms.
 *
 * macOS: App name menu + standard Edit/View/Window/Help
 * Windows/Linux: File + Edit + View + Window + Help (replaces default English menu)
 *
 * Electron's default menu is English-only. This module provides proper
 * Chinese translations when the resolved UI language is Chinese.
 */
import { Menu, app, dialog, shell, BrowserWindow } from 'electron';
import { MINDOS_DOCUMENTATION_URL, MINDOS_ISSUES_URL, MINDOS_SITE_URL } from './public-urls';
import { getUiLang, getUiLangPreference, setUiLangPreference, type UiLangPreference } from './i18n/lang';

export interface AppMenuCallbacks {
  onOpenMindRoot: () => void;
  onChangeMode: () => Promise<void>;
  onRestartServices: () => Promise<void>;
  /** Shell (Electron) update check — wired to the same path as the Settings UI. */
  onCheckForUpdates?: () => void;
  /**
   * MindOS Core version currently running (vs. the Electron shell version).
   * The About box used to show only the shell version, which made it
   * impossible to tell which Core a Desktop build was actually running.
   */
  getCoreVersion?: () => string | null;
  /** Re-render the menu after the language changed. */
  onLanguageChanged?: () => void;
}

export function buildAboutDetail(
  zh: boolean,
  shellVersion: string,
  coreVersion: string | null,
): string {
  const core = coreVersion
    ? `${zh ? 'MindOS 版本' : 'MindOS version'}: v${coreVersion}`
    : `${zh ? 'MindOS 版本' : 'MindOS version'}: ${zh ? '未知（本地服务尚未启动）' : 'unknown (local services not started)'}`;
  const shellLine = `${zh ? '桌面应用版本' : 'Desktop app version'}: v${shellVersion}`;
  const blurb = zh ? '知行相生 · 让认知沉淀，让心手并进' : 'Knowing and doing, each growing the other.';
  return `${core}\n${shellLine}\n\n${blurb}\n${MINDOS_SITE_URL}`;
}

export function setupAppMenu(callbacks: AppMenuCallbacks): void {
  const zh = getUiLang() === 'zh';
  const isMac = process.platform === 'darwin';

  const showAbout = () => {
    const win = BrowserWindow.getFocusedWindow();
    const options: Electron.MessageBoxOptions = {
      type: 'info',
      title: 'MindOS',
      message: 'MindOS',
      detail: buildAboutDetail(zh, app.getVersion(), callbacks.getCoreVersion?.() ?? null),
    };
    if (win) void dialog.showMessageBox(win, options);
    else void dialog.showMessageBox(options);
  };

  const languageItem = (label: string, value: UiLangPreference): Electron.MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: getUiLangPreference() === value,
    click: () => {
      setUiLangPreference(value);
      callbacks.onLanguageChanged?.();
    },
  });

  const languageSubmenu: Electron.MenuItemConstructorOptions = {
    label: zh ? '语言' : 'Language',
    submenu: [
      languageItem(zh ? '跟随系统' : 'Follow system', 'system'),
      languageItem('中文', 'zh'),
      languageItem('English', 'en'),
    ],
  };

  const updatesItem: Electron.MenuItemConstructorOptions[] = callbacks.onCheckForUpdates
    ? [{
        label: zh ? '检查更新…' : 'Check for Updates…',
        click: () => callbacks.onCheckForUpdates?.(),
      }]
    : [];

  const template: Electron.MenuItemConstructorOptions[] = [];

  // ── macOS App menu ──
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        // Custom About (not role:'about') so both versions are shown.
        { label: zh ? '关于 MindOS' : 'About MindOS', click: showAbout },
        ...updatesItem,
        { type: 'separator' },
        languageSubmenu,
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
          label: zh ? '切换模式…' : 'Switch Mode…',
          click: () => { callbacks.onChangeMode(); },
        },
        {
          label: zh ? '重启服务' : 'Restart Services',
          click: () => { callbacks.onRestartServices(); },
        },
        { type: 'separator' },
        languageSubmenu,
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
      { role: 'toggleDevTools', label: zh ? '开发者工具' : 'Developer Tools' },
      { type: 'separator' },
      { role: 'resetZoom', label: zh ? '重置缩放' : 'Actual Size' },
      { role: 'zoomIn', label: zh ? '放大' : 'Zoom In' },
      { role: 'zoomOut', label: zh ? '缩小' : 'Zoom Out' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: zh ? '切换全屏' : 'Toggle Full Screen' },
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
        click: () => { shell.openExternal(MINDOS_DOCUMENTATION_URL); },
      },
      {
        label: zh ? '报告问题' : 'Report Issue',
        click: () => { shell.openExternal(MINDOS_ISSUES_URL); },
      },
      ...(isMac ? [] : [{ type: 'separator' as const }, ...updatesItem]),
      { type: 'separator' },
      {
        label: zh ? '关于 MindOS' : 'About MindOS',
        click: showAbout,
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
