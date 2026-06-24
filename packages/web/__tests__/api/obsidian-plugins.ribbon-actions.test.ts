import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  confirmedEnableRequest,
  postRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('/api/obsidian-plugins ribbon actions', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('executes a loaded plugin ribbon action through the lifecycle API', async () => {
    writePlugin(
      'ribbon-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class RibbonPlugin extends Plugin {
          onload() {
            this.addRibbonIcon('sparkles', 'Capture ribbon', async () => {
              await this.app.vault.create('notes/from-ribbon.md', 'captured');
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('ribbon-plugin'));
    const res = await POST(postRequest({ action: 'execute-ribbon-action', pluginId: 'ribbon-plugin', ribbonIndex: 0 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'from-ribbon.md'), 'utf-8')).toBe('captured');
  });

  it('returns notice snapshots from executed ribbon actions', async () => {
    writePlugin(
      'ribbon-notice-plugin',
      `
        const { Notice, Plugin } = require('obsidian');
        module.exports = class RibbonNoticePlugin extends Plugin {
          onload() {
            this.addRibbonIcon('sparkles', 'Sync ribbon', () => {
              new Notice('Failed to sync plugin');
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('ribbon-notice-plugin'));
    const res = await POST(postRequest({ action: 'execute-ribbon-action', pluginId: 'ribbon-notice-plugin', ribbonIndex: 0 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({
      workspaceOpenRequests: [],
      modalSnapshots: [],
      menuSnapshots: [],
      noticeSnapshots: [{
        id: 'ribbon-notice-plugin:notice:1',
        pluginId: 'ribbon-notice-plugin',
        message: 'Failed to sync plugin',
        timeout: undefined,
        level: 'error',
      }],
    });
  });

  it('returns safe modal snapshots from executed ribbon actions', async () => {
    writePlugin(
      'ribbon-modal-plugin',
      `
        const { Modal, Plugin } = require('obsidian');
        class RibbonModal extends Modal {
          onOpen() {
            this.setTitle('Ribbon capture');
            this.contentEl.createDiv({ text: 'Opened from the plugin action tray.' });
          }
        }
        module.exports = class RibbonModalPlugin extends Plugin {
          onload() {
            this.addRibbonIcon('sparkles', 'Open ribbon modal', () => {
              new RibbonModal(this.app).open();
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('ribbon-modal-plugin'));
    const res = await POST(postRequest({ action: 'execute-ribbon-action', pluginId: 'ribbon-modal-plugin', ribbonIndex: 0 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({
      workspaceOpenRequests: [],
      modalSnapshots: [
        expect.objectContaining({
          id: 'ribbon-modal-plugin:modal:1',
          pluginId: 'ribbon-modal-plugin',
          kind: 'modal',
          title: 'Ribbon capture',
          text: 'Opened from the plugin action tray.',
        }),
      ],
      menuSnapshots: [],
    });
  });

  it('returns safe menu snapshots from executed ribbon actions', async () => {
    writePlugin(
      'ribbon-menu-plugin',
      `
        const { Menu, Plugin } = require('obsidian');
        module.exports = class RibbonMenuPlugin extends Plugin {
          onload() {
            this.addRibbonIcon('sparkles', 'Open ribbon menu', () => {
              new Menu()
                .addItem((item) => item.setTitle('Open daily note').setIcon('calendar'))
                .showAtPosition({ x: 10, y: 20 });
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('ribbon-menu-plugin'));
    const res = await POST(postRequest({ action: 'execute-ribbon-action', pluginId: 'ribbon-menu-plugin', ribbonIndex: 0 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.workspaceOpenRequests).toEqual([]);
    expect(json.result.modalSnapshots).toEqual([]);
    expect(json.result.menuSnapshots).toEqual([{
      id: 'ribbon-menu-plugin:menu:1',
      pluginId: 'ribbon-menu-plugin',
      source: 'position',
      items: [{
        index: 0,
        title: 'Open daily note',
        icon: 'calendar',
        checked: false,
        disabled: false,
        separator: false,
        canRun: false,
      }],
    }]);
    expect(json.result.menuSnapshots[0]).not.toHaveProperty('interactionId');
  });
});
