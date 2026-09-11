/**
 * Obsidian Plugin Compatibility - Settings DSL
 * Setting / PluginSettingTab and the component class hierarchy
 * (BaseComponent → ValueComponent → AbstractTextComponent → concrete controls).
 */

import { Component } from '../component';
import type { App, HexString, HSL, PluginSettingTab as IPluginSettingTab, PluginSettingItem, RGB, SettingDefinitionItem } from '../types';
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

/** Official base: shared disabled state and then-chaining for every setting control. */
export abstract class BaseComponent {
  disabled = false;

  then(callback: (component: this) => unknown): this {
    callback(this);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
}

/** Official base for controls that hold a value; option listeners transform setValue input. */
export abstract class ValueComponent<T> extends BaseComponent {
  private optionListener: ((value?: T) => T) | null = null;

  registerOptionListener(listeners: Record<string, (value?: T) => T>, key: string): this {
    this.optionListener = listeners[key] ?? null;
    return this;
  }

  protected applyOptionListeners(value: T): T {
    return this.optionListener ? this.optionListener(value) : value;
  }

  abstract getValue(): T;
  abstract setValue(value: T): this;
}

/**
 * Official base for text-like controls. The upstream constructor takes the input
 * element; the shim keeps the MindOS setting-target convention (item or container)
 * and creates a fake input element itself, so plugins can construct components
 * directly against containers just like through Setting.addXxx.
 */
export abstract class AbstractTextComponent<T extends HTMLElement> extends ValueComponent<string> {
  protected item: PluginSettingItem;
  inputEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement, kind: PluginSettingItem['kind']) {
    super();
    this.item = createSettingItem(target, kind);
    this.inputEl = createObsidianElement('input');
  }

  getValue(): string {
    return this.item.value == null ? '' : String(this.item.value);
  }

  setValue(value: string): this {
    const next = this.applyOptionListeners(value);
    this.item.value = next;
    this.inputEl.setAttribute('value', next);
    (this.inputEl as unknown as { value: string }).value = next;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.item.placeholder = placeholder;
    this.inputEl.setAttribute('placeholder', placeholder);
    return this;
  }

  onChanged(): void {}

  onChange(callback: (value: string) => unknown): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.item.disabled = disabled;
    this.inputEl.toggleAttribute?.('disabled', disabled);
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(target: PluginSettingItem | HTMLElement) {
    super(target, 'text');
  }
}

export class TextAreaComponent extends TextComponent {
  constructor(target: PluginSettingItem | HTMLElement) {
    super(target);
    this.inputEl = createObsidianElement('textarea');
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  private item: PluginSettingItem;
  toggleEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    super();
    this.item = createSettingItem(target, 'toggle');
    this.toggleEl = createObsidianElement('input');
    this.toggleEl.setAttribute('type', 'checkbox');
  }

  getValue(): boolean {
    return this.item.value === true;
  }

  setValue(value: boolean): this {
    const next = this.applyOptionListeners(value);
    this.item.value = next;
    if (next) this.toggleEl.setAttribute('checked', 'true');
    return this;
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.item.disabled = disabled;
    this.toggleEl.toggleAttribute?.('disabled', disabled);
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  private item: PluginSettingItem;
  selectEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    super();
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

  getValue(): string {
    return this.item.value == null ? '' : String(this.item.value);
  }

  setValue(value: string): this {
    this.item.value = this.applyOptionListeners(value);
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.item.disabled = disabled;
    this.selectEl.toggleAttribute?.('disabled', disabled);
    return this;
  }
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexToRgb(hex: string): RGB {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return { r: 0, g: 0, b: 0 };
  const numeric = Number.parseInt(match[1], 16);
  return { r: (numeric >> 16) & 0xff, g: (numeric >> 8) & 0xff, b: numeric & 0xff };
}

function rgbToHex({ r, g, b }: RGB): HexString {
  return `#${[clampChannel(r), clampChannel(g), clampChannel(b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = clampChannel(r) / 255;
  const gn = clampChannel(g) / 255;
  const bn = clampChannel(b) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let saturation = 0;
  let hue = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
}

function hslToRgb({ h, s, l }: HSL): RGB {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const huePrime = hue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const lightness = l / 100 - chroma / 2;
  let rgb: [number, number, number];
  if (huePrime < 1) rgb = [chroma, secondary, 0];
  else if (huePrime < 2) rgb = [secondary, chroma, 0];
  else if (huePrime < 3) rgb = [0, chroma, secondary];
  else if (huePrime < 4) rgb = [0, secondary, chroma];
  else if (huePrime < 5) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];
  return {
    r: (rgb[0] + lightness) * 255,
    g: (rgb[1] + lightness) * 255,
    b: (rgb[2] + lightness) * 255,
  };
}

export class SliderComponent extends ValueComponent<number> {
  private item: PluginSettingItem;
  sliderEl: ObsidianElement;
  private instant = false;
  private displayFormat: ((value: number) => string) | null = null;
  private limits: { min: number | null; max: number | null; step: number | 'any' } = { min: null, max: null, step: 'any' };

  constructor(target: PluginSettingItem | HTMLElement) {
    super();
    this.item = createSettingItem(target, 'slider');
    this.sliderEl = createObsidianElement('input');
    this.sliderEl.setAttribute('type', 'range');
  }

  setInstant(instant: boolean): this {
    this.instant = instant;
    return this;
  }

  isInstant(): boolean {
    return this.instant;
  }

  setLimits(min: number | null, max: number | null, step: number | 'any'): this {
    this.limits = { min, max, step };
    return this;
  }

  getLimits(): { min: number | null; max: number | null; step: number | 'any' } {
    return { ...this.limits };
  }

  getValue(): number {
    return typeof this.item.value === 'number' && Number.isFinite(this.item.value) ? this.item.value : 0;
  }

  setValue(value: number): this {
    const next = this.applyOptionListeners(value);
    this.item.value = next;
    (this.sliderEl as unknown as { value: number }).value = next;
    return this;
  }

  getValuePretty(): string {
    const value = this.getValue();
    return this.displayFormat ? this.displayFormat(value) : String(value);
  }

  setDisplayFormat(format: (value: number) => string): this {
    this.displayFormat = format;
    return this;
  }

  /** Deprecated upstream; the value is always shown inline next to the slider. */
  setDynamicTooltip(): this {
    return this;
  }

  onChange(callback: (value: number) => unknown): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.item.disabled = disabled;
    this.sliderEl.toggleAttribute?.('disabled', disabled);
    return this;
  }
}

export class ColorComponent extends ValueComponent<string> {
  private item: PluginSettingItem;

  constructor(target: PluginSettingItem | HTMLElement) {
    super();
    this.item = createSettingItem(target, 'color');
  }

  getValue(): HexString {
    return this.item.value == null ? '' : String(this.item.value);
  }

  getValueRgb(): RGB {
    return hexToRgb(this.getValue());
  }

  getValueHsl(): HSL {
    return rgbToHsl(this.getValueRgb());
  }

  setValue(value: HexString): this {
    this.item.value = this.applyOptionListeners(value);
    return this;
  }

  setValueRgb(rgb: RGB): this {
    return this.setValue(rgbToHex(rgb));
  }

  setValueHsl(hsl: HSL): this {
    return this.setValue(rgbToHex(hslToRgb(hsl)));
  }

  onChange(callback: (value: string) => unknown): this {
    this.item.onChange = callback as (value: unknown) => void;
    return this;
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.item.disabled = disabled;
    return this;
  }
}

export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  clearButtonEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    super(target, 'search');
    this.clearButtonEl = createObsidianElement('div');
  }
}

export class ButtonComponent extends BaseComponent {
  private item: PluginSettingItem;
  buttonEl: ObsidianElement;
  extraSettingsEl: ObsidianElement;

  constructor(target: PluginSettingItem | HTMLElement) {
    super();
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

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.item.disabled = disabled;
    this.buttonEl.toggleAttribute?.('disabled', disabled);
    return this;
  }
}

/** Icon-only Obsidian control projected onto the explicit settings-action host. */
export class ExtraButtonComponent extends ButtonComponent {
  override setDisabled(value: boolean): this {
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

  addTextArea(configure: (component: TextAreaComponent) => void): this {
    configure(new TextAreaComponent(this.item));
    return this;
  }

  addSearch(configure: (component: SearchComponent) => void): this {
    configure(new SearchComponent(this.item));
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

  addSlider(configure: (component: SliderComponent) => void): this {
    configure(new SliderComponent(this.item));
    return this;
  }

  addColor(configure: (component: ColorComponent) => void): this {
    configure(new ColorComponent(this.item));
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
