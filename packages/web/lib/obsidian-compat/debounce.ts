export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | void;
}

/** Browser-safe Obsidian debounce contract shared with the server module surface. */
export function debounce<T extends unknown[], V>(callback: (...args: T) => V, timeout = 0, resetTimer = true): Debouncer<T, V> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const run = () => {
    clear(); const args = pending; pending = null;
    // Clear state before invoking user code so errors and reentrant scheduling
    // cannot replay or erase the callback's next request.
    if (args) return callback(...args);
  };
  const task = ((...args: T) => {
    pending = args;
    if (timer === null || resetTimer) { clear(); timer = setTimeout(run, Math.max(0, timeout)); }
    return task;
  }) as Debouncer<T, V>;
  task.cancel = () => { clear(); pending = null; return task; };
  task.run = run;
  return task;
}
