import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PLUGIN_INTERACTION_TTL_MS } from '@/lib/obsidian-compat/runtime';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  postRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('/api/obsidian-plugins menu interactions', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('returns safe menu snapshots from executed plugin commands', async () => {
    writePlugin(
      'menu-command-plugin',
      `
        const { Menu, Plugin } = require('obsidian');
        module.exports = class MenuCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-menu',
              name: 'Open menu',
              callback: () => {
                new Menu()
                  .addItem((item) => item.setTitle('Capture to inbox').setIcon('inbox').onClick(() => {}))
                  .addItem((item) => item.setTitle('Pinned template').setChecked(true))
                  .addSeparator()
                  .addItem((item) => item.setTitle('Disabled action').setDisabled(true))
                  .showAtMouseEvent({ clientX: 1, clientY: 2 });
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'menu-command-plugin' }));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:menu-command-plugin:open-menu' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.workspaceOpenRequests).toEqual([]);
    expect(json.result.modalSnapshots).toEqual([]);
    expect(json.result.menuSnapshots).toEqual([{
      id: 'menu-command-plugin:menu:1',
      pluginId: 'menu-command-plugin',
      source: 'mouse',
      interactionId: expect.any(String),
      items: [
        {
          index: 0,
          title: 'Capture to inbox',
          icon: 'inbox',
          checked: false,
          disabled: false,
          separator: false,
          canRun: true,
        },
        {
          index: 1,
          title: 'Pinned template',
          checked: true,
          disabled: false,
          separator: false,
          canRun: false,
        },
        {
          index: 2,
          title: '',
          checked: false,
          disabled: true,
          separator: true,
          canRun: false,
        },
        {
          index: 3,
          title: 'Disabled action',
          checked: false,
          disabled: true,
          separator: false,
          canRun: false,
        },
      ],
    }]);
  });

  it('continues a Menu by choosing a recorded item', async () => {
    writePlugin(
      'menu-choice-plugin',
      `
        const { Menu, Notice, Plugin } = require('obsidian');
        module.exports = class MenuChoicePlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-menu',
              name: 'Open menu',
              callback: () => {
                new Menu()
                  .addItem((item) => item.setTitle('Capture to inbox').setIcon('inbox').onClick(async () => {
                    await this.app.vault.create('captured.md', 'captured');
                    new Notice('Captured to inbox', 1200);
                  }))
                  .showAtMouseEvent({ clientX: 1, clientY: 2 });
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'menu-choice-plugin' }));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:menu-choice-plugin:open-menu' }));
    const openJson = await openRes.json();
    const menu = openJson.result.menuSnapshots[0];
    expect(menu.interactionId).toEqual(expect.any(String));

    const chooseRes = await POST(postRequest({
      action: 'choose-menu-item',
      menuId: menu.id,
      itemIndex: 0,
      interactionId: menu.interactionId,
    }));
    const chooseJson = await chooseRes.json();

    expect(chooseRes.status).toBe(200);
    expect(chooseJson.ok).toBe(true);
    expect(fs.readFileSync(path.join(mindRoot, 'captured.md'), 'utf-8')).toBe('captured');
    expect(chooseJson.result).toEqual({
      workspaceOpenRequests: [],
      modalSnapshots: [],
      menuSnapshots: [],
      noticeSnapshots: [{
        id: 'menu-choice-plugin:notice:1',
        pluginId: 'menu-choice-plugin',
        message: 'Captured to inbox',
        timeout: 1200,
        level: 'info',
      }],
    });
  });

  it('rejects stale Menu interaction ids without executing the callback', async () => {
    writePlugin(
      'stale-menu-plugin',
      `
        const { Menu, Plugin } = require('obsidian');
        module.exports = class StaleMenuPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-menu',
              name: 'Open menu',
              callback: () => {
                new Menu()
                  .addItem((item) => item.setTitle('Run once').onClick(() => {
                    this.app.vault.create('should-not-run.md', 'bad');
                  }))
                  .showAtMouseEvent({ clientX: 1, clientY: 2 });
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'stale-menu-plugin' }));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:stale-menu-plugin:open-menu' }));
    const openJson = await openRes.json();
    const menu = openJson.result.menuSnapshots[0];

    const res = await POST(postRequest({
      action: 'choose-menu-item',
      menuId: menu.id,
      itemIndex: 0,
      interactionId: 'expired-interaction',
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expired plugin menu interaction');
    expect(fs.existsSync(path.join(mindRoot, 'should-not-run.md'))).toBe(false);
  });

  it('expires Menu continuation tokens without executing the callback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T00:00:00.000Z'));
    writePlugin(
      'ttl-menu-plugin',
      `
        const { Menu, Plugin } = require('obsidian');
        module.exports = class TtlMenuPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-menu',
              name: 'Open menu',
              callback: () => {
                new Menu()
                  .addItem((item) => item.setTitle('Run after delay').onClick(() => {
                    this.app.vault.create('ttl-menu-ran.md', 'bad');
                  }))
                  .showAtMouseEvent({ clientX: 1, clientY: 2 });
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'ttl-menu-plugin' }));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:ttl-menu-plugin:open-menu' }));
    const openJson = await openRes.json();
    const menu = openJson.result.menuSnapshots[0];
    expect(menu.interactionId).toEqual(expect.any(String));

    vi.setSystemTime(new Date(Date.now() + PLUGIN_INTERACTION_TTL_MS));
    const res = await POST(postRequest({
      action: 'choose-menu-item',
      menuId: menu.id,
      itemIndex: 0,
      interactionId: menu.interactionId,
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expired plugin menu interaction');
    expect(fs.existsSync(path.join(mindRoot, 'ttl-menu-ran.md'))).toBe(false);
  });

  it('consumes Menu interactions before executing callbacks so failed callbacks cannot be replayed', async () => {
    writePlugin(
      'menu-replay-plugin',
      `
        const { Menu, Plugin } = require('obsidian');
        module.exports = class MenuReplayPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-menu',
              name: 'Open menu',
              callback: () => {
                new Menu()
                  .addItem((item) => item.setTitle('Run once').onClick(async () => {
                    await this.app.vault.adapter.append('menu-replay.log', 'x');
                    throw new Error('menu callback failed');
                  }))
                  .showAtMouseEvent({ clientX: 1, clientY: 2 });
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'menu-replay-plugin' }));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:menu-replay-plugin:open-menu' }));
    const openJson = await openRes.json();
    const menu = openJson.result.menuSnapshots[0];

    const firstRes = await POST(postRequest({
      action: 'choose-menu-item',
      menuId: menu.id,
      itemIndex: 0,
      interactionId: menu.interactionId,
    }));
    const firstJson = await firstRes.json();

    expect(firstRes.status).toBe(500);
    expect(firstJson.error).toContain('menu callback failed');
    expect(fs.readFileSync(path.join(mindRoot, 'menu-replay.log'), 'utf-8')).toBe('x');

    const secondRes = await POST(postRequest({
      action: 'choose-menu-item',
      menuId: menu.id,
      itemIndex: 0,
      interactionId: menu.interactionId,
    }));
    const secondJson = await secondRes.json();

    expect(secondRes.status).toBe(400);
    expect(secondJson.error).toContain('Expired plugin menu interaction');
    expect(fs.readFileSync(path.join(mindRoot, 'menu-replay.log'), 'utf-8')).toBe('x');
  });

  it('commits editor updates made after choosing a Menu item', async () => {
    fs.writeFileSync(path.join(mindRoot, 'menu-draft.md'), 'Start ', 'utf-8');
    writePlugin(
      'menu-editor-choice-plugin',
      `
        const { Menu, Notice, Plugin } = require('obsidian');
        module.exports = class MenuEditorChoicePlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'insert-menu-template',
              name: 'Insert menu template',
              editorCallback: (editor) => {
                new Menu()
                  .addItem((item) => item.setTitle('Daily note').onClick(() => {
                    editor.replaceSelection('Daily note');
                    new Notice('Inserted Daily note', 1200);
                  }))
                  .showAtMouseEvent({ clientX: 1, clientY: 2 });
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'menu-editor-choice-plugin' }));
    const openRes = await POST(postRequest({
      action: 'execute-command',
      commandId: 'obsidian:menu-editor-choice-plugin:insert-menu-template',
      editorContext: {
        sourcePath: 'menu-draft.md',
        cursorOffset: 'Start '.length,
      },
    }));
    const openJson = await openRes.json();
    const menu = openJson.result.menuSnapshots[0];

    const chooseRes = await POST(postRequest({
      action: 'choose-menu-item',
      menuId: menu.id,
      itemIndex: 0,
      interactionId: menu.interactionId,
    }));
    const chooseJson = await chooseRes.json();

    expect(chooseRes.status).toBe(200);
    expect(chooseJson.ok).toBe(true);
    expect(fs.readFileSync(path.join(mindRoot, 'menu-draft.md'), 'utf-8')).toBe('Start Daily note');
    expect(chooseJson.result.editorUpdates).toEqual([{
      sourcePath: 'menu-draft.md',
      changed: true,
    }]);
    expect(chooseJson.result.noticeSnapshots).toEqual([{
      id: 'menu-editor-choice-plugin:notice:1',
      pluginId: 'menu-editor-choice-plugin',
      message: 'Inserted Daily note',
      timeout: 1200,
      level: 'info',
    }]);
  });
});
