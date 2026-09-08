// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import * as dom from '@/lib/obsidian-compat/browser-host/dom-api';

afterEach(() => document.body.replaceChildren());
const container = () => document.body.appendChild(document.createElement('section'));

it('provides a real text setting with value, placeholder and native input callbacks', () => {
  const setting = new dom.BrowserSetting(container()).setName('空值 📚'); const values: string[] = [];
  expect(setting.addText).toBeTypeOf('function');
  setting.addText(text => text.setPlaceholder('-').setValue('initial').onChange(value => values.push(value)));
  const input = setting.controlEl.querySelector('input')!;
  expect(input.type).toBe('text'); expect(input.placeholder).toBe('-'); expect(input.value).toBe('initial');
  expect(values).toEqual([]);
  input.value = ''; input.dispatchEvent(new Event('input'));
  input.value = '中文 <b> 📚'; input.dispatchEvent(new Event('input'));
  expect(values).toEqual(['', '中文 <b> 📚']);
  expect(input.getAttribute('aria-label')).toBe('空值 📚');
});

it('disables existing and later controls and guards callbacks until re-enabled', () => {
  const setting = new dom.BrowserSetting(container()).setName('Option'); let changes = 0;
  setting.addToggle(toggle => toggle.onChange(() => changes++));
  expect(setting.setDisabled).toBeTypeOf('function');
  setting.setDisabled(true).addText(text => text.onChange(() => changes++));
  const inputs = [...setting.controlEl.querySelectorAll('input')];
  expect(inputs.every(input => input.disabled)).toBe(true);
  inputs[0].dispatchEvent(new Event('change')); inputs[1].dispatchEvent(new Event('input'));
  expect(changes).toBe(0);
  setting.setDisabled(false);
  expect(inputs.every(input => !input.disabled)).toBe(true);
  inputs[0].dispatchEvent(new Event('change')); inputs[1].dispatchEvent(new Event('input'));
  expect(changes).toBe(2);
});

it('renders setting headings and moves rich description nodes without losing their identity', () => {
  const setting = new dom.BrowserSetting(container()).setName('Tasks');
  const fragment = document.createDocumentFragment(); const strong = document.createElement('strong'); strong.textContent = 'Details'; fragment.append(strong);
  setting.setDesc(fragment);
  expect(setting.descEl.firstChild).toBe(strong);
  expect(setting.setHeading).toBeTypeOf('function'); setting.setHeading();
  expect(setting.nameEl.getAttribute('role')).toBe('heading');
  expect(setting.settingEl.classList.contains('setting-item-heading')).toBe(true);
  setting.setDesc('<b>plain</b>'); expect(setting.descEl.textContent).toBe('<b>plain</b>');
  expect(setting.descEl.querySelector('b')).toBeNull();
});

it('creates native fragments whose appendText preserves earlier elements and literal HTML', () => {
  expect(dom.createBrowserFragment).toBeTypeOf('function');
  const fragment = dom.createBrowserFragment(el => { el.appendText('before'); el.createEl('br'); el.appendText('<b>after</b>'); });
  expect(fragment).toBeInstanceOf(DocumentFragment);
  expect([...fragment.childNodes].map(node => node.nodeName)).toEqual(['#text', 'BR', '#text']);
  expect(fragment.textContent).toBe('before<b>after</b>');
  expect(dom.createBrowserFragment().childNodes).toHaveLength(0);
});

it('shows asynchronous callback failures locally instead of leaving an unhandled rejection', async () => {
  const setting = new dom.BrowserSetting(container()).setName('Option');
  expect(setting.addText).toBeTypeOf('function');
  setting.addText(text => text.onChange(async () => { throw new Error('Cannot save settings'); }));
  const input = setting.controlEl.querySelector('input')!; input.dispatchEvent(new Event('input'));
  await expect.poll(() => setting.controlEl.querySelector('[role="alert"]')?.textContent).toContain('Cannot save settings');
  expect(input.disabled).toBe(false);
});

it('keeps a synchronous toggle callback failure local and preserves the other settings', async () => {
  const setting = new dom.BrowserSetting(container()).setName('Toggle');
  setting.addToggle(toggle => toggle.onChange(() => { throw new Error('Toggle failure'); }));
  const input = setting.controlEl.querySelector('input')!;
  input.dispatchEvent(new Event('change'));
  await expect.poll(() => setting.controlEl.querySelector('[role="alert"]')?.textContent).toContain('Toggle failure');
  expect(setting.settingEl.isConnected).toBe(true);
});

it('does not let an older failed input callback replace the latest successful state', async () => {
  const setting = new dom.BrowserSetting(container()).setName('Text');
  let rejectOld!: (error: Error) => void;
  expect(setting.addText).toBeTypeOf('function');
  setting.addText(text => text.onChange(value => value === 'old' ? new Promise((_, reject) => { rejectOld = reject; }) : undefined));
  const input = setting.controlEl.querySelector('input')!;
  input.value = 'old'; input.dispatchEvent(new Event('input'));
  input.value = 'new'; input.dispatchEvent(new Event('input'));
  rejectOld(new Error('stale failure')); await Promise.resolve(); await Promise.resolve();
  expect(setting.controlEl.querySelector('[role="alert"]')).toBeNull();
});

it('exports usable standalone text and toggle components with explicit change and value access', () => {
  expect(dom.BrowserTextComponent).toBeTypeOf('function');
  const text = new dom.BrowserTextComponent(container()); const values: string[] = [];
  text.setValue('hello').onChange(value => values.push(value));
  expect(text.getValue()).toBe('hello'); text.onChanged(); expect(values).toEqual(['hello']);
  text.setDisabled(true).setValue('ignored'); text.onChanged(); expect(values).toEqual(['hello']);
  const toggle = new dom.BrowserToggleComponent(container(), 'Toggle');
  expect(toggle.getValue).toBeTypeOf('function'); expect(toggle.setValue(true).getValue()).toBe(true);
});
