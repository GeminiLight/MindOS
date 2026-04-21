/**
 * Obsidian Plugin Compatibility - UI shims
 * Integrates Obsidian plugin UI components with MindOS's UI system.
 */

import { Component } from '../component';
import type { App } from '../types';
import { toast } from '@/lib/toast';

/**
 * Notice - Displays toast notifications using MindOS's toast system.
 */
export class Notice {
  message: string;
  timeout?: number;

  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;

    // Integrate with MindOS toast system
    if (typeof window !== 'undefined') {
      // Determine toast type based on message content
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('error') || lowerMessage.includes('failed') || lowerMessage.includes('fail')) {
        toast.error(message, timeout);
      } else if (lowerMessage.includes('success') || lowerMessage.includes('saved') || lowerMessage.includes('complete')) {
        toast.success(message, timeout);
      } else {
        toast(message, timeout !== undefined ? { duration: timeout } : undefined);
      }
    }
  }
}

function createElement(tagName: string): HTMLElement {
  if (typeof document !== 'undefined') {
    return document.createElement(tagName);
  }

  return {
    innerHTML: '',
    textContent: '',
    appendChild: () => null,
    remove: () => {},
  } as unknown as HTMLElement;
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
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  isOpen = false;
  private modalRoot: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;

  constructor(app: App) {
    super();
    this.app = app;
    this.containerEl = createElement('div');
    this.contentEl = createElement('div');
    this.titleEl = createElement('div');
  }

  open(): void {
    this.isOpen = true;

    // Create modal in DOM if in browser environment
    if (typeof document !== 'undefined') {
      this.renderModal();
    }

    this.onOpen();
  }

  close(): void {
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
      this.contentEl.innerHTML = '';
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
    this.backdrop = document.createElement('div');
    this.backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 9998;
      animation: fadeIn 0.2s ease-out;
    `;
    this.backdrop.addEventListener('click', () => this.close());

    // Create modal container
    this.modalRoot = document.createElement('div');
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
