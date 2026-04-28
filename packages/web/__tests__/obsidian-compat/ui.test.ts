import { describe, expect, it } from 'vitest';
import { Notice, Modal } from '@/lib/obsidian-compat/shims/ui';
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
      .addButton((button) => button.setButtonText('Run now').onClick(() => {}));

    expect(tab.items.map((item) => item.kind)).toEqual(['toggle', 'dropdown', 'button']);
    expect(tab.items[1]).toMatchObject({ kind: 'dropdown', value: 'fast' });
    expect(tab.items[2]).toMatchObject({ kind: 'button', buttonText: 'Run now' });
  });
});
