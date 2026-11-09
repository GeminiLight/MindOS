/**
 * The contextBridge surface for the connect UI (`connect.html`).
 *
 * This lives apart from `connect-preload.ts` because connect.html now renders
 * in two places: its own dialog window, and the **main window** during boot.
 * A preload script is fixed at window creation and cannot be swapped on
 * navigation, so the main window's preload has to be able to expose this same
 * surface — but only while it is actually showing the boot shell.
 *
 * That branch (see preload.ts) is what keeps the trust boundary intact: the
 * Web app's origin never receives `mindosConnect`, and the boot shell never
 * receives the product bridge. Neither can reach the other's channels even if
 * one of them is compromised.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Status payload pushed by main while the shell is booting (see boot-shell.ts). */
export interface ShellStatusPayload {
  status?: string;
  message?: string;
  error?: string;
  /** Readonly so callers can keep their action lists as `as const` tables. */
  actions?: readonly { readonly id: string; readonly label: string; readonly primary?: boolean }[];
  done?: boolean;
}

function connectApi() {
  return {
    // Shell language (shared with tray / menu / dialogs — see i18n/lang.ts)
    getUiLang: () => ipcRenderer.invoke('connect:get-ui-lang'),
    setUiLang: (value: 'system' | 'zh' | 'en') => ipcRenderer.invoke('connect:set-ui-lang', value),
    getUiTheme: () => ipcRenderer.invoke('connect:get-ui-theme'),
    setUiTheme: (value: 'system' | 'light' | 'dark') => ipcRenderer.invoke('connect:set-ui-theme', value),
    // The renderer measures its content; main clamps and applies (see fit-window).
    fitWindow: (height: number) => ipcRenderer.invoke('connect:fit-window', height),

    // Mode selection
    checkNode: () => ipcRenderer.invoke('connect:check-node'),
    checkMindosStatus: () => ipcRenderer.invoke('connect:check-mindos-status'),
    buildMindos: (modulePath: string) => ipcRenderer.invoke('connect:build-mindos', modulePath),
    getMindosPath: () => ipcRenderer.invoke('connect:get-mindos-path'),
    installMindos: () => ipcRenderer.invoke('connect:install-mindos'),
    selectMode: (mode: 'local' | 'remote') => ipcRenderer.invoke('connect:select-mode', mode),
    showNodeDialog: () => ipcRenderer.invoke('connect:show-node-dialog'),
    openNodejs: () => ipcRenderer.invoke('connect:open-nodejs'),

    // Connection management
    getRecentConnections: () => ipcRenderer.invoke('connect:get-recent'),
    getSavedPassword: (address: string) => ipcRenderer.invoke('connect:get-saved-password', address),
    testConnection: (address: string) => ipcRenderer.invoke('connect:test', address),
    connect: (address: string, password: string | null) => ipcRenderer.invoke('connect:connect', address, password),
    removeConnection: (address: string) => ipcRenderer.invoke('connect:remove', address),
    switchToLocal: () => ipcRenderer.invoke('connect:switch-local'),

    // SSH tunnel
    getSshHosts: () => ipcRenderer.invoke('connect:ssh-hosts'),
    connectSsh: (host: string, remotePort: number) => ipcRenderer.invoke('connect:ssh-connect', host, remotePort),
    cancelSsh: () => ipcRenderer.invoke('connect:ssh-cancel'),
    completeSshWithPassword: (sshHost: string, sshRemotePort: number, tunnelUrl: string, password: string) =>
      ipcRenderer.invoke('connect:ssh-complete', sshHost, sshRemotePort, tunnelUrl, password),
    sshAddKey: (host: string, remotePort: number, passphrase: string, remember: boolean) =>
      ipcRenderer.invoke('connect:ssh-add-key', host, remotePort, passphrase, remember),
  };
}

/**
 * Boot-shell-only additions.
 *
 * `shell: 'boot'` tells the renderer it is hosted in the main window, so it
 * must not drive the window size — the user's remembered geometry wins.
 */
function bootApi() {
  return {
    shell: 'boot' as const,
    onStatus: (callback: (data: ShellStatusPayload) => void) => {
      ipcRenderer.on('shell:status', (_event, data: ShellStatusPayload) => callback(data));
    },
    /**
     * Main asking the boot shell to show a particular screen.
     *
     * Needed when a saved remote connection fails to auto-reconnect: the shell
     * is on the progress screen and has to offer the connect form without
     * opening a second window.
     */
    onScreen: (callback: (screen: 'remote' | 'modes' | 'boot') => void) => {
      ipcRenderer.on('shell:screen', (_event, screen: 'remote' | 'modes' | 'boot') => callback(screen));
    },
    action: (id: string) => ipcRenderer.invoke('shell:action', id),
  };
}

export function exposeConnectBridge(options: { boot: boolean }): void {
  const api = options.boot ? { ...connectApi(), ...bootApi() } : { ...connectApi(), shell: 'dialog' as const };
  contextBridge.exposeInMainWorld('mindosConnect', api);
}
