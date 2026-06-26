/**
 * Obsidian Plugin Compatibility - UI shims
 * Integrates Obsidian plugin UI components with MindOS's UI system.
 */

import { Component } from '../component';
import type { App } from '../types';
import type { ObsidianRuntimeHost } from '../runtime';
import { getActiveObsidianRuntimeHost, inferPluginNoticeLevel } from '../runtime';
import { toast } from '@/lib/toast';
import { createObsidianElement, ensureObsidianElement, type ObsidianElement } from './dom';

type RuntimeApp = App & { getRuntimeHost?: () => ObsidianRuntimeHost };

type SuggestModalLike = Modal & {
  inputEl?: HTMLElement;
  getSuggestions?: (query: string) => unknown[] | Promise<unknown[]>;
  renderSuggestion?: (value: unknown, el: HTMLElement) => void;
  onChooseSuggestion?: (value: unknown) => unknown;
};

type TextModalLike = Modal & {
  inputEl?: HTMLElement;
  okButton?: HTMLElement;
  onOK?: (event: MouseEvent | KeyboardEvent) => boolean | void | Promise<boolean | void>;
};

function getRuntimeHost(app: App): ObsidianRuntimeHost | null {
  return (app as RuntimeApp).getRuntimeHost?.() ?? null;
}

function hasPluginMethodOverride(instance: object, methodName: string): boolean {
  if (Object.prototype.hasOwnProperty.call(instance, methodName)) return true;
  let prototype = Object.getPrototypeOf(instance);
  while (prototype && prototype !== Modal.prototype) {
    if (Object.prototype.hasOwnProperty.call(prototype, methodName)) {
      const constructorName = typeof prototype.constructor?.name === 'string' ? prototype.constructor.name : '';
      return constructorName !== 'SuggestModal' && constructorName !== 'FuzzySuggestModal';
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

/**
 * Notice - Displays toast notifications using MindOS's toast system.
 */
export class Notice {
  message: string;
  timeout?: number;

  constructor(message: string, timeout?: number) {
    const normalizedMessage = String(message);
    this.message = normalizedMessage;
    this.timeout = timeout;
    const level = inferPluginNoticeLevel(normalizedMessage);

    getActiveObsidianRuntimeHost()?.recordNotice({
      message: normalizedMessage,
      timeout,
      level,
    });

    // Integrate with MindOS toast system
    if (typeof window !== 'undefined') {
      if (level === 'error') {
        toast.error(normalizedMessage, timeout);
      } else if (level === 'success') {
        toast.success(normalizedMessage, timeout);
      } else {
        toast(normalizedMessage, timeout !== undefined ? { duration: timeout } : undefined);
      }
    }
  }
}

/**
 * Modal - Base modal class for Obsidian plugins.
 *
 * Note: This provides a DOM-based API for compatibility, but plugins should
 * ideally use React-based dialogs for better integration with MindOS.
 *
 * For full integration with MindOS's dialog system, plugins can:
 * 1. Use this class for simple modals (DOM-based)
 * 2. Extend this class and override open() to render React dialogs
 * 3. Use MindOS's Dialog components directly if the plugin is React-aware
 */
export class Modal extends Component {
  app: App;
  containerEl: ObsidianElement;
  modalEl: ObsidianElement;
  contentEl: ObsidianElement;
  titleEl: ObsidianElement;
  isOpen = false;
  private modalRoot: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;

  constructor(app: App) {
    super();
    this.app = app;
    this.containerEl = createObsidianElement('div');
    this.modalEl = createObsidianElement('div');
    this.contentEl = createObsidianElement('div');
    this.titleEl = createObsidianElement('div');
    this.containerEl.appendChild(this.modalEl);
    this.modalEl.appendChild(this.titleEl);
    this.modalEl.appendChild(this.contentEl);
  }

  open(): void {
    this.isOpen = true;
    this.onOpen();

    // Create modal in DOM if in browser environment
    if (typeof document !== 'undefined') {
      this.renderModal();
    }

    const suggest = this as SuggestModalLike;
    const textInput = findTextInputElement(this);
    getRuntimeHost(this.app)?.recordModalOpen({
      kind: typeof suggest.getSuggestions === 'function' ? 'suggest' : 'modal',
      titleEl: this.titleEl,
      contentEl: this.contentEl,
      placeholder: suggest.inputEl?.getAttribute('placeholder') ?? undefined,
      getSuggestions: suggest.getSuggestions?.bind(this),
      renderSuggestion: suggest.renderSuggestion?.bind(this),
      chooseSuggestion: hasPluginMethodOverride(this, 'onChooseSuggestion') ? suggest.onChooseSuggestion?.bind(this) : undefined,
      textInputEl: textInput,
      submitText: textInput ? createTextModalSubmitter(this, textInput) : undefined,
      close: this.close.bind(this),
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    // Remove modal from DOM
    if (this.modalRoot) {
      this.modalRoot.remove();
      this.modalRoot = null;
    }
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }

    this.onClose();
  }

  onOpen(): void {}

  onClose(): void {}

  setTitle(title: string): void {
    this.titleEl.textContent = title;
    if (this.modalRoot) {
      const titleElement = this.modalRoot.querySelector('[data-modal-title]');
      if (titleElement) {
        titleElement.textContent = title;
      }
    }
  }

  setContent(content: string | HTMLElement): void {
    if (typeof content === 'string') {
      this.contentEl.textContent = content;
    } else {
      this.contentEl.empty();
      this.contentEl.appendChild(content);
    }

    if (this.modalRoot) {
      const contentElement = this.modalRoot.querySelector('[data-modal-content]');
      if (contentElement) {
        contentElement.innerHTML = '';
        if (typeof content === 'string') {
          contentElement.textContent = content;
        } else {
          contentElement.appendChild(content.cloneNode(true));
        }
      }
    }
  }

  private renderModal(): void {
    // Create backdrop
    this.backdrop = ensureObsidianElement(document.createElement('div'));
    this.backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 9998;
      animation: fadeIn 0.2s ease-out;
    `;
    this.backdrop.addEventListener('click', () => this.close());

    // Create modal container
    this.modalRoot = ensureObsidianElement(document.createElement('div'));
    this.modalRoot.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: var(--background);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      max-width: 90vw;
      max-height: 90vh;
      overflow: auto;
      z-index: 9999;
      animation: slideIn 0.2s ease-out;
      padding: 24px;
      min-width: 400px;
    `;

    // Create title
    const titleElement = document.createElement('h2');
    titleElement.setAttribute('data-modal-title', '');
    titleElement.style.cssText = `
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--foreground);
    `;
    titleElement.textContent = this.titleEl.textContent || 'Modal';

    // Create content
    const contentElement = document.createElement('div');
    contentElement.setAttribute('data-modal-content', '');
    contentElement.style.cssText = `
      color: var(--foreground);
      line-height: 1.5;
    `;
    if (this.contentEl.textContent) {
      contentElement.textContent = this.contentEl.textContent;
    } else if (this.contentEl.children.length > 0) {
      Array.from(this.contentEl.children).forEach(child => {
        contentElement.appendChild(child.cloneNode(true));
      });
    }

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--muted-foreground);
      padding: 4px 8px;
      line-height: 1;
    `;
    closeButton.addEventListener('click', () => this.close());

    // Assemble modal
    this.modalRoot.appendChild(closeButton);
    this.modalRoot.appendChild(titleElement);
    this.modalRoot.appendChild(contentElement);

    // Add to document
    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.modalRoot);

    // Add animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translate(-50%, -48%);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%);
        }
      }
    `;
    document.head.appendChild(style);
  }
}

function findTextInputElement(modal: Modal): HTMLElement | undefined {
  const direct = (modal as TextModalLike).inputEl;
  if (isTextInputElement(direct)) return direct;
  const fromContent = modal.contentEl.querySelector('input, textarea');
  if (isTextInputElement(fromContent)) return fromContent;
  const fromModal = modal.modalEl.querySelector('input, textarea');
  if (isTextInputElement(fromModal)) return fromModal;
  return undefined;
}

function isTextInputElement(element: Element | null | undefined): element is HTMLElement {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;
  const type = (element.getAttribute('type') ?? (element as HTMLInputElement).type ?? 'text').toLowerCase();
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

function findSubmitButton(modal: Modal): HTMLElement | undefined {
  const direct = (modal as TextModalLike).okButton;
  if (direct) return direct;
  const button = modal.modalEl.querySelector('button:not([disabled]), input[type="submit"]:not([disabled])');
  return (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) || isStubElement(button)
    ? button as HTMLElement
    : undefined;
}

function isStubElement(element: Element | null | undefined): boolean {
  return Boolean(element && typeof (element as ObsidianElement).__dispatchObsidianEvent === 'function');
}

function createTextModalSubmitter(modal: Modal, inputEl: HTMLElement): (value: string) => Promise<void> {
  return async (value: string) => {
    (inputEl as HTMLInputElement | HTMLTextAreaElement).value = value;
    await dispatchObsidianElementEvent(inputEl, 'input');

    const button = findSubmitButton(modal);
    if (button) {
      await dispatchObsidianElementEvent(button, 'click');
      return;
    }

    await dispatchObsidianElementEvent(inputEl, 'keypress', { key: 'Enter', isComposing: false });
    const onOK = (modal as TextModalLike).onOK;
    if (typeof onOK === 'function') {
      const refused = await Promise.resolve(onOK.call(modal, createTextModalEvent('click') as MouseEvent));
      if (!refused) modal.close();
    }
  };
}

async function dispatchObsidianElementEvent(element: HTMLElement, type: string, init: Record<string, unknown> = {}): Promise<void> {
  const dispatcher = (element as ObsidianElement).__dispatchObsidianEvent;
  if (dispatcher) {
    await dispatcher(type, init);
    return;
  }
  if (typeof Event !== 'undefined' && typeof element.dispatchEvent === 'function') {
    const event = type.startsWith('key') && typeof KeyboardEvent !== 'undefined'
      ? new KeyboardEvent(type, init)
      : new Event(type, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
  }
}

function createTextModalEvent(type: string): MouseEvent | KeyboardEvent | Event {
  if (typeof MouseEvent !== 'undefined') {
    return new MouseEvent(type);
  }
  return {
    type,
    preventDefault() {},
    stopPropagation() {},
  } as Event;
}
