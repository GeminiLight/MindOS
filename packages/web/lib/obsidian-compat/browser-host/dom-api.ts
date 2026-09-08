import { Component } from '../component';
import { createObsidianElement, ensureObsidianElement, type ObsidianElement } from '../shims/dom';
import { installLegacyCodeMirror } from './legacy-codemirror';
import { assertIsolatedPluginRealm } from './realm';
import { installBrowserDomQueries } from './dom-queries';
import { installBrowserDomLifecycle } from './dom-lifecycle';
import { createBrowserFragment } from './dom-fragment';
export { createBrowserFragment } from './dom-fragment';
export { BrowserSetting, BrowserTextComponent, BrowserToggleComponent } from './settings-controls';

function nativeElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] & ObsidianElement {
  return ensureObsidianElement(document.createElement(tag)) as HTMLElementTagNameMap[K] & ObsidianElement;
}

/** Only install in a disposable isolated realm, never in MindOS' application page. */
export function installBrowserDomApi(): void {
  assertIsolatedPluginRealm();
  installBrowserDomQueries();
  installBrowserDomLifecycle();
  if (!('contains' in String.prototype)) Object.defineProperty(String.prototype, 'contains', {
    configurable: true, writable: true,
    value(this: string, target: string) { return this.includes(target); },
  });
  ensureObsidianElement(HTMLElement.prototype);
  if (!('onClickEvent' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'onClickEvent', {
      configurable: true,
      value(this: HTMLElement, callback: EventListener) { this.addEventListener('click', callback); },
    });
  }
  Object.assign(window, { activeDocument: document, activeWindow: window, createFragment: createBrowserFragment });
  installLegacyCodeMirror();
}

export class BrowserItemView extends Component {
  containerEl = createObsidianElement('section');
  contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  constructor(readonly leaf: { app: unknown }) {
    super();
    this.containerEl.prepend(createObsidianElement('header'));
  }
  get app(): unknown { return this.leaf.app; }
  getViewType(): string { return ''; }
  getDisplayText(): string { return this.getViewType(); }
  onOpen(): void | Promise<void> {}
  onClose(): void | Promise<void> {}
  override onload(): void | Promise<void> { return this.onOpen(); }
  override onunload(): void | Promise<void> { this.containerEl.remove(); return this.onClose(); }
}

export class BrowserModal extends Component {
  containerEl = nativeElement('dialog');
  contentEl = this.containerEl.createDiv({ cls: 'modal-content' });
  constructor(readonly app: unknown) { super(); }
  open(): void {
    document.body.appendChild(this.containerEl);
    this.containerEl.showModal();
    this.onOpen();
  }
  close(): void {
    this.containerEl.close();
    this.containerEl.remove();
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
}

export class BrowserPluginSettingTab {
  containerEl = createObsidianElement('section');
  constructor(readonly app: unknown, readonly plugin: unknown) {}
  display(): void {}
  hide(): void { this.containerEl.remove(); }
}
