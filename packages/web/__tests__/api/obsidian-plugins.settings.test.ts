import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  importSettingsRoute,
  postRequest,
  settingsPostRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('/api/obsidian-plugins settings', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('returns settings from enabled Obsidian-style setting tabs', async () => {
    writePlugin(
      'settings-plugin',
      `
        const { Plugin, PluginSettingTab, Setting } = require('obsidian');
        class SettingsTab extends PluginSettingTab {
          constructor(app, plugin) {
            super(app, plugin);
            this.plugin = plugin;
          }
          display() {
            const { containerEl } = this;
            containerEl.empty();
            new Setting(containerEl)
              .setName('API Key')
              .addText((text) => text.setPlaceholder('token').setValue('abc'));
            new Setting(containerEl)
              .setName('Enabled')
              .addToggle((toggle) => toggle.setValue(true));
          }
        }
        module.exports = class SettingsPlugin extends Plugin {
          onload() {
            this.addSettingTab(new SettingsTab(this.app, this));
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'settings-plugin' }));

    const { GET } = await importSettingsRoute();
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.loadResult).toEqual({ loaded: ['settings-plugin'], failed: [], skipped: [] });
    expect(json.plugins[0]).toMatchObject({
      id: 'settings-plugin',
      settingTabs: [
        {
          items: [
            { name: 'API Key', kind: 'text', value: 'abc', placeholder: 'token', canChange: false },
            { name: 'Enabled', kind: 'toggle', value: true, canChange: false },
          ],
        },
      ],
    });
  });

  it('updates plugin settings by replaying Setting onChange callbacks', async () => {
    writePlugin(
      'settings-action-plugin',
      `
        const { Plugin, PluginSettingTab, Setting } = require('obsidian');
        class SettingsTab extends PluginSettingTab {
          constructor(app, plugin) {
            super(app, plugin);
            this.plugin = plugin;
          }
          display() {
            const { containerEl } = this;
            containerEl.empty();
            new Setting(containerEl)
              .setName('Capture path')
              .addText((text) => text
                .setValue(this.plugin.settings.path)
                .onChange(async (value) => {
                  this.plugin.settings.path = value;
                  await this.plugin.saveSettings();
                }));
            new Setting(containerEl)
              .setName('Enabled')
              .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.enabled)
                .onChange(async (value) => {
                  this.plugin.settings.enabled = value;
                  await this.plugin.saveSettings();
                }));
          }
        }
        module.exports = class SettingsActionPlugin extends Plugin {
          async onload() {
            this.settings = Object.assign({ path: 'Inbox.md', enabled: true }, await this.loadData() || {});
            this.addSettingTab(new SettingsTab(this.app, this));
          }
          async saveSettings() {
            await this.saveData(this.settings);
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'settings-action-plugin' }));

    const settingsRoute = await importSettingsRoute();
    const res = await settingsRoute.POST(settingsPostRequest({
      action: 'set-value',
      pluginId: 'settings-action-plugin',
      tabIndex: 0,
      itemIndex: 0,
      value: 'Daily.md',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.plugins[0].settingTabs[0].items[0]).toMatchObject({
      name: 'Capture path',
      kind: 'text',
      value: 'Daily.md',
      canChange: true,
    });
    expect(JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'settings-action-plugin', 'data.json'), 'utf-8'))).toEqual({
      path: 'Daily.md',
      enabled: true,
    });
  });
});
