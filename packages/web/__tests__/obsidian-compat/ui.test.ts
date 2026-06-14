import { describe, expect, it } from 'vitest';
import { Notice, Modal } from '@/lib/obsidian-compat/shims/ui';
import { ObsidianRuntimeHost } from '@/lib/obsidian-compat/runtime';
import { PluginSettingTab, Setting } from '@/lib/obsidian-compat/shims/settings';
import type { App } from '@/lib/obsidian-compat/types';

const appStub: App = {
  vault: {} as App['vault'],
  metadataCache: {} as App['metadataCache'],
  workspace: {} as App['workspace'],
  isDarkMode: () => false,
  loadLocalStorage: () => null,
  saveLocalStorage: () => {},
  registerCommand: () => ({ id: 'noop', name: 'noop' }),
  unregisterCommand: () => {},
};

describe('UI shims', () => {
  it('stores notice message and timeout', () => {
    const notice = new Notice('Saved', 1500);
    expect(notice.message).toBe('Saved');
    expect(notice.timeout).toBe(1500);
  });

  it('records notice snapshots when a plugin runtime context is active', async () => {
    const host = new ObsidianRuntimeHost();

    await host.runWithPluginContext('notice-plugin', () => {
      new Notice('Saved draft', 1500);
      new Notice('Failed to publish');
      new Notice('Working...');
    });

    expect(host.renderNoticeSnapshotsSince(0)).toEqual([
      {
        id: 'notice-plugin:notice:1',
        pluginId: 'notice-plugin',
        message: 'Saved draft',
        timeout: 1500,
        level: 'success',
      },
      {
        id: 'notice-plugin:notice:2',
        pluginId: 'notice-plugin',
        message: 'Failed to publish',
        timeout: undefined,
        level: 'error',
      },
      {
        id: 'notice-plugin:notice:3',
        pluginId: 'notice-plugin',
        message: 'Working...',
        timeout: undefined,
        level: 'info',
      },
    ]);
  });

  it('opens and closes modal while preserving title and content in non-browser environments', () => {
    const modal = new Modal(appStub);
    modal.setTitle('Settings');
    modal.setContent('Body');
    modal.open();
    expect(modal.isOpen).toBe(true);
    expect(modal.titleEl.textContent).toBe('Settings');
    expect(modal.contentEl.textContent).toBe('Body');
    modal.close();
    expect(modal.isOpen).toBe(false);
  });

  it('collects setting items through the Setting DSL', () => {
    const tab = new PluginSettingTab(appStub);
    new Setting(tab)
      .setName('API Key')
      .setDesc('Used for requests')
      .addText((text) => text.setValue('abc').onChange(() => {}));

    expect(tab.items).toHaveLength(1);
    expect(tab.items[0]).toMatchObject({
      name: 'API Key',
      desc: 'Used for requests',
      kind: 'text',
      value: 'abc',
    });
  });

  it('supports Obsidian-style DOM helpers and new Setting(containerEl)', () => {
    const tab = new PluginSettingTab(appStub);
    const heading = tab.containerEl.createEl('h2', { text: 'Plugin Settings' });

    new Setting(tab.containerEl)
      .setName('Path')
      .setDesc('Target note')
      .addText((text) => text
        .setPlaceholder('Home.md')
        .setValue('Home.md')
        .setDisabled(false));

    expect(heading.textContent).toBe('Plugin Settings');
    expect(tab.items).toHaveLength(1);
    expect(tab.items[0]).toMatchObject({
      name: 'Path',
      desc: 'Target note',
      kind: 'text',
      value: 'Home.md',
      placeholder: 'Home.md',
      disabled: false,
    });

    tab.containerEl.empty();
    expect(tab.items).toHaveLength(0);
  });

  it('supports toggle dropdown and button settings', () => {
    const tab = new PluginSettingTab(appStub);

    new Setting(tab)
      .setName('Enabled')
      .addToggle((toggle) => toggle.setValue(true).onChange(() => {}));

    new Setting(tab)
      .setName('Mode')
      .addDropdown((dropdown) => dropdown.addOption('fast', 'Fast').setValue('fast').onChange(() => {}));

    new Setting(tab)
      .setName('Run')
      .addButton((button) => button.setButtonText('Run now').setCta().onClick(() => {}));

    expect(tab.items.map((item) => item.kind)).toEqual(['toggle', 'dropdown', 'button']);
    expect(tab.items[1]).toMatchObject({ kind: 'dropdown', value: 'fast' });
    expect(tab.items[2]).toMatchObject({ kind: 'button', buttonText: 'Run now', cta: true });
  });
});
