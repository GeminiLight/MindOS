type DraftStorage = {
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createMarkdownDraftQueue(storage: DraftStorage): DraftStorage {
  const pending = new Map<string, Promise<void>>();
  const enqueue = (key: string, operation: () => Promise<void>) => {
    const result = (pending.get(key) ?? Promise.resolve()).then(operation);
    // A failed operation must be observable by its caller without poisoning later writes.
    const settled = result.catch(() => {}).finally(() => {
      if (pending.get(key) === settled) pending.delete(key);
    });
    pending.set(key, settled);
    return result;
  };
  return {
    setItem: (key, value) => enqueue(key, () => storage.setItem(key, value)),
    removeItem: (key) => enqueue(key, () => storage.removeItem(key)),
  };
}
