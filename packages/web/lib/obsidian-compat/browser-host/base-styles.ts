/** Small Obsidian host primitives. Original plugin CSS is loaded separately, without rewriting. */
export const browserHostBaseStyles = `
[data-obsidian-browser-host] {
  --text-normal: var(--foreground, CanvasText);
  --text-muted: var(--muted-foreground, GrayText);
  --nav-item-color: var(--text-normal);
  --nav-item-color-hover: var(--text-normal);
  --nav-item-background-hover: var(--muted, ButtonFace);
  --nav-item-size: 14px;
  --nav-item-weight: 400;
  --nav-item-weight-hover: 500;
  --font-medium: 500;
  --radius-s: var(--radius, 4px);
  color: var(--text-normal);
  background: var(--background, Canvas);
  font-family: var(--font-ibm-plex-sans, system-ui), sans-serif;
}
[data-obsidian-browser-host] .nav-buttons-container { display: flex; align-items: center; }
[data-obsidian-browser-host] .nav-action-button { cursor: pointer; }
[data-obsidian-browser-host] .nav-action-button svg { width: 20px; height: 20px; }
[data-obsidian-browser-host] .view-content { padding: 12px; }
[data-obsidian-browser-host] .setting-item { padding: 12px 0; }
[data-obsidian-browser-host] .setting-item-description { color: var(--text-muted); font-size: 13px; }
[data-obsidian-browser-host] .setting-item-heading { border-bottom: 1px solid var(--border, ButtonBorder); font-weight: 600; }
[data-obsidian-browser-host] .setting-item-error { color: var(--error, CanvasText); }
[data-obsidian-browser-host] .plugin-settings-panel { max-height: 60vh; overflow: auto; padding: 12px; margin-block: 12px; border-block: 1px solid var(--border, ButtonBorder); }
[data-obsidian-browser-host] .plugin-settings-panel header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
[data-obsidian-browser-host] :focus-visible { outline: 2px solid var(--amber, Highlight); outline-offset: 2px; }
`;
