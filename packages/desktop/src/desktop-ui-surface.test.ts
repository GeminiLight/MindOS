import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const electronMock = vi.hoisted(() => ({
  getLocale: vi.fn(() => 'en-US'),
  buildFromTemplate: vi.fn((template) => template),
  setApplicationMenu: vi.fn(),
  writeText: vi.fn(),
  showMessageBox: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getLocale: electronMock.getLocale,
    getVersion: () => '0.3.13',
    name: 'MindOS',
  },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null) },
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
    setApplicationMenu: electronMock.setApplicationMenu,
  },
  Tray: class {},
  clipboard: { writeText: electronMock.writeText },
  dialog: { showMessageBox: electronMock.showMessageBox },
  nativeImage: { createFromPath: vi.fn(), createFromBuffer: vi.fn() },
  shell: { openExternal: electronMock.openExternal },
}));

beforeEach(() => {
  electronMock.buildFromTemplate.mockClear();
  electronMock.writeText.mockClear();
  electronMock.showMessageBox.mockClear();
});

describe('About dialog versions', () => {
  // CLAUDE.md: "关于 / 诊断：建议同时展示 MindOS 版本与 Desktop 壳版本".
  // The dialog used to show only `MindOS Desktop v<electron shell version>`.
  it('shows both the MindOS Core version and the Desktop shell version', async () => {
    const { buildAboutDetail } = await import('./app-menu');
    const detail = buildAboutDetail(false, '0.3.13', '0.6.27');
    expect(detail).toContain('MindOS version: v0.6.27');
    expect(detail).toContain('Desktop app version: v0.3.13');
  });

  it('says so explicitly when the Core version is not known yet', async () => {
    const { buildAboutDetail } = await import('./app-menu');
    expect(buildAboutDetail(false, '0.3.13', null)).toContain('unknown');
    expect(buildAboutDetail(true, '0.3.13', null)).toContain('未知');
  });

  it('is reachable from the Help menu and carries the live Core version', async () => {
    const { setupAppMenu } = await import('./app-menu');
    setupAppMenu({
      onOpenMindRoot: vi.fn(),
      onChangeMode: vi.fn(async () => undefined),
      onRestartServices: vi.fn(async () => undefined),
      getCoreVersion: () => '0.6.27',
    });
    const template = electronMock.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string; click?: () => void }>;
    }>;
    const help = template.find((item) => item.label === 'Help');
    const about = help?.submenu?.find((item) => item.label === 'About MindOS');
    expect(about).toBeTruthy();
    about?.click?.();
    expect(electronMock.showMessageBox).toHaveBeenCalled();
    const detail = electronMock.showMessageBox.mock.calls.at(-1)?.[0]?.detail as string;
    expect(detail).toContain('v0.6.27');
    expect(detail).toContain('v0.3.13');
  });

  it('offers a Check for Updates entry when the host wires one up', async () => {
    const onCheckForUpdates = vi.fn();
    const { setupAppMenu } = await import('./app-menu');
    setupAppMenu({
      onOpenMindRoot: vi.fn(),
      onChangeMode: vi.fn(async () => undefined),
      onRestartServices: vi.fn(async () => undefined),
      onCheckForUpdates,
    });
    const template = electronMock.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string; click?: () => void }>;
    }>;
    const items = template.flatMap((item) => item.submenu ?? []);
    const check = items.find((item) => item.label === 'Check for Updates…');
    expect(check).toBeTruthy();
    check?.click?.();
    expect(onCheckForUpdates).toHaveBeenCalled();
  });

  it('exposes a language submenu so the choice is not buried in the connect window', async () => {
    const { setupAppMenu } = await import('./app-menu');
    setupAppMenu({
      onOpenMindRoot: vi.fn(),
      onChangeMode: vi.fn(async () => undefined),
      onRestartServices: vi.fn(async () => undefined),
    });
    const template = electronMock.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string; submenu?: Array<{ label?: string }> }>;
    }>;
    const language = template
      .flatMap((item) => item.submenu ?? [])
      .find((item) => item.label === 'Language');
    expect(language?.submenu?.map((item) => item.label)).toEqual(['Follow system', '中文', 'English']);
  });
});

describe('tray menu', () => {
  it('omits the toggle accelerator until the global shortcut registers', async () => {
    const tray = await import('./tray');
    const fakeWindow = { show: vi.fn(), focus: vi.fn(), isDestroyed: () => false } as never;
    tray.createTray(fakeWindow, {
      onChangeMode: vi.fn(async () => undefined),
      onOpenMindRoot: vi.fn(),
      onRestartServices: vi.fn(async () => undefined),
      onSwitchServer: vi.fn(async () => undefined),
    });
    // createTray constructs a Tray; the stub class has no setContextMenu, so
    // the menu assertions below run against the source contract instead.
    const source = readFileSync(path.join(__dirname, 'tray.ts'), 'utf-8');
    expect(source).toContain('toggleShortcutRegistered ? { accelerator: TOGGLE_WINDOW_ACCELERATOR } : {}');
    expect(source).not.toContain("accelerator: 'CmdOrCtrl+Shift+M'");
    expect(typeof tray.setToggleShortcutRegistered).toBe('function');
  });

  it('makes the web and MCP endpoints copyable instead of disabled labels', () => {
    const source = readFileSync(path.join(__dirname, 'tray.ts'), 'utf-8');
    expect(source).toContain('clipboard.writeText(`http://127.0.0.1:${mcpPort}/mcp`)');
    expect(source).toContain('clipboard.writeText(`http://127.0.0.1:${webPort}`)');
    expect(source).not.toContain("{ label: `MCP ${mcpPort ? `· port ${mcpPort}` : ''}`, enabled: false }");
  });
});

describe('global shortcut opt-out', () => {
  it('can be disabled by env because the chord is taken system-wide', async () => {
    const { globalShortcutEnabled } = await import('./shortcuts');
    expect(globalShortcutEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(globalShortcutEnabled({ MINDOS_DISABLE_GLOBAL_SHORTCUT: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(globalShortcutEnabled({ MINDOS_DISABLE_GLOBAL_SHORTCUT: '0' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
