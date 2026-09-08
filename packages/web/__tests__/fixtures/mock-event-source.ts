/**
 * Minimal EventSource double for transport tests. Tests drive it explicitly:
 * `open()` fires `onopen`, `emit()` delivers a named frame (with an optional
 * `id:`), `fail()` fires `onerror`. Nothing happens automatically so timing
 * assertions stay deterministic under fake timers.
 */
export class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  static reset(): void {
    MockEventSource.instances = [];
  }

  static last(): MockEventSource {
    const instance = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!instance) throw new Error('no EventSource was created');
    return instance;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }

  /** Deliver a frame the way the browser would: named listeners, or onmessage for `message`. */
  emit(type: string, data: unknown, id?: number): void {
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: id === undefined ? '' : String(id),
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    if (type === 'message') this.onmessage?.(event);
  }

  /** Convenience: open the socket and deliver a ready frame in one step. */
  ready(payload: { lastEventId?: number; resync?: boolean; treeVersion?: number } = {}): void {
    this.open();
    const lastEventId = payload.lastEventId ?? 0;
    this.emit('ready', {
      type: 'ready',
      lastEventId,
      resync: payload.resync ?? false,
      ...(payload.treeVersion !== undefined ? { treeVersion: payload.treeVersion } : {}),
    }, lastEventId);
  }
}

export function setDocumentVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}
