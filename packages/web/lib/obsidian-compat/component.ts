/**
 * Obsidian Plugin Compatibility - Component Base
 * Lifecycle and resource cleanup
 */

import { Events, EventRef } from './events';

type LifecycleChild = {
  load(): Promise<void>;
  unload(): Promise<void>;
};

/**
 * Base component class for plugin lifecycle and event/timer cleanup.
 * Plugins extend this; ensures unload() properly cleans up child resources.
 */
export class Component extends Events {
  private children: Set<LifecycleChild> = new Set();
  private unloadCallbacks: Set<() => void> = new Set();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      await this.onload();
      for (const child of Array.from(this.children)) {
        await child.load();
      }
    } catch (err) {
      this.loaded = false;
      throw err;
    }
  }

  async unload(): Promise<void> {
    // Clean up all children first
    for (const child of Array.from(this.children)) {
      await child.unload();
    }
    this.children.clear();

    // Call all registered unload callbacks
    for (const callback of Array.from(this.unloadCallbacks)) {
      try {
        callback();
      } catch (err) {
        console.error('[obsidian-compat] Component unload callback error:', err);
      }
    }
    this.unloadCallbacks.clear();

    // Call user-defined onunload
    try {
      await this.onunload();
    } finally {
      this.loaded = false;
    }
  }

  /** Override in subclass */
  onload(): Promise<void> | void {}

  /** Override in subclass */
  onunload(): Promise<void> | void {}

  addChild<T extends LifecycleChild>(child: T): T {
    this.children.add(child);
    if (this.loaded) {
      void child.load();
    }
    return child;
  }

  removeChild<T extends LifecycleChild>(child: T): T {
    if (this.children.delete(child)) {
      void child.unload();
    }
    return child;
  }

  /**
   * Register a callback to be invoked when this component unloads.
   */
  register(callback: () => void): void {
    this.unloadCallbacks.add(callback);
  }

  /**
   * Register an event reference. Automatically calls ref.off() on unload.
   */
  registerEvent(ref: EventRef): void {
    this.register(() => ref.off());
  }

  /**
   * Register a DOM event listener. Automatically removes on unload.
   */
  registerDomEvent(el: EventTarget, type: string, callback: EventListener, options?: boolean | AddEventListenerOptions): void {
    el.addEventListener(type, callback, options);
    this.register(() => el.removeEventListener(type, callback, options));
  }

  /**
   * Register an interval timer. Automatically clears on unload.
   */
  registerInterval(id: number): number {
    this.register(() => clearInterval(id));
    return id;
  }
}
