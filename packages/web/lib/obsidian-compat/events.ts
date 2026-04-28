/**
 * Obsidian Plugin Compatibility - Events Base
 * Minimal event emitter used by Vault, MetadataCache, Workspace
 */

export type EventCallback = (...args: any[]) => any;
export type EventRef = { off: () => void };

export class Events {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(name: string, callback: EventCallback): EventRef {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(callback);

    return {
      off: () => this.off(name, callback),
    };
  }

  off(name: string, callback: EventCallback): void {
    const set = this.listeners.get(name);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(name);
      }
    }
  }

  offref(ref: EventRef): void {
    // ref.off() is already bound, just call it
    ref.off();
  }

  trigger(name: string, ...args: any[]): void {
    const set = this.listeners.get(name);
    if (set) {
      for (const callback of Array.from(set)) {
        try {
          callback(...args);
        } catch (err) {
          console.error(`[obsidian-compat] Event '${name}' callback error:`, err);
        }
      }
    }
  }
}
