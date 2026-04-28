/**
 * Obsidian Plugin Compatibility - Component Base
 * Lifecycle and resource cleanup
 */

import { Events, EventRef } from './events';

/**
 * Base component class for plugin lifecycle and event/timer cleanup.
 * Plugins extend this; ensures unload() properly cleans up child resources.
 */
export class Component extends Events {
  private children: Set<Component> = new Set();
  private unloadCallbacks: Set<() => void> = new Set();

  async load(): Promise<void> {
    await this.onload();
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
    await this.onunload();
  }

  /** Override in subclass */
  onload(): Promise<void> | void {}

  /** Override in subclass */
  onunload(): Promise<void> | void {}

  addChild(child: Component): void {
    this.children.add(child);
  }

  removeChild(child: Component): void {
    this.children.delete(child);
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
  registerDomEvent(el: EventTarget, type: string, callback: EventListener): void {
    el.addEventListener(type, callback);
    this.register(() => el.removeEventListener(type, callback));
  }

  /**
   * Register an interval timer. Automatically clears on unload.
   */
  registerInterval(id: number): number {
    this.register(() => clearInterval(id));
    return id;
  }
}
