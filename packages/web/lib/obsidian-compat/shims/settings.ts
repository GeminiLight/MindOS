/**
 * Obsidian Plugin Compatibility - Settings DSL
 * Minimal Setting / PluginSettingTab implementation for plugin configuration.
 */

import { Component } from '../component';
import type { App, PluginSettingTab as IPluginSettingTab, PluginSettingItem, SettingDefinitionItem } from '../types';
import { createObsidianElement, ensureObsidianElement, type ObsidianElement } from './dom';

function isPluginSettingItem(target: PluginSettingItem | HTMLElement): target is PluginSettingItem {
  return !('tagName' in target);
}

function createSettingItem(target: PluginSettingItem | HTMLElement, kind: PluginSettingItem['kind']): PluginSettingItem {
  if (isPluginSettingItem(target)) {
    target.kind = kind;
    return target;
  }
  const container = ensureObsidianElement(target);
  container.__obsidianSettingItems ??= [];
  const item: PluginSettingItem = { kind };
  container.__obsidianSettingItems.push(item);
  return item;
}

export class TextComponent {
  private item: PluginSettingItem;
  inputEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    this.item = createSettingItem(target, 'text');
    this.inputEl = createObsidianElement('input');
  }

  setValue(value: string): this {
    this.item.value = value;
    this.inputEl.setAttribute('value', value);
    (this.inputEl as unknown as { value: string }).value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  setPlaceholder(value: string): this {
    this.item.placeholder = value;
    this.inputEl.setAttribute('placeholder', value);
    return this;
  }

  setDisabled(value: boolean): this {
    this.item.disabled = value;
    this.inputEl.toggleAttribute?.('disabled', value);
    return this;
  }
}

export class TextAreaComponent extends TextComponent {
  constructor(target: PluginSettingItem | HTMLElement) {
    super(target);
    this.inputEl = createObsidianElement('textarea');
  }
}

export class ToggleComponent {
  private item: PluginSettingItem;
  toggleEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    this.item = createSettingItem(target, 'toggle');
    this.toggleEl = createObsidianElement('input');
    this.toggleEl.setAttribute('type', 'checkbox');
  }

  setValue(value: boolean): this {
    this.item.value = value;
    if (value) this.toggleEl.setAttribute('checked', 'true');
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  setDisabled(value: boolean): this {
    this.item.disabled = value;
    this.toggleEl.toggleAttribute?.('disabled', value);
    return this;
  }
}

export class DropdownComponent {
  private item: PluginSettingItem;
  selectEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    this.item = createSettingItem(target, 'dropdown');
    this.item.options = [];
    this.selectEl = createObsidianElement('select');
  }

  addOption(value: string, label: string): this {
    this.item.options?.push({ value, label });
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const [value, label] of Object.entries(options)) {
      this.addOption(value, label);
    }
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

  setDisabled(value: boolean): this {
    this.item.disabled = value;
    this.selectEl.toggleAttribute?.('disabled', value);
    return this;
  }
}

export class ButtonComponent {
  private item: PluginSettingItem;
  buttonEl: ObsidianElement;
  extraSettingsEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    this.item = createSettingItem(target, 'button');
    this.buttonEl = createObsidianElement('button');
    this.extraSettingsEl = this.buttonEl;
  }

  setButtonText(label: string): this {
    this.item.buttonText = label;
    this.buttonEl.textContent = label;
    return this;
  }

  setIcon(icon: string): this {
    this.buttonEl.setAttribute('data-obsidian-icon', icon);
    return this;
  }

  setTooltip(tooltip: string): this {
    this.buttonEl.setAttribute('title', tooltip);
    this.buttonEl.setAttribute('aria-label', tooltip);
    return this;
  }

  onClick(callback: () => void): this {
    this.item.onClick = callback;
    return this;
  }

  setCta(): this {
    this.item.cta = true;
    return this;
  }

  setDisabled(value: boolean): this {
    this.item.disabled = value;
    this.buttonEl.toggleAttribute?.('disabled', value);
    return this;
  }
}

/** Icon-only Obsidian control projected onto the explicit settings-action host. */
export class ExtraButtonComponent extends ButtonComponent {
  disabled = false;

  then(callback: (component: this) => unknown): this {
    callback(this);
    return this;
  }

  override setDisabled(value: boolean): this {
    this.disabled = value;
    return super.setDisabled(value);
  }

  override setTooltip(tooltip: string, _options?: unknown): this {
    void _options;
    // The snapshot host needs a readable action label, not just an icon id.
    this.setButtonText(tooltip);
    return super.setTooltip(tooltip);
  }
}

function textFromDesc(desc: unknown): string {
  if (typeof desc === 'string') return desc;
  if (desc && typeof desc === 'object' && 'textContent' in desc) {
    return String((desc as { textContent?: unknown }).textContent ?? '');
  }
  return desc == null ? '' : String(desc);
}

function settingItemsForTarget(target: PluginSettingTab | HTMLElement): PluginSettingItem[] {
  if (target instanceof PluginSettingTab) {
    return target.items;
  }
  const container = ensureObsidianElement(target);
  container.__obsidianSettingItems ??= [];
  return container.__obsidianSettingItems;
}

export class PluginSettingTab extends Component implements IPluginSettingTab {
  app: App;
  containerEl: ObsidianElement;
  items: PluginSettingItem[] = [];
  settingItems: SettingDefinitionItem[] = [];
  plugin?: unknown;

  constructor(app: App, plugin?: unknown) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createObsidianElement('div');
    this.containerEl.__obsidianSettingItems = this.items;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  update(): void {
    const definitions = this.getSettingDefinitions();
    this.settingItems = Array.isArray(definitions) ? definitions : [];
  }

  getControlValue(key: string): unknown {
    const settings = settingsRecordFor(this.plugin);
    return settings ? settings[key] : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = ensureSettingsRecordFor(this.plugin);
    settings[key] = value;
    const plugin = this.plugin as { saveData?: (data: unknown) => Promise<void> | void } | undefined;
    if (typeof plugin?.saveData === 'function') {
      await plugin.saveData(settings);
    }
  }

  refreshDomState(): void {}

  display(): void {}

  addItem(item: PluginSettingItem): void {
    this.items.push(item);
  }
}

function settingsRecordFor(plugin: unknown): Record<string, unknown> | null {
  if (!plugin || typeof plugin !== 'object') return null;
  const settings = (plugin as { settings?: unknown }).settings;
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : null;
}

function ensureSettingsRecordFor(plugin: unknown): Record<string, unknown> {
  if (!plugin || typeof plugin !== 'object') return {};
  const target = plugin as { settings?: unknown };
  if (!target.settings || typeof target.settings !== 'object' || Array.isArray(target.settings)) {
    target.settings = {};
  }
  return target.settings as Record<string, unknown>;
}

export class Setting {
  private item: PluginSettingItem;
  private items: PluginSettingItem[];

  constructor(target: PluginSettingTab | HTMLElement) {
    this.items = settingItemsForTarget(target);
    this.item = {};
    this.items.push(this.item);
  }

  setName(name: string): this {
    this.item.name = name;
    return this;
  }

  setDesc(desc: unknown): this {
    this.item.desc = textFromDesc(desc);
    return this;
  }

  setClass(cls: string): this {
    void cls;
    return this;
  }

  setHeading(): this {
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.item.disabled = disabled;
    return this;
  }

  addText(configure: (component: TextComponent) => void): this {
    configure(new TextComponent(this.item));
    return this;
  }

  addTextArea(configure: (component: TextComponent) => void): this {
    configure(new TextAreaComponent(this.item));
    return this;
  }

  addSearch(configure: (component: TextComponent) => void): this {
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

  addExtraButton(configure: (component: ExtraButtonComponent) => void): this {
    configure(new ExtraButtonComponent(this.item));
    return this;
  }
}
