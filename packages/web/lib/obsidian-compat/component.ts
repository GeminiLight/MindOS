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
  #children: Set<LifecycleChild> = new Set();
  #unloadCallbacks: Set<() => void> = new Set();
  #loaded = false;
  #unloaded = false;
  #unloading = false;

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    this.#unloaded = false;
    try {
      await this.onload();
      for (const child of Array.from(this.#children)) {
        await child.load();
      }
    } catch (err) {
      this.#loaded = false;
      throw err;
    }
  }

  async unload(): Promise<void> {
    if (this.#unloading || (this.#unloaded && !this.#loaded)) {
      return;
    }

    this.#unloading = true;
    const errors: unknown[] = [];
    // Clean up all children first
    try {
      for (const child of Array.from(this.#children)) {
        try { await child.unload(); } catch (error) { errors.push(error); }
      }
      this.#children.clear();

      // Call all registered unload callbacks
      for (const callback of Array.from(this.#unloadCallbacks)) {
        try {
          callback();
        } catch (err) {
          console.error('[obsidian-compat] Component unload callback error:', err);
        }
      }
      this.#unloadCallbacks.clear();

      // Call user-defined onunload
      try { await this.onunload(); } catch (error) { errors.push(error); }
    } finally {
      this.#loaded = false;
      this.#unloaded = true;
      this.#unloading = false;
    }
    if (errors.length) throw new AggregateError(errors, 'Component cleanup failed.');
  }

  /** Override in subclass */
  onload(): Promise<void> | void {}

  /** Override in subclass */
  onunload(): Promise<void> | void {}

  addChild<T extends LifecycleChild>(child: T): T {
    if (this.#unloading || this.#unloaded) {
      this.#disposeChild(child);
      return child;
    }
    this.#children.add(child);
    if (this.#loaded) {
      void child.load().catch((err) => {
        console.error('[obsidian-compat] Component child load error:', err);
      });
    }
    return child;
  }

  removeChild<T extends LifecycleChild>(child: T): T {
    if (this.#children.delete(child)) {
      this.#disposeChild(child);
    }
    return child;
  }

  #disposeChild(child: LifecycleChild): void {
    void child.unload().catch(error => console.error('[obsidian-compat] Component child unload error:', error));
  }

  /**
   * Register a callback to be invoked when this component unloads.
   */
  register(callback: () => void): void {
    // Async render work can finish after its parent disappears. Never leave a
    // listener/timer waiting for an unload that has already happened.
    if (this.#unloading || this.#unloaded) { callback(); return; }
    this.#unloadCallbacks.add(callback);
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
