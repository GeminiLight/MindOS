type Subscription = { element: HTMLElement; listener: () => void; once: boolean; dispose(): void };
const documents = new WeakMap<Document, { observer: MutationObserver; subscriptions: Set<Subscription> }>();

function onNodeInserted(this: HTMLElement, listener: () => void, once = false): () => void {
  if (typeof listener !== 'function') throw new TypeError('An insertion listener is required.');
  const doc = this.ownerDocument;
  let entry = documents.get(doc);
  if (!entry) {
    const subscriptions = new Set<Subscription>();
    const observer = new MutationObserver(records => {
      const added = records.flatMap(record => Array.from(record.addedNodes));
      for (const subscription of [...subscriptions]) {
        if (!subscriptions.has(subscription) || !subscription.element.isConnected
          || !added.some(node => node === subscription.element || node.contains(subscription.element))) continue;
        if (subscription.once) subscription.dispose();
        try { subscription.listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
      }
    });
    observer.observe(doc, { childList: true, subtree: true });
    entry = { observer, subscriptions }; documents.set(doc, entry);
  }
  const current = entry;
  const subscription: Subscription = { element: this, listener, once, dispose() {
    if (!current.subscriptions.delete(subscription)) return;
    if (current.subscriptions.size === 0) {
      current.observer.disconnect();
      if (documents.get(doc) === current) documents.delete(doc);
    }
  } };
  current.subscriptions.add(subscription);
  return subscription.dispose;
}

/** One shared observer per disposable document, disconnected after the last owner. */
export function installBrowserDomLifecycle(): void {
  if (!('onNodeInserted' in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, 'onNodeInserted', {
    value: onNodeInserted, configurable: true, writable: true,
  });
  if (!('isShown' in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, 'isShown', {
    configurable: true, writable: true,
    value(this: HTMLElement) { return this.isConnected && this.offsetParent !== null; },
  });
}
