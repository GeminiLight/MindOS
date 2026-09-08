import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian ExtraButtonComponent compatibility', () => {
  it('exports a constructible icon button with fluent configuration and a plain-text label', () => {
    const { ExtraButtonComponent } = createObsidianModule();
    const container = createObsidianElement('div');
    const button = new ExtraButtonComponent(container);
    expect(button.setIcon('trash').setTooltip('<b>删除</b>').then(value => value.setDisabled(true))).toBe(button);
    expect(button.disabled).toBe(true);
    expect(button.extraSettingsEl.getAttribute('aria-label')).toBe('<b>删除</b>');
    expect(container.__obsidianSettingItems?.[0]).toMatchObject({
      kind: 'button', buttonText: '<b>删除</b>', disabled: true,
    });
    button.setDisabled(false);
    expect(button.disabled).toBe(false);
    expect(container.__obsidianSettingItems?.[0].disabled).toBe(false);
  });

  it('uses the same component class for Setting.addExtraButton without running callbacks during rendering', () => {
    const { ExtraButtonComponent, Setting } = createObsidianModule();
    const container = createObsidianElement('div');
    let count = 0;
    new Setting(container).setName('Choice').addExtraButton(button => {
      expect(button).toBeInstanceOf(ExtraButtonComponent);
      button.setIcon('plus').setTooltip('Add choice').onClick(() => { count++; });
    });
    expect(count).toBe(0);
    container.__obsidianSettingItems?.[0].onClick?.();
    expect(count).toBe(1);
  });

  it('classifies the export used by QuickAdd as limited settings support rather than an unsupported API', () => {
    const report = analyzePluginCompatibility('const { ExtraButtonComponent } = require("obsidian"); new ExtraButtonComponent(container);');
    expect(report.obsidianApis).toContain('ExtraButtonComponent');
    expect(report.unsupportedApis).not.toContain('ExtraButtonComponent');
    expect(report.partialApis).toContain('ExtraButtonComponent');
  });
});
