import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian setting component class hierarchy', () => {
  it('places the new components on the official BaseComponent → ValueComponent chain', () => {
    const mod = createObsidianModule();
    const container = createObsidianElement('div');
    const slider = new mod.SliderComponent(container);
    const color = new mod.ColorComponent(container);
    const search = new mod.SearchComponent(container);

    expect(slider).toBeInstanceOf(mod.ValueComponent);
    expect(slider).toBeInstanceOf(mod.BaseComponent);
    expect(color).toBeInstanceOf(mod.ValueComponent);
    expect(search).toBeInstanceOf(mod.AbstractTextComponent);
    expect(search).toBeInstanceOf(mod.ValueComponent);
  });

  it('keeps the existing text, toggle, dropdown and button components on the same chain', () => {
    const mod = createObsidianModule();
    const container = createObsidianElement('div');
    const text = new mod.TextComponent(container);
    const toggle = new mod.ToggleComponent(container);
    const dropdown = new mod.DropdownComponent(container);
    const button = new mod.ButtonComponent(container);

    expect(text).toBeInstanceOf(mod.AbstractTextComponent);
    expect(toggle).toBeInstanceOf(mod.ValueComponent);
    expect(dropdown).toBeInstanceOf(mod.ValueComponent);
    expect(button).toBeInstanceOf(mod.BaseComponent);
  });

  it('supports then-chaining and shared disabled state on BaseComponent', () => {
    const { SliderComponent } = createObsidianModule();
    const slider = new SliderComponent(createObsidianElement('div'));
    let chained: unknown;
    expect(slider.setDisabled(true).then(component => { chained = component; }).setDisabled(false)).toBe(slider);
    expect(chained).toBe(slider);
    expect(slider.disabled).toBe(false);
  });

  describe('SliderComponent', () => {
    it('round-trips numeric values with limits and pretty formatting', () => {
      const { SliderComponent } = createObsidianModule();
      const slider = new SliderComponent(createObsidianElement('div'));

      expect(slider.setLimits(0, 100, 5).setValue(42)).toBe(slider);
      expect(slider.getValue()).toBe(42);
      expect(slider.getValuePretty()).toBe('42');
      expect(slider.sliderEl.getAttribute('type')).toBe('range');
    });

    it('honours a custom display format and instant dragging mode', () => {
      const { SliderComponent } = createObsidianModule();
      const slider = new SliderComponent(createObsidianElement('div'));

      expect(slider.setInstant(true)).toBe(slider);
      expect(slider.setDisplayFormat(value => `${value}px`).setValue(7).getValuePretty()).toBe('7px');
    });

    it('tolerates null limits and the any step, and records the onChange callback', () => {
      const { SliderComponent } = createObsidianModule();
      const container = createObsidianElement('div');
      let observed = 0;
      const slider = new SliderComponent(container);

      expect(slider.setLimits(null, null, 'any')).toBe(slider);
      slider.setValue(3).onChange(value => { observed = value; });
      const item = container.__obsidianSettingItems?.[0];
      expect(item?.kind).toBe('slider');
      expect(item?.value).toBe(3);
      item?.onChange?.(11);
      expect(observed).toBe(11);
    });
  });

  describe('ColorComponent', () => {
    it('round-trips hex color values and records the setting item', () => {
      const { ColorComponent } = createObsidianModule();
      const container = createObsidianElement('div');
      let observed = '';
      const color = new ColorComponent(container);

      expect(color.setValue('#ff8000')).toBe(color);
      expect(color.getValue()).toBe('#ff8000');
      color.onChange(value => { observed = value; });
      const item = container.__obsidianSettingItems?.[0];
      expect(item?.kind).toBe('color');
      expect(item?.value).toBe('#ff8000');
      item?.onChange?.('#000000');
      expect(observed).toBe('#000000');
    });

    it('converts between hex, RGB and HSL representations', () => {
      const { ColorComponent } = createObsidianModule();
      const color = new ColorComponent(createObsidianElement('div'));

      color.setValue('#ff8000');
      expect(color.getValueRgb()).toEqual({ r: 255, g: 128, b: 0 });
      const hsl = color.getValueHsl();
      expect(hsl.s).toBeCloseTo(100, 0);
      expect(hsl.l).toBeCloseTo(50, 0);
      expect(hsl.h).toBeCloseTo(30, 0);

      expect(color.setValueRgb({ r: 0, g: 128, b: 255 }).getValue()).toBe('#0080ff');
      expect(color.setValueHsl({ h: 30, s: 100, l: 50 }).getValue()).toBe('#ff8000');
    });

    it('falls back to black when the stored value is not a hex color', () => {
      const { ColorComponent } = createObsidianModule();
      const color = new ColorComponent(createObsidianElement('div'));

      color.setValue('not-a-color');
      expect(color.getValueRgb()).toEqual({ r: 0, g: 0, b: 0 });
    });
  });

  describe('SearchComponent', () => {
    it('behaves as a text-like control with a clear button element', () => {
      const { SearchComponent } = createObsidianModule();
      const container = createObsidianElement('div');
      let observed = '';
      const search = new SearchComponent(container);

      expect(search.setPlaceholder('Find…').setValue('query')).toBe(search);
      expect(search.getValue()).toBe('query');
      expect(search.clearButtonEl).toBeDefined();
      search.onChange(value => { observed = value; });
      const item = container.__obsidianSettingItems?.[0];
      expect(item?.kind).toBe('search');
      item?.onChange?.('next');
      expect(observed).toBe('next');
    });

    it('invokes the overridden onChanged hook without throwing by default', () => {
      const { SearchComponent } = createObsidianModule();
      const search = new SearchComponent(createObsidianElement('div'));
      expect(() => search.onChanged()).not.toThrow();
    });
  });

  it('wires the new controls through Setting.addSlider / addColor / addSearch', () => {
    const mod = createObsidianModule();
    const container = createObsidianElement('div');

    new mod.Setting(container).setName('Limit').addSlider(slider => {
      expect(slider).toBeInstanceOf(mod.SliderComponent);
      slider.setLimits(0, 10, 1).setValue(5);
    });
    new mod.Setting(container).setName('Accent').addColor(color => {
      expect(color).toBeInstanceOf(mod.ColorComponent);
      color.setValue('#123456');
    });
    new mod.Setting(container).setName('Find').addSearch(search => {
      expect(search).toBeInstanceOf(mod.SearchComponent);
      search.setValue('term');
    });

    const items = container.__obsidianSettingItems ?? [];
    expect(items.map(item => item.kind)).toEqual(['slider', 'color', 'search']);
    expect(items[0].value).toBe(5);
    expect(items[1].value).toBe('#123456');
    expect(items[2].value).toBe('term');
  });

  it('exposes registerOptionListener on ValueComponent subclasses', () => {
    const { SliderComponent } = createObsidianModule();
    const slider = new SliderComponent(createObsidianElement('div'));
    const listeners: Record<string, (value?: number) => number> = { limit: value => value ?? 0 };
    expect(slider.registerOptionListener(listeners, 'limit')).toBe(slider);
  });

  it('classifies the new component exports as supported settings APIs', () => {
    const report = analyzePluginCompatibility(
      'const { SliderComponent, ColorComponent, SearchComponent, BaseComponent, ValueComponent } = require("obsidian");',
    );
    for (const api of ['SliderComponent', 'ColorComponent', 'SearchComponent', 'BaseComponent', 'ValueComponent']) {
      expect(report.obsidianApis).toContain(api);
      expect(report.unsupportedApis).not.toContain(api);
    }
  });
});
