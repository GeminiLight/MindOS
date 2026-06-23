import { describe, expect, it, vi } from 'vitest';
import { MINDOS_DOCUMENTATION_URL } from './public-urls';

const electronMock = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template) => template),
  getLocale: vi.fn(() => 'zh-CN'),
  openExternal: vi.fn(),
  setApplicationMenu: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getLocale: electronMock.getLocale,
    getVersion: () => '1.0.0',
    name: 'MindOS',
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
    setApplicationMenu: electronMock.setApplicationMenu,
  },
  shell: {
    openExternal: electronMock.openExternal,
  },
}));

describe('desktop app menu', () => {
  it('opens the current MindOS site from Help > MindOS Documentation', async () => {
    const { setupAppMenu } = await import('./app-menu');

    setupAppMenu({
      onChangeMode: vi.fn(async () => undefined),
      onOpenMindRoot: vi.fn(),
      onRestartServices: vi.fn(async () => undefined),
    });

    const template = electronMock.buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label?: string;
      submenu?: Array<{ click?: () => void; label?: string }>;
    }>;
    const helpMenu = template.find((item) => item.label === '帮助');
    const docsItem = helpMenu?.submenu?.find((item) => item.label === 'MindOS 文档');

    expect(docsItem).toBeTruthy();
    docsItem?.click?.();
    expect(electronMock.openExternal).toHaveBeenCalledWith(MINDOS_DOCUMENTATION_URL);
  });
});
