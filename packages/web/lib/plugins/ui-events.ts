export const PLUGIN_ENTRIES_OPEN_EVENT = 'mindos:plugin-entries-open';
export const PLUGIN_ENTRIES_STATE_EVENT = 'mindos:plugin-entries-state';
export const COMMAND_CENTER_OPEN_EVENT = 'mindos:command-center-open';

export interface PluginEntriesStateDetail {
  count: number;
  mounted: number;
  catalog: number;
}

function dispatchUiEvent(name: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(name));
}

export function requestPluginEntriesOpen() {
  dispatchUiEvent(PLUGIN_ENTRIES_OPEN_EVENT);
}

export function requestCommandCenterOpen() {
  dispatchUiEvent(COMMAND_CENTER_OPEN_EVENT);
}

export function notifyPluginEntriesState(detail: PluginEntriesStateDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PluginEntriesStateDetail>(PLUGIN_ENTRIES_STATE_EVENT, { detail }));
}
