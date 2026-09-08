import type { BrowserPluginHost } from './plugin-host';

/** Isolated, imperative plugin DOM cannot be mounted in the main React settings
 * primitives. Keep this host-owned panel inside the same disposable frame.
 */
export function createPluginSettingsPanel(host: BrowserPluginHost, pluginId: string, toolbar: HTMLElement, invalidatePreview: () => void): void {
  const button = toolbar.appendChild(document.createElement('button'));
  button.type = 'button'; button.textContent = 'Plugin settings'; button.setAttribute('aria-expanded', 'false');
  const status = toolbar.appendChild(document.createElement('span')); status.setAttribute('role', 'status');
  const panel = document.createElement('section'); panel.id = 'plugin-settings'; panel.hidden = true;
  panel.className = 'plugin-settings-panel'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Plugin settings (this session)');
  button.setAttribute('aria-controls', panel.id);
  const header = panel.appendChild(document.createElement('header'));
  const title = header.appendChild(document.createElement('h2')); title.textContent = 'Plugin settings';
  const close = header.appendChild(document.createElement('button')); close.type = 'button'; close.textContent = 'Close plugin settings';
  const note = panel.appendChild(document.createElement('p')); note.textContent = 'Settings apply only to this editor session and are cleared when this window closes.';
  const content = panel.appendChild(document.createElement('div'));
  toolbar.after(panel);
  let generation = 0;
  const closePanel = () => {
    const closedAt = ++generation;
    void host.hideSettings(pluginId).catch(error => {
      if (generation === closedAt) { status.setAttribute('role', 'alert'); status.textContent = String(error); }
    });
    panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus();
  };
  close.addEventListener('click', closePanel);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closePanel(); } });
  for (const event of ['input', 'change']) panel.addEventListener(event, invalidatePreview);
  button.addEventListener('click', async () => {
    if (!panel.hidden) { closePanel(); return; }
    const openedAt = ++generation;
    content.replaceChildren(); status.textContent = ''; status.setAttribute('role', 'status');
    panel.hidden = false; button.setAttribute('aria-expanded', 'true');
    close.focus();
    try {
      const count = await host.showSettings(pluginId, content);
      if (openedAt === generation && count === 0) content.textContent = 'This plugin provides no settings.';
    } catch (error) {
      if (openedAt === generation) { status.setAttribute('role', 'alert'); status.textContent = `Cannot open plugin settings: ${String(error)}`; }
    }
  });
}
