/** A narrow request/reply channel. Only the trusted parent can choose disk scope. */
export function createPluginDataBridge() {
  const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let closed = false;
  const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || event.data?.kind !== 'plugin-data-result' || typeof event.data.id !== 'string') return;
    const item = pending.get(event.data.id); if (!item) return;
    pending.delete(event.data.id); clearTimeout(item.timer);
    if (event.data.error) item.reject(new Error(String(event.data.error).slice(0, 300)));
    else item.resolve(event.data.data);
  };
  window.addEventListener('message', receive);
  const request = (operation: 'read' | 'write', data?: unknown): Promise<unknown> => {
    if (closed) return Promise.reject(new Error('Plugin configuration session closed.'));
    if (pending.size >= 32) return Promise.reject(new Error('Too many plugin configuration requests.'));
    const json = JSON.stringify(data);
    if (operation === 'write' && (json === undefined || new TextEncoder().encode(json).length > 1024 * 1024)) return Promise.reject(new Error('Plugin configuration JSON size limit exceeded.'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Plugin configuration request timed out.')); }, 10_000);
      pending.set(id, { resolve, reject, timer });
      try {
        window.parent.postMessage({ kind: 'plugin-data', id, operation, ...(operation === 'write' ? { data: JSON.parse(json!) } : {}) }, '*');
      } catch (error) {
        pending.delete(id); clearTimeout(timer); reject(error);
      }
    });
  };
  return {
    load: () => request('read'),
    save: async (data: unknown) => { await request('write', data); },
    close() {
      if (closed) return; closed = true; window.removeEventListener('message', receive);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Plugin configuration session closed.')); }
      pending.clear();
    },
  };
}
