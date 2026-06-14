/**
 * Obsidian Plugin Compatibility - Events Base
 * Minimal event emitter used by Vault, MetadataCache, Workspace
 */

export type EventCallback = (...args: any[]) => any;
export type EventRef = {
  name?: string;
  callback?: EventCallback;
  ctx?: unknown;
  off: () => void;
};

export class Events {
  private listeners: Map<string, Set<EventRef>> = new Map();

  on(name: string, callback: EventCallback, ctx?: unknown): EventRef {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }

    const ref: EventRef = {
      name,
      callback,
      ctx,
      off: () => this.offref(ref),
    };
    this.listeners.get(name)!.add(ref);
    return ref;
  }

  off(name: string, callback: EventCallback): void {
    const set = this.listeners.get(name);
    if (!set) return;

    for (const ref of Array.from(set)) {
      if (ref.callback === callback) {
        set.delete(ref);
      }
    }
    if (set.size === 0) {
      this.listeners.delete(name);
    }
  }

  offref(ref: EventRef): void {
    if (!ref.name) {
      ref.off();
      return;
    }

    const set = this.listeners.get(ref.name);
    if (!set) return;
    set.delete(ref);
    if (set.size === 0) {
      this.listeners.delete(ref.name);
    }
  }

  trigger(name: string, ...args: any[]): unknown[] {
    return this.tryTrigger(name, args);
  }

  tryTrigger(name: string, args: any[]): unknown[] {
    const set = this.listeners.get(name);
    if (!set) return [];

    const results: unknown[] = [];
    for (const ref of Array.from(set)) {
      try {
        results.push(ref.callback?.apply(ref.ctx, args));
      } catch (err) {
        console.error(`[obsidian-compat] Event '${name}' callback error:`, err);
        results.push(undefined);
      }
    }
    return results;
  }
}
