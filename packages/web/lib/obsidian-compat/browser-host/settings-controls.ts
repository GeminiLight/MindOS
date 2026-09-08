import { createObsidianElement } from '../shims/dom';

/** Observe plugin callbacks without turning a setting error into a dead editor.
 * The generation is local to a control: a slow old failure cannot replace a
 * newer interaction's result. It is not a persistence or permission boundary.
 */
class SettingChangeHandler {
  private generation = 0;
  private errorEl?: HTMLElement;
  constructor(private readonly container: HTMLElement) {}
  run(callback: () => unknown): void {
    const generation = ++this.generation;
    this.errorEl?.remove(); this.errorEl = undefined;
    const fail = (error: unknown) => {
      if (generation !== this.generation) return;
      this.errorEl = document.createElement('div');
      this.errorEl.className = 'setting-item-error'; this.errorEl.setAttribute('role', 'alert');
      this.errorEl.textContent = `Setting change failed: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'}`;
      this.container.appendChild(this.errorEl);
    };
    try { void Promise.resolve(callback()).catch(fail); } catch (error) { fail(error); }
  }
}

export class BrowserTextComponent {
  readonly inputEl = document.createElement('input');
  private callback: (value: string) => unknown = () => {};
  private readonly changes: SettingChangeHandler;
  constructor(container: HTMLElement, name = '') {
    this.changes = new SettingChangeHandler(container);
    this.inputEl.type = 'text'; this.inputEl.setAttribute('aria-label', name);
    this.inputEl.oninput = () => this.onChanged(); container.appendChild(this.inputEl);
  }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  getValue(): string { return this.inputEl.value; }
  setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
  setDisabled(value: boolean): this { this.inputEl.disabled = value; return this; }
  onChange(callback: (value: string) => unknown): this { this.callback = callback; return this; }
  onChanged(): void {
    if (!this.inputEl.disabled) this.changes.run(() => this.callback(this.getValue()));
  }
}

export class BrowserToggleComponent {
  readonly toggleEl = document.createElement('input');
  private callback: (value: boolean) => unknown = () => {};
  private readonly changes: SettingChangeHandler;
  constructor(container: HTMLElement, name = '') {
    this.changes = new SettingChangeHandler(container);
    this.toggleEl.type = 'checkbox'; this.toggleEl.setAttribute('aria-label', name);
    this.toggleEl.onchange = () => {
      if (!this.toggleEl.disabled) this.changes.run(() => this.callback(this.getValue()));
    };
    container.appendChild(this.toggleEl);
  }
  setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
  getValue(): boolean { return this.toggleEl.checked; }
  setDisabled(value: boolean): this { this.toggleEl.disabled = value; return this; }
  onChange(callback: (value: boolean) => unknown): this { this.callback = callback; return this; }
}

/** Real DOM controls, separate from the server-side snapshot settings adapter. */
export class BrowserSetting {
  readonly settingEl = createObsidianElement('div');
  readonly infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
  readonly nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
  readonly descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
  readonly controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  readonly components: (BrowserTextComponent | BrowserToggleComponent)[] = [];
  private disabled = false;
  constructor(container: HTMLElement) { this.settingEl.addClass('setting-item'); container.appendChild(this.settingEl); }
  setName(name: string | DocumentFragment): this {
    this.nameEl.replaceChildren(name);
    for (const input of this.controlEl.querySelectorAll('input')) input.setAttribute('aria-label', this.nameEl.textContent ?? '');
    return this;
  }
  setDesc(description: string | DocumentFragment): this { this.descEl.replaceChildren(description); return this; }
  setHeading(): this {
    this.settingEl.addClass('setting-item-heading'); this.nameEl.setAttribute('role', 'heading'); this.nameEl.setAttribute('aria-level', '3'); return this;
  }
  setDisabled(value: boolean): this {
    this.disabled = value; this.settingEl.classList.toggle('is-disabled', value);
    this.components.forEach(component => component.setDisabled(value)); return this;
  }
  addToggle(callback: (toggle: BrowserToggleComponent) => unknown): this {
    return this.addControl(new BrowserToggleComponent(this.controlEl, this.nameEl.textContent ?? ''), callback);
  }
  addText(callback: (text: BrowserTextComponent) => unknown): this {
    return this.addControl(new BrowserTextComponent(this.controlEl, this.nameEl.textContent ?? ''), callback);
  }
  private addControl<T extends BrowserTextComponent | BrowserToggleComponent>(control: T, callback: (control: T) => unknown): this {
    this.components.push(control); callback(control);
    if (this.disabled) control.setDisabled(true);
    return this;
  }
}
