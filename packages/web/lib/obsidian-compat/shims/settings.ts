/**
 * Obsidian Plugin Compatibility - Settings DSL
 * Minimal Setting / PluginSettingTab implementation for plugin configuration.
 */

import { Component } from '../component';
import type { App, PluginSettingTab as IPluginSettingTab, PluginSettingItem, SettingKind } from '../types';

class TextComponent {
  private item: PluginSettingItem;

  constructor(item: PluginSettingItem) {
    this.item = item;
    this.item.kind = 'text';
  }

  setValue(value: string): this {
    this.item.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }
}

class ToggleComponent {
  private item: PluginSettingItem;

  constructor(item: PluginSettingItem) {
    this.item = item;
    this.item.kind = 'toggle';
  }

  setValue(value: boolean): this {
    this.item.value = value;
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }
}

class DropdownComponent {
  private item: PluginSettingItem;

  constructor(item: PluginSettingItem) {
    this.item = item;
    this.item.kind = 'dropdown';
    this.item.options = [];
  }

  addOption(value: string, label: string): this {
    this.item.options?.push({ value, label });
    return this;
  }

  setValue(value: string): this {
    this.item.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }
}

class ButtonComponent {
  private item: PluginSettingItem;

  constructor(item: PluginSettingItem) {
    this.item = item;
    this.item.kind = 'button';
  }

  setButtonText(label: string): this {
    this.item.buttonText = label;
    return this;
  }

  onClick(callback: () => void): this {
    this.item.onClick = callback;
    return this;
  }
}

function createContainer(): HTMLElement {
  if (typeof document !== 'undefined') {
    return document.createElement('div');
  }

  return {
    appendChild: () => null,
    textContent: '',
    innerHTML: '',
  } as unknown as HTMLElement;
}

export class PluginSettingTab extends Component implements IPluginSettingTab {
  app: App;
  containerEl: HTMLElement;
  items: PluginSettingItem[] = [];

  constructor(app: App) {
    super();
    this.app = app;
    this.containerEl = createContainer();
  }

  display(): void {}

  addItem(item: PluginSettingItem): void {
    this.items.push(item);
  }
}

export class Setting {
  private item: PluginSettingItem;
  private tab: PluginSettingTab;

  constructor(tab: PluginSettingTab) {
    this.tab = tab;
    this.item = {};
    this.tab.addItem(this.item);
  }

  setName(name: string): this {
    this.item.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.item.desc = desc;
    return this;
  }

  addText(configure: (component: TextComponent) => void): this {
    configure(new TextComponent(this.item));
    return this;
  }

  addToggle(configure: (component: ToggleComponent) => void): this {
    configure(new ToggleComponent(this.item));
    return this;
  }

  addDropdown(configure: (component: DropdownComponent) => void): this {
    configure(new DropdownComponent(this.item));
    return this;
  }

  addButton(configure: (component: ButtonComponent) => void): this {
    configure(new ButtonComponent(this.item));
    return this;
  }
}
