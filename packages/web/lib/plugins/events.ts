export const PLUGINS_CHANGED_EVENT = 'mindos:plugins-changed';
export const OBSIDIAN_PLUGIN_PACKAGES_CHANGED_EVENT = 'mindos:obsidian-plugin-packages-changed';

function dispatchBrowserEvent(name: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(name));
}

export function notifyPluginsChanged(): void {
  dispatchBrowserEvent(PLUGINS_CHANGED_EVENT);
}

export function notifyObsidianPluginPackagesChanged(): void {
  dispatchBrowserEvent(OBSIDIAN_PLUGIN_PACKAGES_CHANGED_EVENT);
  dispatchBrowserEvent(PLUGINS_CHANGED_EVENT);
}
