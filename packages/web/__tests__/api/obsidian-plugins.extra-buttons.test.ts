import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  installObsidianPluginApiHarness, writePlugin, importLifecycleRoute, importSettingsRoute,
  confirmedEnableRequest, settingsPostRequest,
} from './obsidian-plugin-api-test-utils';

let root: string;
describe('Obsidian extra-button settings actions', () => {
  installObsidianPluginApiHarness(value => { root = value; });

  async function setup(disabled: boolean) {
    writePlugin('extra-button', `
      const { Plugin, PluginSettingTab, ExtraButtonComponent } = require('obsidian');
      class Settings extends PluginSettingTab {
        display() {
          new ExtraButtonComponent(this.containerEl).setIcon('plus').setTooltip('Capture')
            .setDisabled(${disabled}).onClick(async () => {
              await this.plugin.saveData({ captured: true });
            });
        }
      }
      module.exports = class extends Plugin {
        onload() { this.addSettingTab(new Settings(this.app, this)); }
      };
    `);
    const lifecycle = await importLifecycleRoute();
    const enabled = await lifecycle.POST(confirmedEnableRequest('extra-button'));
    expect(enabled.status).toBe(200);
    const settings = await importSettingsRoute();
    const snapshot = await (await settings.GET()).json();
    expect(snapshot.loadResult.failed).toEqual([]);
    expect(snapshot.plugins[0].settingTabs[0].items[0]).toMatchObject({
      kind: 'button', buttonText: 'Capture', canClick: !disabled,
    });
    expect(fs.existsSync(path.join(root, '.plugins/extra-button/data.json'))).toBe(false);
    return settings.POST(settingsPostRequest({
      action: 'click-button', pluginId: 'extra-button', tabIndex: 0, itemIndex: 0,
    }));
  }

  it('executes a standalone extra button only after an explicit settings action', async () => {
    expect((await setup(false)).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.plugins/extra-button/data.json'), 'utf8'))).toEqual({ captured: true });
  });

  it('rejects direct requests for disabled buttons without persisting plugin data', async () => {
    const response = await setup(true);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/disabled/);
    expect(fs.existsSync(path.join(root, '.plugins/extra-button/data.json'))).toBe(false);
  });
});
