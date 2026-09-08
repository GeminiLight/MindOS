import type { BrowserPluginSettingTab } from './dom-api';

type Owner = { assertActive(): void };
type Entry = {
  tabs: BrowserPluginSettingTab[]; visible: Map<BrowserPluginSettingTab, HTMLElement>;
  tail: Promise<void>; generation: number; closed: boolean; timedOut: boolean;
};
type Invoke = (action: () => unknown, label: string, onTimeout: () => void) => Promise<void>;

/** Serialize hooks per plugin so a late display cannot mutate a reused tab in a
 * newer opening. Hide cancels publication and detaches immediately, even while
 * display is pending. A timed-out hook may still be running: do not reuse its tab.
 */
export class BrowserSettingsLifecycle<T extends Owner> {
  private entries = new Map<T, Entry>();
  constructor(private readonly mount: (owner: T, element: HTMLElement) => void, private readonly invoke: Invoke) {}
  register(owner: T, tab: BrowserPluginSettingTab): void {
    owner.assertActive();
    const entry: Entry = this.entries.get(owner) ?? { tabs: [], visible: new Map(), tail: Promise.resolve(), generation: 0, closed: false, timedOut: false };
    if (!entry.tabs.includes(tab)) entry.tabs.push(tab);
    this.entries.set(owner, entry);
  }
  async show(owner: T, container: HTMLElement): Promise<number> {
    owner.assertActive();
    const entry = this.entries.get(owner); if (!entry) return 0;
    const generation = ++entry.generation; this.detach(entry);
    return this.enqueue(entry, async () => {
      if (entry.timedOut) throw new Error('Reload the plugin before reopening settings after a hook timed out.');
      const assertCurrent = () => {
        owner.assertActive();
        if (entry.closed || generation !== entry.generation) throw new Error('Settings display was closed or replaced.');
      };
      await this.cleanup(entry); assertCurrent();
      const tabs = [...entry.tabs];
      try {
        for (const tab of tabs) {
          assertCurrent(); const element = tab.containerEl;
          this.mount(owner, element); container.appendChild(element); entry.visible.set(tab, element);
          await this.invoke(() => tab.display(), 'Settings display', () => { entry.timedOut = true; });
          assertCurrent();
        }
      } catch (error) {
        try { await this.cleanup(entry); } catch { /* Preserve display failure after attempting all cleanup. */ }
        throw error;
      }
      return tabs.length;
    });
  }
  hide(owner: T): Promise<void> {
    const entry = this.entries.get(owner); if (!entry) return Promise.resolve();
    entry.generation++; this.detach(entry);
    return this.enqueue(entry, () => this.cleanup(entry));
  }
  remove(owner: T): Promise<void> {
    const entry = this.entries.get(owner); if (!entry) return Promise.resolve();
    this.entries.delete(owner); entry.closed = true; entry.generation++; this.detach(entry);
    return this.enqueue(entry, () => this.cleanup(entry));
  }
  private detach(entry: Entry): void { for (const element of entry.visible.values()) element.remove(); }
  private enqueue<R>(entry: Entry, action: () => Promise<R>): Promise<R> {
    const result = entry.tail.then(action);
    entry.tail = result.then(() => {}, () => {}); return result;
  }
  private async cleanup(entry: Entry): Promise<void> {
    const visible = [...entry.visible]; entry.visible.clear();
    const results = await Promise.allSettled(visible.map(async ([tab, element]) => {
      try { await this.invoke(() => tab.hide(), 'Settings cleanup', () => { entry.timedOut = true; }); }
      finally { element.remove(); }
    }));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'Settings cleanup failed.');
  }
}
